import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import {
  CreateClientGroupDto,
  UpdateClientGroupDto,
  BulkCreateClientGroupDto,
  BulkUpdateClientGroupDto,
  BulkDeleteClientGroupDto,
  ChangeStatusDto,
  FilterClientGroupDto,
} from './dto/client-group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AutoNumberService } from '../common/services/auto-number.service';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { ClientGroupStatus, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';
import { ExcelUploadService } from '../common/services/excel-upload.service';
import { ExcelDownloadService } from '../common/services/excel-download.service';
import { UploadJobService } from '../common/services/upload-job.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ClientGroupService {
  private readonly logger = new Logger(ClientGroupService.name);
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_KEY = 'client_groups';
  private readonly BACKGROUND_UPLOAD_BYTES: number;

  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private configService: ConfigService,
    private autoNumberService: AutoNumberService,
    private excelUploadService: ExcelUploadService,
    private excelDownloadService: ExcelDownloadService,
    private uploadJobService: UploadJobService,
    private eventEmitter: EventEmitter2,
    private notificationService: NotificationService,
  ) {
    const configuredBytes = Number(
      this.configService.get(
        'EXCEL_BACKGROUND_THRESHOLD_BYTES',
        1 * 1024 * 1024,
      ),
    );
    this.BACKGROUND_UPLOAD_BYTES = Number.isFinite(configuredBytes)
      ? configuredBytes
      : 1 * 1024 * 1024;
  }

  async create(dto: CreateClientGroupDto, userId: string) {
    // Transform groupCode to uppercase
    const groupCodeUpper = dto.groupCode.toUpperCase();

    // Check for duplicate group code
    const existing = await this.prisma.clientGroup.findUnique({
      where: { groupCode: groupCodeUpper },
    });

    if (existing) {
      throw new ConflictException('Group code already exists');
    }

    // Generate Group Number
    const generatedGroupNo =
      await this.autoNumberService.generateClientGroupNo();
    const { toTitleCase } = await import('../common/utils/string-helper');

    const clientGroup = await this.prisma.clientGroup.create({
      data: {
        ...dto,
        groupCode: groupCodeUpper,
        groupName: toTitleCase(dto.groupName),
        country: toTitleCase(dto.country),
        groupNo: dto.groupNo || generatedGroupNo,
        remark: dto.remark ? toTitleCase(dto.remark) : undefined,
        status: dto.status || ClientGroupStatus.Active,
        createdBy: userId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'CREATE', clientGroup.id, null, clientGroup);

    return clientGroup;
  }

  async findAll(pagination: PaginationDto, filter?: FilterClientGroupDto) {
    const {
      page = 1,
      limit = 25,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = pagination;
    const skip = (page - 1) * limit;

    const cleanedSearch = search?.trim();
    const where: Prisma.ClientGroupWhereInput = {
      AND: [],
    };

    const andArray = where.AND as Array<Prisma.ClientGroupWhereInput>;
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Map frontend sort fields to Prisma orderBy
    // Note: ClientGroup doesn't have direct relations to subLocation, company, location
    // So we can't sort by those fields - default to createdAt instead
    let orderBy: any;
    if (sortBy === 'subLocationName' || sortBy === 'companyName' || sortBy === 'locationName') {
      // These fields don't exist in ClientGroup, fallback to default
      orderBy = { createdAt: sortOrder };
    } else {
      // Check if field exists on ClientGroup model, otherwise fallback to createdAt
      const validFields = ['id', 'groupNo', 'groupName', 'groupCode', 'country', 'status', 'remark', 'createdAt', 'updatedAt'];
      if (validFields.includes(sortBy)) {
        orderBy = { [sortBy]: sortOrder };
      } else {
        orderBy = { createdAt: sortOrder };
      }
    }

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
        andArray.push({ status: { in: statusValues as any } });
      }
    }

    if (filter?.country)
      andArray.push(
        buildMultiValueFilter('country', toTitleCase(filter.country)),
      );
    if (filter?.groupName)
      andArray.push(
        buildMultiValueFilter('groupName', toTitleCase(filter.groupName)),
      );
    if (filter?.groupNo)
      andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
    if (filter?.groupCode)
      andArray.push(buildMultiValueFilter('groupCode', filter.groupCode));
    if (filter?.remark)
      andArray.push(
        buildMultiValueFilter('remark', toTitleCase(filter.remark)),
      );

    if (cleanedSearch) {
      const searchValues = cleanedSearch
        .split(/[,\:;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const allSearchConditions: Prisma.ClientGroupWhereInput[] = [];

      for (const val of searchValues) {
        const searchLower = val.toLowerCase();
        const searchTitle = toTitleCase(val);

        // Check if value looks like a code (contains hyphen or is alphanumeric with specific pattern)
        const looksLikeCode =
          /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

        if (looksLikeCode) {
          // For code-like values, use exact match OR contains for flexibility
          allSearchConditions.push({
            groupCode: { equals: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupNo: { equals: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupCode: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupNo: { contains: val, mode: 'insensitive' },
          });
        } else {
          // For text values, use contains
          allSearchConditions.push({
            groupName: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupName: { contains: searchTitle, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupCode: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            groupNo: { contains: val, mode: 'insensitive' },
          });
        }

        // Always search in country and remark
        allSearchConditions.push({
          country: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          country: { contains: searchTitle, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: searchTitle, mode: 'insensitive' },
        });

        // Add status-based exact match conditions
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
        this.logger.log(`[CACHE_HIT] ClientGroup List - ${cacheKey}`);
        return cached;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.clientGroup.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: orderBy,
        select: {
          id: true,
          groupNo: true,
          groupName: true,
          groupCode: true,
          country: true,
          status: true,
          remark: true,
          createdAt: true,
          _count: {
            select: { companies: true, teams: true },
          },
          teams: {
            select: {
              email: true,
            },
          },
        },
      }),
      this.prisma.clientGroup.count({ where }),
    ]);

    const response = new PaginatedResponse(data, total, page, limit);

    if (isCacheable) {
      await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
      this.logger.log(
        `[CACHE_MISS] ClientGroup List - Cached result: ${cacheKey}`,
      );
    }

    return response;
  }

  async downloadExcel(query: any, userId: string, res: any) {
    const page = Number(query.pageIndex) || 1;
    const limit = Number(query.pageSize) || 1000000;
    const { data } = await this.findAll({ page, limit }, query);

    const formatDate = (date: any) => {
      if (!date) return '-';
      const d = new Date(date);
      if (isNaN(d.getTime())) return '-';
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${minutes}`;
    };

    const mappedData = data.map((item: any, index) => ({
      srNo: index + 1,
      groupNo: item.groupNo,
      groupName: item.groupName,
      groupCode: item.groupCode,
      country: item.country,
      status: item.status,
      remark: item.remark || '',
    }));

    const columns = [
      { header: '#', key: 'srNo', width: 10 },
      { header: 'Group No.', key: 'groupNo', width: 15 },
      { header: 'Client Group', key: 'groupName', width: 25 },
      { header: 'Group Code', key: 'groupCode', width: 15 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Remark', key: 'remark', width: 30 },
    ];

    await this.excelDownloadService.downloadExcel(
      res,
      mappedData,
      columns,
      'client_groups.xlsx',
      'Client Groups',
    );
  }

  async findActive(pagination: PaginationDto) {
    const filter: FilterClientGroupDto = { status: ClientGroupStatus.Active };
    return this.findAll(pagination, filter);
  }

  async findById(id: string) {
    const clientGroup = await this.prisma.clientGroup.findFirst({
      where: { id },
      include: {
        creator: {
          select: { id: true, teamName: true, email: true },
        },
        updater: {
          select: { id: true, teamName: true, email: true },
        },
      },
    });

    if (!clientGroup) {
      throw new NotFoundException('Client group not found');
    }

    return clientGroup;
  }

  async findByGroupCode(groupCode: string) {
    const clientGroup = await this.prisma.clientGroup.findFirst({
      where: { groupCode },
    });

    if (!clientGroup) {
      throw new NotFoundException('Client group not found');
    }

    return clientGroup;
  }

  async update(id: string, dto: UpdateClientGroupDto, userId: string) {
    const existing = await this.findById(id);
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Transform groupCode to uppercase if provided
    const groupCodeUpper = dto.groupCode
      ? dto.groupCode.toUpperCase()
      : undefined;

    // Check for duplicate group code if being updated
    if (groupCodeUpper && groupCodeUpper !== existing.groupCode) {
      const duplicate = await this.prisma.clientGroup.findUnique({
        where: { groupCode: groupCodeUpper },
      });

      if (duplicate) {
        throw new ConflictException('Group code already exists');
      }
    }

    const updated = await this.prisma.clientGroup.update({
      where: { id },
      data: {
        ...dto,
        groupCode: groupCodeUpper,
        groupName: dto.groupName ? toTitleCase(dto.groupName) : undefined,
        country: dto.country ? toTitleCase(dto.country) : undefined,
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

    const updated = await this.prisma.clientGroup.update({
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
    const clientGroup = await this.prisma.clientGroup.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            companies: true,
            locations: true,
            subLocations: true,
            projects: true,
            teams: true,
            ipAddresses: true,
          },
        },
      },
    });

    if (!clientGroup) {
      throw new NotFoundException('Client group not found');
    }

    const { _count } = clientGroup;
    const childCounts = [
      _count.companies > 0 && `${_count.companies} companies`,
      _count.locations > 0 && `${_count.locations} locations`,
      _count.subLocations > 0 && `${_count.subLocations} sub-locations`,
      _count.projects > 0 && `${_count.projects} projects`,
      _count.teams > 0 && `${_count.teams} teams`,
      _count.ipAddresses > 0 && `${_count.ipAddresses} IP addresses`,
    ].filter(Boolean);

    if (childCounts.length > 0) {
      throw new BadRequestException(
        `Cannot delete Client Group because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`,
      );
    }

    await this.prisma.clientGroup.delete({
      where: { id },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'HARD_DELETE', id, clientGroup, null);

    return { message: 'Client group deleted successfully' };
  }

  async bulkCreate(dto: BulkCreateClientGroupDto, userId: string) {
    this.logger.log(
      `[BULK_CREATE_FAST] Starting for ${dto.clientGroups.length} records`,
    );
    const { toTitleCase } = await import('../common/utils/string-helper');

    const errors: any[] = [];

    const prefix = this.configService.get('CG_NUMBER_PREFIX', 'CG-');
    const startNo = await this.autoNumberService.generateClientGroupNo();
    let currentNum = parseInt(
      startNo.replace(new RegExp(`^${prefix}`, 'i'), ''),
    );
    if (isNaN(currentNum)) currentNum = 11001;

    const BATCH_SIZE = 1000;
    const dataToInsert: any[] = [];
    const metaToInsert: Array<{
      rowNumber?: number;
      groupCode: string;
      groupNo: string;
    }> = [];

    // Optimization 1: Batch check for groupCode duplicates
    const providedCodes = dto.clientGroups
      .map((g) => g.groupCode?.toUpperCase())
      .filter(Boolean);
    const existingCodes = new Set<string>();
    if (providedCodes.length > 0) {
      const codeChunks = this.excelUploadService.chunk(providedCodes, 5000);
      for (const chunk of codeChunks) {
        const results = await this.prisma.clientGroup.findMany({
          where: { groupCode: { in: chunk } },
          select: { groupCode: true },
        });
        results.forEach((r) => existingCodes.add(r.groupCode));
      }
    }

    // Optimization 2: Batch check for groupNo duplicates
    const providedNos = dto.clientGroups.map((g) => g.groupNo).filter(Boolean);
    const existingNos = new Set<string>();
    if (providedNos.length > 0) {
      const noChunks = this.excelUploadService.chunk(providedNos, 5000);
      for (const chunk of noChunks) {
        const results = await this.prisma.clientGroup.findMany({
          where: { groupNo: { in: chunk as string[] } },
          select: { groupNo: true },
        });
        results.forEach((r) => existingNos.add(r.groupNo));
      }
    }

    // 2. Pre-process and validate in memory
    for (const clientGroupDto of dto.clientGroups) {
      try {
        const { _rowNumber, ...payload } = clientGroupDto as any;
        const groupName = toTitleCase(
          payload.groupName?.trim() ||
          payload.groupCode ||
          'Unnamed Group',
        );
        const country = payload.country
          ? toTitleCase(payload.country)
          : 'Unknown';
        const remark = payload.remark
          ? toTitleCase(payload.remark)
          : undefined;

        // Unique Code Logic
        let finalGroupCode =
          payload.groupCode?.trim()?.toUpperCase() ||
          `GC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        if (existingCodes.has(finalGroupCode)) {
          let suffix = 1;
          const originalCode = finalGroupCode;
          while (existingCodes.has(`${originalCode}-${suffix}`)) {
            suffix++;
          }
          finalGroupCode = `${originalCode}-${suffix}`;
        }
        existingCodes.add(finalGroupCode);

        // Unique Number Logic
        let finalGroupNo = payload.groupNo?.trim();
        if (!finalGroupNo || existingNos.has(finalGroupNo)) {
          finalGroupNo = `${prefix}${currentNum}`;
          currentNum++;
        }
        existingNos.add(finalGroupNo);

        dataToInsert.push({
          ...payload,
          groupName,
          country,
          remark,
          groupCode: finalGroupCode,
          groupNo: finalGroupNo,
          status: payload.status || ClientGroupStatus.Active,
          createdBy: userId,
        });
        metaToInsert.push({
          rowNumber: _rowNumber,
          groupCode: finalGroupCode,
          groupNo: finalGroupNo,
        });
      } catch (err) {
        errors.push({
          groupCode: clientGroupDto.groupCode,
          error: err.message,
        });
      }
    }

    // 2.5 Check existing duplicates in DB and skip them with proper error info
    const codesToCheck = metaToInsert
      .map((m) => m.groupCode)
      .filter(Boolean);
    const nosToCheck = metaToInsert.map((m) => m.groupNo).filter(Boolean);

    if (codesToCheck.length > 0 || nosToCheck.length > 0) {
      const existing = await this.prisma.clientGroup.findMany({
        where: {
          OR: [
            codesToCheck.length > 0
              ? { groupCode: { in: codesToCheck } }
              : undefined,
            nosToCheck.length > 0 ? { groupNo: { in: nosToCheck } } : undefined,
          ].filter(Boolean) as any,
        },
        select: { groupCode: true, groupNo: true },
      });

      const existingCodeSet = new Set(
        existing.map((item) => item.groupCode),
      );
      const existingNoSet = new Set(existing.map((item) => item.groupNo));

      for (let i = 0; i < dataToInsert.length; i++) {
        const meta = metaToInsert[i];
        const dupCode =
          !!meta.groupCode && existingCodeSet.has(meta.groupCode);
        const dupNo = !!meta.groupNo && existingNoSet.has(meta.groupNo);

        if (!dupCode && !dupNo) continue;

        const originalCode = meta.groupCode;
        const originalNo = meta.groupNo;
        let updated = false;

        if (dupCode) {
          let suffix = 1;
          let newCode = originalCode;
          while (existingCodes.has(newCode) || existingCodeSet.has(newCode)) {
            newCode = `${originalCode}-${suffix}`;
            suffix++;
          }
          existingCodes.add(newCode);
          dataToInsert[i].groupCode = newCode;
          metaToInsert[i].groupCode = newCode;
          updated = true;
        }

        if (dupNo) {
          let newNo = `${prefix}${currentNum}`;
          while (existingNos.has(newNo) || existingNoSet.has(newNo)) {
            currentNum++;
            newNo = `${prefix}${currentNum}`;
          }
          currentNum++;
          existingNos.add(newNo);
          dataToInsert[i].groupNo = newNo;
          metaToInsert[i].groupNo = newNo;
          updated = true;
        }

        if (updated) {
          errors.push({
            row: meta.rowNumber,
            groupCode: originalCode,
            groupNo: originalNo,
            newGroupCode: metaToInsert[i].groupCode,
            newGroupNo: metaToInsert[i].groupNo,
            error:
              dupCode && dupNo
                ? 'Duplicate groupCode and groupNo (auto-adjusted)'
                : dupCode
                  ? 'Duplicate groupCode (auto-adjusted)'
                  : 'Duplicate groupNo (auto-adjusted)',
          });
        }
      }
    }

    // 3. Batched Inserts using createMany
    const chunks: any[][] = [];
    for (let i = 0; i < dataToInsert.length; i += BATCH_SIZE) {
      chunks.push(dataToInsert.slice(i, i + BATCH_SIZE));
    }

    let totalInserted = 0;
    for (const chunk of chunks) {
      try {
        const result = await this.prisma.clientGroup.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        totalInserted += result.count;
        if (result.count !== chunk.length) {
          const skipped = chunk.length - result.count;
          errors.push({
            error: `Skipped ${skipped} records due to duplicate constraints (race condition)`,
          });
        }
      } catch (err) {
        this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
        errors.push({ error: 'Batch insert failed', details: err.message });
      }
    }

    this.logger.log(
      `[BULK_CREATE_COMPLETED] Processed: ${dto.clientGroups.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`,
    );

    if (errors.length > 0) {
      this.logger.warn(
        `[BULK_CREATE_ERRORS] ${errors.length} errors. Sample: ${JSON.stringify(
          errors.slice(0, 5),
        )}`,
      );
    }

    await this.invalidateCache();

    return {
      success: totalInserted,
      failed: dto.clientGroups.length - totalInserted,
      message: `Successfully inserted ${totalInserted} records.`,
      errors,
      errorsDetail: errors,
    };
  }

  async bulkUpdate(dto: BulkUpdateClientGroupDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const update of dto.updates) {
        try {
          const { id, ...data } = update;

          const updated = await tx.clientGroup.update({
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

    return {
      success: results.length,
      failed: errors.length,
      results,
      errors,
    };
  }

  async bulkDelete(dto: BulkDeleteClientGroupDto, userId: string) {
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

    if (results.length === 0 && errors.length > 0) {
      throw new BadRequestException(errors[0].error);
    }

    return {
      success: results.length,
      failed: errors.length,
      deletedIds: results,
      errors,
    };
  }

  private getUploadConfig() {
    return {
      columnMapping: {
        groupNo: ['groupno', 'groupnumber', 'no', 'number'],
        groupName: ['groupname', 'name', 'gname', 'group'],
        groupCode: ['groupcode', 'code', 'gcode', 'groupcode'],
        country: ['country', 'location'],
        status: ['status'],
        remark: ['remark', 'remarks', 'notes', 'description'],
      },
      requiredColumns: ['groupName', 'groupCode'],
    };
  }

  private shouldProcessInBackground(file?: Express.Multer.File) {
    return !!file?.size && file.size >= this.BACKGROUND_UPLOAD_BYTES;
  }

  private async parseAndProcessUpload(file: Express.Multer.File) {
    const { columnMapping, requiredColumns } = this.getUploadConfig();
    const parseResult = await this.excelUploadService.parseFile(
      file,
      columnMapping,
      requiredColumns,
    );
    const data = parseResult.data as any[];
    const parseErrors = parseResult.errors;

    if (parseErrors.length > 0) {
      this.logger.warn(
        `[UPLOAD_PARSE_ERRORS] ${parseErrors.length} parse errors. Sample: ${JSON.stringify(
          parseErrors.slice(0, 5),
        )}`,
      );
    }

    if (data.length === 0) {
      throw new BadRequestException(
        'No valid data found to import. Please check file format and column names.',
      );
    }

    const processedData: Array<CreateClientGroupDto & { _rowNumber?: number }> =
      [];
    const processingErrors: any[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const status = row.status
          ? this.excelUploadService.validateEnum(
            String(row.status),
            ClientGroupStatus,
            'Status',
          )
          : ClientGroupStatus.Active;

        processedData.push({
          ...row,
          status: status as ClientGroupStatus,
          _rowNumber: i + 2,
        });
      } catch (err) {
        processingErrors.push({ row: i + 2, error: err.message });
      }
    }

    if (processingErrors.length > 0) {
      this.logger.warn(
        `[UPLOAD_PROCESSING_ERRORS] ${processingErrors.length} validation errors. Sample: ${JSON.stringify(
          processingErrors.slice(0, 5),
        )}`,
      );
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
          const toInsert: Array<
            CreateClientGroupDto & { _rowNumber?: number }
          > = [];

          for (const item of batch) {
            const row = item.data;
            try {
              const status = row.status
                ? this.excelUploadService.validateEnum(
                  String(row.status),
                  ClientGroupStatus,
                  'Status',
                )
                : ClientGroupStatus.Active;

              toInsert.push({
                ...row,
                status: status as ClientGroupStatus,
                _rowNumber: item.rowNumber,
              });
            } catch (err) {
              totalFailed += 1;
              errors.push({ row: item.rowNumber, error: err.message });
            }
          }

          if (toInsert.length > 0) {
            const result = await this.bulkCreate(
              { clientGroups: toInsert },
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

    if (errors.length > 0) {
      this.logger.warn(
        `[UPLOAD_STREAMING_ERRORS] ${errors.length} errors. Sample: ${JSON.stringify(
          errors.slice(0, 5),
        )}`,
      );
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
        module: 'client-group',
        fileName,
        userId,
      });
      this.eventEmitter.emit('client-group.bulk-upload', {
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
        module: 'client-group',
        fileName: file.originalname,
        userId,
      });
      this.eventEmitter.emit('client-group.bulk-upload', {
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

    const result = await this.bulkCreate(
      { clientGroups: processedData },
      userId,
    );

    // Merge parse errors and processing errors into result
    result.errors = [
      ...(result.errors || []),
      ...parseErrors,
      ...processingErrors,
    ];
    result.failed += parseErrors.length + processingErrors.length;

    return result;
  }

  @OnEvent('client-group.bulk-upload')
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
      let errorsDetail: any[] = [];

      if (file) {
        const result = await this.processUploadStreaming(file, userId);
        totalSuccess = result.success;
        totalFailed = result.failed;
        errorsDetail = result.errors || [];
      } else if (providedData && providedData.length > 0) {
        const result = await this.bulkCreate(
          { clientGroups: providedData },
          userId,
        );
        totalSuccess = result.success;
        totalFailed = result.failed;
        errorsDetail = result.errors || [];
      } else {
        throw new Error('No valid data found to import.');
      }

      await this.notificationService.createNotification(userId, {
        title: 'Client Group Import Completed',
        description: `Successfully imported ${totalSuccess} client groups from ${fileName}. Failed: ${totalFailed}`,
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
          message: `Successfully imported ${totalSuccess} client groups.`,
          errors: errorsDetail,
        });
      }

      this.logger.log(
        `[BACKGROUND_UPLOAD_COMPLETED] Success: ${totalSuccess}, Failed: ${totalFailed}`,
      );
    } catch (error) {
      this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
      await this.notificationService.createNotification(userId, {
        title: 'Client Group Import Failed',
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
        entity: 'ClientGroup',
        entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: '',
      },
    });
  }
}
