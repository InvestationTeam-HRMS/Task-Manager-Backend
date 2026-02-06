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
import {
  CreateGroupDto,
  UpdateGroupDto,
  BulkCreateGroupDto,
  BulkUpdateGroupDto,
  BulkDeleteGroupDto,
  ChangeStatusDto,
  FilterGroupDto,
} from './dto/group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { GroupStatus, Prisma } from '@prisma/client';

import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);
  private readonly CACHE_TTL = 300;
  private readonly CACHE_KEY = 'groups';
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

  async create(dto: CreateGroupDto, userId: string) {
    const { toTitleCase } = await import('../common/utils/string-helper');

    const existing = await this.prisma.group.findFirst({
      where: { groupName: toTitleCase(dto.groupName) },
    });

    if (existing) {
      throw new ConflictException('Group name already exists');
    }

    const groupNo = await this.autoNumberService.generateGroupNo();

    // Extract teamMemberIds from dto (not a Prisma field)
    const { teamMemberIds, ...groupData } = dto;

    const group = await this.prisma.group.create({
      data: {
        ...groupData,
        groupName: toTitleCase(dto.groupName),
        groupNo: dto.groupNo || groupNo,
        status: dto.status || GroupStatus.Active,
        createdBy: userId,
      },
    });

    // Create GroupMember entries if teamMemberIds provided
    if (teamMemberIds && teamMemberIds.length > 0) {
      await this.prisma.groupMember.createMany({
        data: teamMemberIds.map((memberId) => ({
          groupId: group.id,
          userId: memberId,
          role: 'MEMBER',
        })),
        skipDuplicates: true,
      });
    }

    await this.invalidateCache();
    await this.logAudit(userId, 'CREATE', group.id, null, group);

    return group;
  }

  async findAll(pagination: PaginationDto, filter?: FilterGroupDto) {
    const {
      page = 1,
      limit = 25,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = pagination;
    const skip = (page - 1) * limit;

    const cleanedSearch = search?.trim();
    const where: Prisma.GroupWhereInput = {
      AND: [],
    };

    const andArray = where.AND as Array<Prisma.GroupWhereInput>;
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Handle Status Filter
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

    if (filter?.groupName)
      andArray.push(
        buildMultiValueFilter('groupName', toTitleCase(filter.groupName)),
      );
    if (filter?.groupNo)
      andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
    if (filter?.remark)
      andArray.push(
        buildMultiValueFilter('remark', toTitleCase(filter.remark)),
      );

    // Handle Array Filters (IDs)
    if (filter?.clientGroupIds && filter.clientGroupIds.length > 0) {
      andArray.push({ clientGroupIds: { hasSome: filter.clientGroupIds } });
    }
    if (filter?.companyIds && filter.companyIds.length > 0) {
      andArray.push({ companyIds: { hasSome: filter.companyIds } });
    }
    if (filter?.locationIds && filter.locationIds.length > 0) {
      andArray.push({ locationIds: { hasSome: filter.locationIds } });
    }
    if (filter?.subLocationIds && filter.subLocationIds.length > 0) {
      andArray.push({ subLocationIds: { hasSome: filter.subLocationIds } });
    }

    // Handle Text Filters for Related Entities
    if (filter?.companyName) {
      const companies = await this.prisma.clientCompany.findMany({
        where: {
          companyName: { contains: filter.companyName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      const companyIds = companies.map((c) => c.id);
      if (companyIds.length > 0) {
        andArray.push({ companyIds: { hasSome: companyIds } });
      } else {
        // Return empty if search term doesn't match any company but was provided
        andArray.push({ id: 'none' });
      }
    }

    if (filter?.locationName) {
      const locations = await this.prisma.clientLocation.findMany({
        where: {
          locationName: { contains: filter.locationName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      const locationIds = locations.map((l) => l.id);
      if (locationIds.length > 0) {
        andArray.push({ locationIds: { hasSome: locationIds } });
      } else {
        andArray.push({ id: 'none' });
      }
    }

    if (filter?.subLocationName) {
      const subLocations = await this.prisma.subLocation.findMany({
        where: {
          subLocationName: {
            contains: filter.subLocationName,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });
      const subLocationIds = subLocations.map((sl) => sl.id);
      if (subLocationIds.length > 0) {
        andArray.push({ subLocationIds: { hasSome: subLocationIds } });
      } else {
        andArray.push({ id: 'none' });
      }
    }

    if (filter?.teamMember) {
      const teams = await this.prisma.team.findMany({
        where: {
          OR: [
            { teamName: { contains: filter.teamMember, mode: 'insensitive' } },
            { email: { contains: filter.teamMember, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const teamIds = teams.map((t) => t.id);
      if (teamIds.length > 0) {
        andArray.push({
          members: {
            some: {
              userId: { in: teamIds },
            },
          },
        });
      } else {
        andArray.push({ id: 'none' });
      }
    }

    if (cleanedSearch) {
      const searchValues = cleanedSearch
        .split(/[,\:;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const allSearchConditions: Prisma.GroupWhereInput[] = [];

      for (const val of searchValues) {
        const searchLower = val.toLowerCase();
        const searchTitle = toTitleCase(val);

        allSearchConditions.push({
          groupName: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          groupName: { contains: searchTitle, mode: 'insensitive' },
        });
        allSearchConditions.push({
          groupNo: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: searchTitle, mode: 'insensitive' },
        });

        if ('active'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: GroupStatus.Active });
        }
        if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: GroupStatus.Inactive });
        }

        // Add deep search for members/related entities if needed
        // For performance, we limit this in search or keep it simple
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
        this.logger.log(`[CACHE_HIT] Group List - ${cacheKey}`);
        return cached;
      }
    }

    const [rawData, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          members: {
            include: {
              team: {
                select: {
                  id: true,
                  teamName: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: { pendingTasks: true, completedTasks: true },
          },
        },
      }),
      this.prisma.group.count({ where }),
    ]);

    // Collect all unique IDs to fetch names
    const allClientGroupIds = [
      ...new Set(rawData.flatMap((g) => g.clientGroupIds || [])),
    ];
    const allCompanyIds = [
      ...new Set(rawData.flatMap((g) => g.companyIds || [])),
    ];
    const allLocationIds = [
      ...new Set(rawData.flatMap((g) => g.locationIds || [])),
    ];
    const allSubLocationIds = [
      ...new Set(rawData.flatMap((g) => g.subLocationIds || [])),
    ];

    // Fetch all related entities in parallel
    const [clientGroups, companies, locations, subLocations] =
      await Promise.all([
        allClientGroupIds.length > 0
          ? this.prisma.clientGroup.findMany({
              where: { id: { in: allClientGroupIds } },
              select: { id: true, groupName: true },
            })
          : ([] as { id: string; groupName: string }[]),
        allCompanyIds.length > 0
          ? this.prisma.clientCompany.findMany({
              where: { id: { in: allCompanyIds } },
              select: { id: true, companyName: true },
            })
          : ([] as { id: string; companyName: string }[]),
        allLocationIds.length > 0
          ? this.prisma.clientLocation.findMany({
              where: { id: { in: allLocationIds } },
              select: { id: true, locationName: true },
            })
          : ([] as { id: string; locationName: string }[]),
        allSubLocationIds.length > 0
          ? this.prisma.subLocation.findMany({
              where: { id: { in: allSubLocationIds } },
              select: { id: true, subLocationName: true },
            })
          : ([] as { id: string; subLocationName: string }[]),
      ]);

    // Create lookup maps
    const clientGroupMap = new Map<string, string>();
    clientGroups.forEach((cg) => clientGroupMap.set(cg.id, cg.groupName));

    const companyMap = new Map<string, string>();
    companies.forEach((c) => companyMap.set(c.id, c.companyName));

    const locationMap = new Map<string, string>();
    locations.forEach((l) => locationMap.set(l.id, l.locationName));

    const subLocationMap = new Map<string, string>();
    subLocations.forEach((sl) => subLocationMap.set(sl.id, sl.subLocationName));

    // Add resolved names and teamMemberEmails to each group
    const data = rawData.map((group) => ({
      ...group,
      clientGroupName:
        (group.clientGroupIds || [])
          .map((id) => clientGroupMap.get(id))
          .filter(Boolean)
          .join(', ') || '-',
      companyName:
        (group.companyIds || [])
          .map((id) => companyMap.get(id))
          .filter(Boolean)
          .join(', ') || '-',
      locationName:
        (group.locationIds || [])
          .map((id) => locationMap.get(id))
          .filter(Boolean)
          .join(', ') || '-',
      subLocationName:
        (group.subLocationIds || [])
          .map((id) => subLocationMap.get(id))
          .filter(Boolean)
          .join(', ') || '-',
      teamMemberEmails:
        group.members
          .map((m) => m.team?.email)
          .filter(Boolean)
          .join(', ') || '-',
    }));

    const response = new PaginatedResponse(data, total, page, limit);

    if (isCacheable) {
      await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
      this.logger.log(`[CACHE_MISS] Group List - Cached result: ${cacheKey}`);
    }

    return response;
  }

  async downloadExcel(query: any, userId: string, res: any) {
    const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

    const mappedData = data.map((item, index) => ({
      srNo: index + 1,
      groupNo: item.groupNo,
      groupName: item.groupName,
      clientGroupName: item.clientGroupName || '',
      companyName: item.companyName || '',
      locationName: item.locationName || '',
      subLocationName: item.subLocationName || '',
      teamMemberEmails: item.teamMemberEmails || '',
      status: item.status,
      remark: item.remark || '',
    }));

    const columns = [
      { header: '#', key: 'srNo', width: 10 },
      { header: 'Group No', key: 'groupNo', width: 15 },
      { header: 'Group Name', key: 'groupName', width: 30 },
      { header: 'Client Group', key: 'clientGroupName', width: 30 },
      { header: 'Company', key: 'companyName', width: 30 },
      { header: 'Location', key: 'locationName', width: 30 },
      { header: 'Sublocation', key: 'subLocationName', width: 30 },
      { header: 'Team Members', key: 'teamMemberEmails', width: 50 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Remark', key: 'remark', width: 30 },
    ];

    await this.excelDownloadService.downloadExcel(
      res,
      mappedData,
      columns,
      'internal_groups.xlsx',
      'Internal Groups',
    );
  }

  async findActive(pagination: PaginationDto) {
    const filter: FilterGroupDto = { status: GroupStatus.Active };
    return this.findAll(pagination, filter);
  }

  async findMyGroups(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
        status: GroupStatus.Active,
      },
      include: {
        members: {
          include: {
            team: {
              select: {
                id: true,
                teamName: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    // Add teamMemberEmails field to each group
    return groups.map((group) => ({
      ...group,
      teamMemberEmails: group.members
        .map((m) => m.team?.email)
        .filter(Boolean)
        .join(', '),
    }));
  }

  async findById(id: string) {
    const group = await this.prisma.group.findFirst({
      where: { id },
      include: {
        members: {
          include: {
            team: {
              select: {
                id: true,
                teamName: true,
                email: true,
                avatar: true,
              },
            },
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

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Add teamMemberEmails field
    return {
      ...group,
      teamMemberEmails: group.members
        .map((m) => m.team?.email)
        .filter(Boolean)
        .join(', '),
    };
  }

  async update(id: string, dto: UpdateGroupDto, userId: string) {
    const existing = await this.findById(id);
    const { toTitleCase } = await import('../common/utils/string-helper');

    if (dto.groupName && toTitleCase(dto.groupName) !== existing.groupName) {
      const duplicate = await this.prisma.group.findFirst({
        where: { groupName: toTitleCase(dto.groupName) },
      });

      if (duplicate) {
        throw new ConflictException('Group name already exists');
      }
    }

    // Extract teamMemberIds from dto (not a Prisma field)
    const { teamMemberIds, ...groupData } = dto;

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        ...groupData,
        groupName: dto.groupName ? toTitleCase(dto.groupName) : undefined,
        updatedBy: userId,
      },
    });

    // Update GroupMember entries if teamMemberIds provided
    if (teamMemberIds !== undefined) {
      // Remove existing members and add new ones
      await this.prisma.groupMember.deleteMany({
        where: { groupId: id },
      });

      if (teamMemberIds.length > 0) {
        await this.prisma.groupMember.createMany({
          data: teamMemberIds.map((memberId) => ({
            groupId: id,
            userId: memberId,
            role: 'MEMBER',
          })),
          skipDuplicates: true,
        });
      }
    }

    await this.invalidateCache();
    await this.logAudit(userId, 'UPDATE', id, existing, updated);

    return updated;
  }

  async changeStatus(id: string, dto: ChangeStatusDto, userId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.group.update({
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
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            members: true,
            pendingTasks: true,
            completedTasks: true,
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const { _count } = group;
    const childCounts = [
      _count.members > 0 && `${_count.members} members`,
      _count.pendingTasks > 0 && `${_count.pendingTasks} pending tasks`,
      _count.completedTasks > 0 && `${_count.completedTasks} completed tasks`,
    ].filter(Boolean);

    if (childCounts.length > 0) {
      throw new BadRequestException(
        `Cannot delete Group because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`,
      );
    }

    await this.prisma.group.delete({
      where: { id },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'DELETE', id, group, null);

    return { message: 'Group deleted successfully' };
  }

  async bulkCreate(dto: BulkCreateGroupDto, userId: string) {
    this.logger.log(
      `[BULK_CREATE_FAST] Starting for ${dto.groups.length} records`,
    );
    const { toTitleCase } = await import('../common/utils/string-helper');
    const errors: any[] = [];
    const dataToInsert: any[] = [];
    const metaToInsert: Array<{ rowNumber?: number; groupNo: string }> = [];

    // Optimization 1: Batch check for group name duplicates
    const providedNames = dto.groups.map((g) => toTitleCase(g.groupName));
    const existingNames = new Set<string>();
    const nameChunks = this.excelUploadService.chunk(providedNames, 5000);
    for (const chunk of nameChunks) {
      const results = await this.prisma.group.findMany({
        where: { groupName: { in: chunk } },
        select: { groupName: true },
      });
      results.forEach((r) => existingNames.add(r.groupName));
    }

    // Optimization 2: Batch check for group no duplicates
    const providedNos = dto.groups.map((g) => g.groupNo).filter(Boolean);
    const existingNos = new Set<string>();
    if (providedNos.length > 0) {
      const noChunks = this.excelUploadService.chunk(providedNos, 5000);
      for (const chunk of noChunks) {
        const results = await this.prisma.group.findMany({
          where: { groupNo: { in: chunk as string[] } },
          select: { groupNo: true },
        });
        results.forEach((r) => existingNos.add(r.groupNo));
      }
    }

    const prefix = 'G-';
    const startNo = await this.autoNumberService.generateGroupNo();
    let currentNum = parseInt(
      startNo.replace(new RegExp(`^${prefix}`, 'i'), ''),
    );
    if (isNaN(currentNum)) currentNum = 11001;

    for (const groupDto of dto.groups) {
      try {
        const { _rowNumber, ...payload } = groupDto as any;
        const groupName = toTitleCase(payload.groupName);
        if (existingNames.has(groupName)) {
          errors.push({
            row: _rowNumber,
            groupName,
            error: 'Group name already exists',
          });
          continue;
        }
        existingNames.add(groupName);

        let groupNo = payload.groupNo?.trim();
        if (!groupNo || existingNos.has(groupNo)) {
          groupNo = `${prefix}${currentNum}`;
          currentNum++;
        }
        existingNos.add(groupNo);

        // Extract teamMemberIds from dto (not a Prisma field)
        const { teamMemberIds, ...groupData } = payload;

        dataToInsert.push({
          ...groupData,
          groupName,
          groupNo,
          status: payload.status || GroupStatus.Active,
          createdBy: userId,
        });
        metaToInsert.push({
          rowNumber: _rowNumber,
          groupNo,
        });
      } catch (err) {
        errors.push({ groupName: groupDto.groupName, error: err.message });
      }
    }

    // 2.5 Check existing duplicates in DB and auto-adjust
    const nosToCheck = metaToInsert.map((m) => m.groupNo).filter(Boolean);
    if (nosToCheck.length > 0) {
      const existing = await this.prisma.group.findMany({
        where: { groupNo: { in: nosToCheck as string[] } },
        select: { groupNo: true },
      });
      const existingNoSet = new Set(existing.map((item) => item.groupNo));

      for (let i = 0; i < dataToInsert.length; i++) {
        const meta = metaToInsert[i];
        const dupNo = !!meta.groupNo && existingNoSet.has(meta.groupNo);
        if (!dupNo) continue;

        const originalNo = meta.groupNo;
        let newNo = `${prefix}${currentNum}`;
        while (existingNos.has(newNo) || existingNoSet.has(newNo)) {
          currentNum++;
          newNo = `${prefix}${currentNum}`;
        }
        currentNum++;
        existingNos.add(newNo);
        dataToInsert[i].groupNo = newNo;
        metaToInsert[i].groupNo = newNo;

        errors.push({
          row: meta.rowNumber,
          groupNo: originalNo,
          newGroupNo: newNo,
          error: 'Duplicate groupNo (auto-adjusted)',
        });
      }
    }

    // Optimization 3: Bulk insert
    let totalInserted = 0;
    const batchChunks = this.excelUploadService.chunk(dataToInsert, 1000);
    for (const chunk of batchChunks) {
      const result = await this.prisma.group.createMany({
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
    }

    this.logger.log(
      `[BULK_CREATE_COMPLETED] Processed: ${dto.groups.length} | Inserted: ${totalInserted}`,
    );
    await this.invalidateCache();

    return {
      success: totalInserted,
      failed: dto.groups.length - totalInserted,
      message: `Successfully processed ${totalInserted} records.`,
      errors,
    };
  }

  async bulkUpdate(dto: BulkUpdateGroupDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    for (const item of dto.updates) {
      try {
        const res = await this.update(item.id, item, userId);
        results.push(res);
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      results,
      errors,
    };
  }

  async bulkDelete(dto: BulkDeleteGroupDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    for (const id of dto.ids) {
      try {
        await this.delete(id, userId);
        results.push(id);
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

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
        groupNo: ['groupno', 'no', 'code'],
        groupName: ['groupname', 'name'],
        status: ['status', 'state', 'active'],
        remark: ['remark', 'remarks', 'notes'],
      },
      requiredColumns: ['groupName'],
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

    const processedData: Array<CreateGroupDto & { _rowNumber?: number }> = [];
    const processingErrors: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        processedData.push({
          ...row,
          status: row.status
            ? this.excelUploadService.validateEnum(
                row.status,
                GroupStatus,
                'Status',
              )
            : GroupStatus.Active,
          _rowNumber: i + 2,
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
          const toInsert: Array<CreateGroupDto & { _rowNumber?: number }> = [];

          for (const item of batch) {
            const row = item.data;
            try {
              toInsert.push({
                ...row,
                status: row.status
                  ? this.excelUploadService.validateEnum(
                      row.status,
                      GroupStatus,
                      'Status',
                    )
                  : GroupStatus.Active,
                _rowNumber: item.rowNumber,
              });
            } catch (err) {
              totalFailed += 1;
              errors.push({ row: item.rowNumber, error: err.message });
            }
          }

          if (toInsert.length > 0) {
            const result = await this.bulkCreate({ groups: toInsert }, userId);
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
    if (this.shouldProcessInBackground(file)) {
      const fileName = file?.originalname || 'upload.xlsx';
      const job = await this.uploadJobService.createJob({
        module: 'group',
        fileName,
        userId,
      });
      this.eventEmitter.emit('group.bulk-upload', {
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

    if (processedData.length === 0) {
      throw new BadRequestException(
        'No valid data found or required columns missing',
      );
    }

    // --- BACKGROUND PROCESSING TRIGGER ---
    if (processedData.length > 500) {
      const job = await this.uploadJobService.createJob({
        module: 'group',
        fileName: file.originalname,
        userId,
      });
      this.eventEmitter.emit('group.bulk-upload', {
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

    const result = await this.bulkCreate({ groups: processedData }, userId);
    result.errors = [
      ...(result.errors || []),
      ...parseErrors,
      ...processingErrors,
    ];
    result.failed += parseErrors.length + processingErrors.length;

    return result;
  }

  @OnEvent('group.bulk-upload')
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
        const result = await this.bulkCreate({ groups: providedData }, userId);
        totalSuccess = result.success;
        totalFailed = result.failed;
        errorsDetail = result.errors || [];
      } else {
        throw new Error('No valid data found to import.');
      }

      await this.notificationService.createNotification(userId, {
        title: 'Group Import Completed',
        description: `Successfully imported ${totalSuccess} groups from ${fileName}. Failed: ${totalFailed}`,
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
          message: `Successfully imported ${totalSuccess} groups.`,
          errors: errorsDetail,
        });
      }

      this.logger.log(
        `[BACKGROUND_UPLOAD_COMPLETED] Success: ${totalSuccess}, Failed: ${totalFailed}`,
      );
    } catch (error) {
      this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
      await this.notificationService.createNotification(userId, {
        title: 'Group Import Failed',
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
        entity: 'Group',
        entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: '',
      },
    });
  }
}
