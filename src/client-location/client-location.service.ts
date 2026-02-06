import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { ExcelUploadService } from '../common/services/excel-upload.service';
import { ExcelDownloadService } from '../common/services/excel-download.service';
import { UploadJobService } from '../common/services/upload-job.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';
import * as fs from 'fs';
import {
  CreateClientLocationDto,
  UpdateClientLocationDto,
  BulkCreateClientLocationDto,
  BulkUpdateClientLocationDto,
  BulkDeleteClientLocationDto,
  ChangeStatusDto,
  FilterClientLocationDto,
} from './dto/client-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { LocationStatus, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class ClientLocationService {
  private readonly logger = new Logger(ClientLocationService.name);
  private readonly CACHE_TTL = 300;
  private readonly CACHE_KEY = 'client_locations';
  private readonly BACKGROUND_UPLOAD_BYTES =
    Number(process.env.EXCEL_BACKGROUND_THRESHOLD_BYTES) || 1 * 1024 * 1024;

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private autoNumberService: AutoNumberService,
    private excelUploadService: ExcelUploadService,
    private excelDownloadService: ExcelDownloadService,
    private uploadJobService: UploadJobService,
    private eventEmitter: EventEmitter2,
    private notificationService: NotificationService,
  ) {}

  async create(dto: CreateClientLocationDto, userId: string) {
    // Transform locationCode to uppercase
    const locationCodeUpper = dto.locationCode.toUpperCase();

    const existing = await this.prisma.clientLocation.findUnique({
      where: { locationCode: locationCodeUpper },
    });

    if (existing) {
      throw new ConflictException('Location code already exists');
    }

    // Validate Client Group Existence
    const clientGroup = await this.prisma.clientGroup.findUnique({
      where: { id: dto.clientGroupId },
    });
    if (!clientGroup) {
      throw new NotFoundException('Client Group not found');
    }

    // Validate Company if provided
    if (dto.companyId) {
      const company = await this.prisma.clientCompany.findFirst({
        where: { id: dto.companyId },
      });
      if (!company) {
        throw new NotFoundException('Client company not found');
      }
    }

    const generatedLocationNo =
      await this.autoNumberService.generateLocationNo();
    const { toTitleCase } = await import('../common/utils/string-helper');

    const location = await this.prisma.clientLocation.create({
      data: {
        companyId: dto.companyId || undefined,
        locationCode: locationCodeUpper,
        locationName: toTitleCase(dto.locationName),
        address: dto.address ? toTitleCase(dto.address) : undefined,
        locationNo: dto.locationNo || generatedLocationNo,
        remark: dto.remark ? toTitleCase(dto.remark) : undefined,
        status: dto.status || LocationStatus.Active,
        createdBy: userId,
        clientGroupId: dto.clientGroupId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'CREATE', location.id, null, location);

    return location;
  }

  async findAll(pagination: PaginationDto, filter?: FilterClientLocationDto) {
    const {
      page = 1,
      limit = 25,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = pagination;
    const skip = (page - 1) * limit;

    const cleanedSearch = search?.trim();
    const where: Prisma.ClientLocationWhereInput = {
      AND: [],
    };

    const andArray = where.AND as Array<Prisma.ClientLocationWhereInput>;
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Handle Status Filter (handle possible multi-select from UI)
    if (filter?.status) {
      const statusValues =
        typeof filter.status === 'string'
          ? filter.status
              .split(/[,\:;|]/)
              .map((v) => v.trim())
              .filter(Boolean)
          : Array.isArray(filter.status)
            ? filter.status
            : [filter.status];

      if (statusValues.length > 0) {
        andArray.push({
          status: { in: statusValues as any },
        });
      }
    }

    if (filter?.clientGroupId) {
      const groupIds =
        typeof filter.clientGroupId === 'string'
          ? filter.clientGroupId
              .split(/[,\:;|]/)
              .map((v) => v.trim())
              .filter(Boolean)
          : Array.isArray(filter.clientGroupId)
            ? filter.clientGroupId
            : [filter.clientGroupId];
      if (groupIds.length > 0)
        andArray.push({ clientGroupId: { in: groupIds } });
    }

    if (filter?.companyId) {
      const companyIds =
        typeof filter.companyId === 'string'
          ? filter.companyId
              .split(/[,\:;|]/)
              .map((v) => v.trim())
              .filter(Boolean)
          : Array.isArray(filter.companyId)
            ? filter.companyId
            : [filter.companyId];
      if (companyIds.length > 0)
        andArray.push({ companyId: { in: companyIds } });
    }
    if (filter?.locationName)
      andArray.push(
        buildMultiValueFilter('locationName', toTitleCase(filter.locationName)),
      );
    if (filter?.locationNo)
      andArray.push(buildMultiValueFilter('locationNo', filter.locationNo));
    if (filter?.locationCode)
      andArray.push(buildMultiValueFilter('locationCode', filter.locationCode));
    if (filter?.remark)
      andArray.push(
        buildMultiValueFilter('remark', toTitleCase(filter.remark)),
      );
    if (filter?.address)
      andArray.push(
        buildMultiValueFilter('address', toTitleCase(filter.address)),
      );

    if (filter?.groupName) {
      const multiFilter = buildMultiValueFilter('groupName', filter.groupName);
      if (multiFilter) andArray.push({ clientGroup: multiFilter });
    }

    if (filter?.companyName) {
      const multiFilter = buildMultiValueFilter(
        'companyName',
        filter.companyName,
      );
      if (multiFilter) andArray.push({ company: multiFilter });
    }

    if (filter?.subLocationName) {
      const multiFilter = buildMultiValueFilter(
        'subLocationName',
        toTitleCase(filter.subLocationName),
      );
      if (multiFilter) andArray.push({ subLocations: { some: multiFilter } });
    }

    if (filter?.priority) {
      const multiFilter = buildMultiValueFilter('priority', filter.priority);
      if (multiFilter) andArray.push({ projects: { some: multiFilter } });
    }

    if (filter?.projectNo) {
      const multiFilter = buildMultiValueFilter('projectNo', filter.projectNo);
      if (multiFilter) andArray.push({ projects: { some: multiFilter } });
    }

    if (filter?.projectName) {
      const multiFilter = buildMultiValueFilter(
        'projectName',
        toTitleCase(filter.projectName),
      );
      if (multiFilter) andArray.push({ projects: { some: multiFilter } });
    }

    if (filter?.deadline) {
      const values = filter.deadline
        .split(/[,\;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const projectDeadlineConditions = values
        .map((v) => {
          const date = new Date(v);
          if (isNaN(date.getTime())) return undefined;

          const hasTime = v.includes('T') || v.includes(':');

          if (hasTime) {
            const startOfMinute = new Date(date.getTime());
            startOfMinute.setSeconds(0, 0);
            const endOfMinute = new Date(date.getTime());
            endOfMinute.setSeconds(59, 999);
            return { deadline: { gte: startOfMinute, lte: endOfMinute } };
          } else {
            const startOfDay = new Date(date.setHours(0, 0, 0, 0));
            const endOfDay = new Date(date.setHours(23, 59, 59, 999));
            return { deadline: { gte: startOfDay, lte: endOfDay } };
          }
        })
        .filter((v): v is { deadline: { gte: Date; lte: Date } } => !!v);

      if (projectDeadlineConditions.length > 0) {
        andArray.push({
          projects: { some: { OR: projectDeadlineConditions } },
        });
      }
    }

    if (cleanedSearch) {
      const searchValues = cleanedSearch
        .split(/[,\;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const allSearchConditions: Prisma.ClientLocationWhereInput[] = [];

      for (const val of searchValues) {
        const searchLower = val.toLowerCase();
        const searchTitle = toTitleCase(val);

        const looksLikeCode =
          /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

        if (looksLikeCode) {
          allSearchConditions.push({
            locationCode: { equals: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationNo: { equals: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationCode: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationNo: { contains: val, mode: 'insensitive' },
          });
        } else {
          allSearchConditions.push({
            locationName: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationName: { contains: searchTitle, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationCode: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            locationNo: { contains: val, mode: 'insensitive' },
          });
        }

        allSearchConditions.push({
          address: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          address: { contains: searchTitle, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: searchTitle, mode: 'insensitive' },
        });
        allSearchConditions.push({
          company: { companyName: { contains: val, mode: 'insensitive' } },
        });
        allSearchConditions.push({
          company: {
            companyName: { contains: searchTitle, mode: 'insensitive' },
          },
        });

        if ('active'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: 'Active' as any });
        }
        if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: 'Inactive' as any });
        }
      }

      if (allSearchConditions.length > 0) {
        andArray.push({ OR: allSearchConditions });
      }
    }

    if (andArray.length === 0) delete where.AND;

    // --- Redis Caching ---
    const isCacheable =
      !cleanedSearch && (!filter || Object.keys(filter).length === 0);
    const cacheKey = `${this.CACHE_KEY}:list:p${page}:l${limit}:s${sortBy}:${sortOrder}`;

    if (isCacheable) {
      const cached =
        await this.redisService.getCache<PaginatedResponse<any>>(cacheKey);
      if (cached) {
        this.logger.log(`[CACHE_HIT] ClientLocation List - ${cacheKey}`);
        return cached;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.clientLocation.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          locationNo: true,
          locationName: true,
          locationCode: true,
          address: true,
          status: true,
          remark: true,
          createdAt: true,
          companyId: true,
          company: {
            select: {
              id: true,
              companyName: true,
              companyCode: true,
            },
          },
          clientGroup: {
            select: {
              id: true,
              groupName: true,
            },
          },
          _count: {
            select: { subLocations: true, teams: true },
          },
        },
      }),
      this.prisma.clientLocation.count({ where }),
    ]);

    const mappedData = data.map((item) => ({
      ...item,
      clientCompany: item.company,
      companyName: item.company?.companyName, // Flattened for table column accessor
      groupName: item.clientGroup?.groupName, // Flattened for table column accessor
    }));

    const response = new PaginatedResponse(mappedData, total, page, limit);

    if (isCacheable) {
      await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
      this.logger.log(
        `[CACHE_MISS] ClientLocation List - Cached result: ${cacheKey}`,
      );
    }

    return response;
  }

  async downloadExcel(query: any, userId: string, res: any) {
    const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

    const mappedData = data.map((item, index) => ({
      srNo: index + 1,
      locationNo: item.locationNo,
      locationName: item.locationName,
      locationCode: item.locationCode,
      company: item.company?.companyName || '',
      address: item.address || '',
      status: item.status,
      remark: item.remark || '',
    }));

    const columns = [
      { header: '#', key: 'srNo', width: 10 },
      { header: 'Location No', key: 'locationNo', width: 15 },
      { header: 'Location Name', key: 'locationName', width: 30 },
      { header: 'Location Code', key: 'locationCode', width: 15 },
      { header: 'Company', key: 'company', width: 25 },
      { header: 'Address', key: 'address', width: 35 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Remark', key: 'remark', width: 30 },
    ];

    await this.excelDownloadService.downloadExcel(
      res,
      mappedData,
      columns,
      'client_locations.xlsx',
      'Client Locations',
    );
  }

  async findActive(pagination: PaginationDto) {
    const filter: FilterClientLocationDto = { status: LocationStatus.Active };
    return this.findAll(pagination, filter);
  }

  async findById(id: string) {
    const location = await this.prisma.clientLocation.findFirst({
      where: { id },
      include: {
        company: {
          include: {
            group: true,
          },
        },
        creator: {
          select: { id: true, teamName: true, email: true },
        },
        updater: {
          select: { id: true, teamName: true, email: true },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Client location not found');
    }

    return location;
  }

  async update(id: string, dto: UpdateClientLocationDto, userId: string) {
    const existing = await this.findById(id);
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Transform locationCode to uppercase if provided
    const locationCodeUpper = dto.locationCode
      ? dto.locationCode.toUpperCase()
      : undefined;

    if (locationCodeUpper && locationCodeUpper !== existing.locationCode) {
      const duplicate = await this.prisma.clientLocation.findUnique({
        where: { locationCode: locationCodeUpper },
      });

      if (duplicate) {
        throw new ConflictException('Location code already exists');
      }
    }

    if (dto.companyId) {
      const company = await this.prisma.clientCompany.findFirst({
        where: { id: dto.companyId },
      });

      if (!company) {
        throw new NotFoundException('Client company not found');
      }
    }

    const updated = await this.prisma.clientLocation.update({
      where: { id },
      data: {
        ...dto,
        locationCode: locationCodeUpper,
        locationName: dto.locationName
          ? toTitleCase(dto.locationName)
          : undefined,
        address: dto.address ? toTitleCase(dto.address) : undefined,
        remark: dto.remark ? toTitleCase(dto.remark) : undefined,
        updatedBy: userId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'UPDATE', id, existing, updated);

    return updated;
  }

  async changeStatus(id: string, dto: ChangeStatusDto, userId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.clientLocation.update({
      where: { id },
      data: {
        status: dto.status,
        updatedBy: userId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'STATUS_CHANGE', id, existing, updated);

    return updated;
  }

  async delete(id: string, userId: string) {
    const location = await this.prisma.clientLocation.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            subLocations: true,
            projects: true,
            teams: true,
            ipAddresses: true,
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Client location not found');
    }

    const { _count } = location;
    const childCounts = [
      _count.subLocations > 0 && `${_count.subLocations} sub-locations`,
      _count.projects > 0 && `${_count.projects} projects`,
      _count.teams > 0 && `${_count.teams} teams`,
      _count.ipAddresses > 0 && `${_count.ipAddresses} IP addresses`,
    ].filter(Boolean);

    if (childCounts.length > 0) {
      throw new BadRequestException(
        `Cannot delete Client Location because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`,
      );
    }

    await this.prisma.clientLocation.delete({
      where: { id },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'HARD_DELETE', id, location, null);

    return { message: 'Client location deleted successfully' };
  }

  async bulkCreate(dto: BulkCreateClientLocationDto, userId: string) {
    this.logger.log(
      `[BULK_CREATE_FAST] Starting for ${dto.locations.length} records`,
    );
    const { toTitleCase } = await import('../common/utils/string-helper');

    const errors: any[] = [];

    const prefix = 'CL-';
    const startNo = await this.autoNumberService.generateLocationNo();
    let currentNum = parseInt(
      startNo.replace(new RegExp(`^${prefix}`, 'i'), ''),
    );
    if (isNaN(currentNum)) currentNum = 11001;

    const BATCH_SIZE = 1000;
    const dataToInsert: any[] = [];

    // Optimization 1: Batch check for locationCode duplicates
    const providedCodes = dto.locations
      .map((l) => l.locationCode?.toUpperCase())
      .filter(Boolean);
    const existingCodes = new Set<string>();
    if (providedCodes.length > 0) {
      const codeChunks = this.excelUploadService.chunk(providedCodes, 5000);
      for (const chunk of codeChunks) {
        const results = await this.prisma.clientLocation.findMany({
          where: { locationCode: { in: chunk } },
          select: { locationCode: true },
        });
        results.forEach((r) => existingCodes.add(r.locationCode));
      }
    }

    // Optimization 2: Batch check for locationNo duplicates
    const providedNos = dto.locations.map((l) => l.locationNo).filter(Boolean);
    const existingNos = new Set<string>();
    if (providedNos.length > 0) {
      const noChunks = this.excelUploadService.chunk(providedNos, 5000);
      for (const chunk of noChunks) {
        const results = await this.prisma.clientLocation.findMany({
          where: { locationNo: { in: chunk as string[] } },
          select: { locationNo: true },
        });
        results.forEach((r) => existingNos.add(r.locationNo));
      }
    }

    for (const locationDto of dto.locations) {
      try {
        const locationName = toTitleCase(
          locationDto.locationName?.trim() ||
            locationDto.locationCode ||
            'Unnamed Location',
        );
        const address = locationDto.address
          ? toTitleCase(locationDto.address)
          : undefined;
        const remark = locationDto.remark
          ? toTitleCase(locationDto.remark)
          : undefined;

        // Unique code logic
        let finalLocationCode =
          locationDto.locationCode?.trim()?.toUpperCase() ||
          `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        if (existingCodes.has(finalLocationCode)) {
          let suffix = 1;
          const originalCode = finalLocationCode;
          while (existingCodes.has(`${originalCode}-${suffix}`)) {
            suffix++;
          }
          finalLocationCode = `${originalCode}-${suffix}`;
        }
        existingCodes.add(finalLocationCode);

        // Unique number logic
        let finalLocationNo = locationDto.locationNo?.trim();
        if (!finalLocationNo || existingNos.has(finalLocationNo)) {
          finalLocationNo = `${prefix}${currentNum}`;
          currentNum++;
        }
        existingNos.add(finalLocationNo);

        dataToInsert.push({
          ...locationDto,
          locationName,
          address,
          remark,
          locationCode: finalLocationCode,
          locationNo: finalLocationNo,
          status: locationDto.status || LocationStatus.Active,
          createdBy: userId,
        });
      } catch (err) {
        errors.push({
          locationCode: locationDto.locationCode,
          error: err.message,
        });
      }
    }

    const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
    let totalInserted = 0;
    for (const chunk of chunks) {
      try {
        const result = await this.prisma.clientLocation.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        totalInserted += result.count;
      } catch (err) {
        this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
        errors.push({ error: 'Batch insert failed', details: err.message });
      }
    }

    this.logger.log(
      `[BULK_CREATE_COMPLETED] Processed: ${dto.locations.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`,
    );
    await this.invalidateCache();

    return {
      success: totalInserted,
      failed: dto.locations.length - totalInserted,
      message: `Successfully inserted ${totalInserted} records.`,
      errors,
    };
  }

  async bulkUpdate(dto: BulkUpdateClientLocationDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const update of dto.updates) {
        try {
          const { id, ...data } = update;

          const updated = await tx.clientLocation.update({
            where: { id },
            data: {
              ...data,
              updatedBy: userId,
            },
          });

          results.push(updated);
        } catch (error) {
          errors.push({
            id: update.id,
            error: error.message,
          });
        }
      }
    });

    await this.invalidateCache();

    if (results.length === 0 && errors.length > 0) {
      throw new BadRequestException(errors[0].error);
    }

    return {
      success: results.length,
      failed: errors.length,
      results,
      errors,
    };
  }

  async bulkDelete(dto: BulkDeleteClientLocationDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    for (const id of dto.ids) {
      try {
        await this.delete(id, userId);
        results.push(id);
      } catch (error) {
        errors.push({
          id,
          error: error.message,
        });
      }
    }

    await this.invalidateCache();

    return {
      success: results.length,
      failed: errors.length,
      deletedIds: results,
      errors,
    };
  }

  private shouldProcessInBackground(file?: Express.Multer.File) {
    return !!file?.size && file.size >= this.BACKGROUND_UPLOAD_BYTES;
  }

  private getUploadConfig() {
    return {
      columnMapping: {
        locationNo: ['locationno', 'locationnumber', 'no', 'number'],
        locationName: ['locationname', 'name', 'lname', 'location'],
        locationCode: ['locationcode', 'code', 'lcode'],
        clientGroupName: ['clientgroupname', 'clientgroup', 'groupname'],
        companyName: [
          'companyname',
          'clientcompanyname',
          'company',
          'clientcompany',
        ],
        address: [
          'address',
          'physicaladdress',
          'street',
          'locationaddress',
          'addr',
        ],
        status: ['status', 'state', 'active'],
        remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
      },
      requiredColumns: ['locationName', 'locationCode'],
    };
  }

  private async parseAndProcessUpload(file: Express.Multer.File) {
    const { columnMapping, requiredColumns } = this.getUploadConfig();

    const { data, errors: parseErrors } =
      await this.excelUploadService.parseFile<any>(
        file,
        columnMapping,
        requiredColumns,
      );

    if (data.length === 0) {
      throw new BadRequestException(
        'No valid data found to import. Please check file format and column names.',
      );
    }

    // 1. Resolve all companyNames and clientGroupNames
    const companyNames = Array.from(
      new Set(
        data.filter((row) => row.companyName).map((row) => row.companyName),
      ),
    );
    const clientGroupNames = Array.from(
      new Set(
        data
          .filter((row) => row.clientGroupName)
          .map((row) => row.clientGroupName),
      ),
    );

    const [companies, clientGroups] = await Promise.all([
      this.prisma.clientCompany.findMany({
        where: { companyName: { in: companyNames } },
        select: { id: true, companyName: true, groupId: true },
      }),
      this.prisma.clientGroup.findMany({
        where: { groupName: { in: clientGroupNames } },
        select: { id: true, groupName: true },
      }),
    ]);

    const companyMap = new Map(
      companies.map((c) => [c.companyName.toLowerCase(), c]),
    );
    const groupMap = new Map(
      clientGroups.map((g) => [g.groupName.toLowerCase(), g.id]),
    );

    // 2. Build processing data
    const processedData: CreateClientLocationDto[] = [];
    const processingErrors: any[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const status = row.status
          ? this.excelUploadService.validateEnum(
              row.status as string,
              LocationStatus,
              'Status',
            )
          : LocationStatus.Active;

        let companyId: string | undefined;
        let clientGroupId: string | undefined;

        if (row.companyName) {
          const company = companyMap.get(row.companyName.toLowerCase());
          if (!company)
            throw new Error(`Client Company not found: ${row.companyName}`);
          companyId = company.id;
          clientGroupId = company.groupId;
        }

        if (row.clientGroupName) {
          const gid = groupMap.get(row.clientGroupName.toLowerCase());
          if (!gid)
            throw new Error(`Client Group not found: ${row.clientGroupName}`);

          if (clientGroupId && clientGroupId !== gid) {
            throw new Error(
              `Company "${row.companyName}" does not belong to Group "${row.clientGroupName}"`,
            );
          }
          clientGroupId = gid;
        }

        if (!clientGroupId) {
          throw new Error(
            `Either "Company Name" or "Client Group Name" is required to resolve Client Group`,
          );
        }

        if (!companyId) {
          throw new Error(`Company Name is required to resolve Company ID`);
        }

        processedData.push({
          locationNo: row.locationNo,
          locationName: row.locationName,
          locationCode: row.locationCode,
          clientGroupId: clientGroupId,
          companyId: companyId,
          address: row.address,
          status: status as LocationStatus,
          remark: row.remark,
        });
      } catch (err) {
        processingErrors.push({ row: i + 2, error: err.message });
      }
    }

    if (processedData.length === 0 && processingErrors.length > 0) {
      throw new BadRequestException(
        `Validation Failed: ${processingErrors[0].error}`,
      );
    }

    return { processedData, parseErrors, processingErrors };
  }

  private async processUploadStreaming(
    file: Express.Multer.File,
    userId: string,
  ) {
    const { columnMapping, requiredColumns } = this.getUploadConfig();

    const companyNames = new Set<string>();
    const clientGroupNames = new Set<string>();

    try {
      await this.excelUploadService.streamFileInBatches<any>(
        file,
        columnMapping,
        requiredColumns,
        2000,
        async (batch) => {
          for (const item of batch) {
            const row = item.data;
            if (row.companyName) {
              companyNames.add(String(row.companyName).trim());
            }
            if (row.clientGroupName) {
              clientGroupNames.add(String(row.clientGroupName).trim());
            }
          }
        },
        { cleanup: false },
      );
    } catch (error) {
      if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }
      throw error;
    }

    const [companies, clientGroups] = await Promise.all([
      companyNames.size > 0
        ? this.prisma.clientCompany.findMany({
            where: { companyName: { in: Array.from(companyNames) } },
            select: { id: true, companyName: true, groupId: true },
          })
        : [],
      clientGroupNames.size > 0
        ? this.prisma.clientGroup.findMany({
            where: { groupName: { in: Array.from(clientGroupNames) } },
            select: { id: true, groupName: true },
          })
        : [],
    ]);

    const companyMap = new Map(
      companies.map((c) => [c.companyName.toLowerCase(), c] as [string, any]),
    );
    const groupMap = new Map(
      clientGroups.map(
        (g) => [g.groupName.toLowerCase(), g.id] as [string, string],
      ),
    );

    let totalInserted = 0;
    let totalFailed = 0;
    const errors: any[] = [];

    const { errors: parseErrors, processed } =
      await this.excelUploadService.streamFileInBatches<any>(
        file,
        columnMapping,
        requiredColumns,
        1000,
        async (batch) => {
          const toInsert: CreateClientLocationDto[] = [];

          for (const item of batch) {
            const row = item.data;
            try {
              const status = row.status
                ? this.excelUploadService.validateEnum(
                    String(row.status),
                    LocationStatus,
                    'Status',
                  )
                : LocationStatus.Active;

              let companyId: string | undefined;
              let clientGroupId: string | undefined;

              if (row.companyName) {
                const company = companyMap.get(
                  String(row.companyName).toLowerCase(),
                );
                if (!company)
                  throw new Error(
                    `Client Company not found: ${row.companyName}`,
                  );
                companyId = company.id;
                clientGroupId = company.groupId;
              }

              if (row.clientGroupName) {
                const gid = groupMap.get(
                  String(row.clientGroupName).toLowerCase(),
                );
                if (!gid)
                  throw new Error(
                    `Client Group not found: ${row.clientGroupName}`,
                  );

                if (clientGroupId && clientGroupId !== gid) {
                  throw new Error(
                    `Company "${row.companyName}" does not belong to Group "${row.clientGroupName}"`,
                  );
                }
                clientGroupId = gid;
              }

              if (!clientGroupId) {
                throw new Error(
                  `Either "Company Name" or "Client Group Name" is required to resolve Client Group`,
                );
              }

              if (!companyId) {
                throw new Error(
                  `Company Name is required to resolve Company ID`,
                );
              }

              toInsert.push({
                locationNo: row.locationNo,
                locationName: row.locationName,
                locationCode: row.locationCode,
                clientGroupId: clientGroupId,
                companyId: companyId,
                address: row.address,
                status: status as LocationStatus,
                remark: row.remark,
              });
            } catch (err) {
              totalFailed += 1;
              errors.push({ row: item.rowNumber, error: err.message });
            }
          }

          if (toInsert.length > 0) {
            const result = await this.bulkCreate(
              { locations: toInsert },
              userId,
            );
            totalInserted += result.success || 0;
            totalFailed += result.failed || 0;
            if (result.errors?.length) {
              errors.push(...result.errors);
            }
          }
        },
      );

    totalFailed += parseErrors.length;
    if (parseErrors.length > 0) {
      errors.push(...parseErrors);
    }

    return {
      success: totalInserted,
      failed: totalFailed || Math.max(0, processed - totalInserted),
      errors,
    };
  }

  async uploadExcel(file: Express.Multer.File, userId: string) {
    this.logger.log(
      `[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`,
    );

    if (this.shouldProcessInBackground(file)) {
      const fileName = file?.originalname || 'upload.xlsx';
      const job = await this.uploadJobService.createJob({
        module: 'client-location',
        fileName,
        userId,
      });
      this.eventEmitter.emit('client-location.bulk-upload', {
        file,
        userId,
        fileName,
        jobId: job.jobId,
      });

      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return {
        message: `Large file (${sizeMb} MB) is being processed in the background. You will be notified once completed.`,
        isBackground: true,
        totalRecords: null,
        jobId: job.jobId,
      };
    }

    const { processedData, parseErrors, processingErrors } =
      await this.parseAndProcessUpload(file);

    // --- BACKGROUND PROCESSING TRIGGER ---
    if (processedData.length > 500) {
      const job = await this.uploadJobService.createJob({
        module: 'client-location',
        fileName: file.originalname,
        userId,
      });
      this.eventEmitter.emit('client-location.bulk-upload', {
        data: processedData,
        userId,
        fileName: file.originalname,
        jobId: job.jobId,
      });

      return {
        message: `Large file (${processedData.length} records) is being processed in the background. You will be notified once completed.`,
        isBackground: true,
        totalRecords: processedData.length,
        jobId: job.jobId,
      };
    }

    const result = await this.bulkCreate({ locations: processedData }, userId);

    result.errors = [
      ...(result.errors || []),
      ...parseErrors,
      ...processingErrors,
    ];
    result.failed += parseErrors.length + processingErrors.length;

    return result;
  }

  @OnEvent('client-location.bulk-upload')
  async handleBackgroundUpload(payload: {
    data?: any[];
    file?: Express.Multer.File;
    userId: string;
    fileName: string;
    jobId?: string;
  }) {
    const { data: providedData, file, userId, fileName, jobId } = payload;
    this.logger.log(
      `[BACKGROUND_UPLOAD] Starting background upload for ${providedData?.length || 'file'} from ${fileName}`,
    );

    try {
      if (jobId) {
        await this.uploadJobService.markProcessing(jobId);
      }

      let totalSuccess = 0;
      let totalFailed = 0;

      if (file) {
        const result = await this.processUploadStreaming(file, userId);
        totalSuccess = result.success;
        totalFailed = result.failed;
      } else if (providedData && providedData.length > 0) {
        const result = await this.bulkCreate(
          { locations: providedData },
          userId,
        );
        totalSuccess = result.success;
        totalFailed = result.failed;
      } else {
        throw new Error('No valid data found to import.');
      }

      await this.notificationService.createNotification(userId, {
        title: 'Client Location Import Completed',
        description: `Successfully imported ${totalSuccess} client locations from ${fileName}. Failed: ${totalFailed}`,
        type: 'SYSTEM',
        metadata: {
          fileName,
          success: totalSuccess,
          failed: totalFailed,
        },
      });

      if (jobId) {
        await this.uploadJobService.markCompleted(jobId, {
          success: totalSuccess,
          failed: totalFailed,
          message: `Successfully imported ${totalSuccess} client locations.`,
        });
      }

      this.logger.log(
        `[BACKGROUND_UPLOAD_COMPLETED] Success: ${totalSuccess}, Failed: ${totalFailed}`,
      );
    } catch (error) {
      this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
      await this.notificationService.createNotification(userId, {
        title: 'Client Location Import Failed',
        description: `Background import for ${fileName} failed: ${error.message}`,
        type: 'SYSTEM',
        metadata: { fileName, error: error.message },
      });

      if (jobId) {
        await this.uploadJobService.markFailed(jobId, error.message);
      }
    }
  }

  private async invalidateCache() {
    await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:*`);
  }

  private async logAudit(
    userId: string,
    action: string,
    entityId: string,
    oldValue: any,
    newValue: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        teamId: userId,
        action,
        entity: 'ClientLocation',
        entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: '',
      },
    });
  }
}
