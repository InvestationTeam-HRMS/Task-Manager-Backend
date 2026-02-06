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
  CreateProjectDto,
  UpdateProjectDto,
  BulkCreateProjectDto,
  BulkUpdateProjectDto,
  BulkDeleteProjectDto,
  ChangeStatusDto,
  FilterProjectDto,
} from './dto/project.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { ProjectStatus, ProjectPriority, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);
  private readonly CACHE_TTL = 300;
  private readonly CACHE_KEY = 'projects';
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
  ) { }

  async create(dto: CreateProjectDto, userId: string) {
    // Validate Client Group Existence
    const clientGroup = await this.prisma.clientGroup.findUnique({
      where: { id: dto.clientGroupId },
    });
    if (!clientGroup) {
      throw new NotFoundException('Client Group not found');
    }

    // Validate SubLocation if provided
    if (dto.subLocationId) {
      const subLocation = await this.prisma.subLocation.findUnique({
        where: { id: dto.subLocationId },
      });
      if (!subLocation) {
        throw new NotFoundException('Sub location not found');
      }
    }

    const generatedProjectNo = await this.autoNumberService.generateProjectNo();
    const { toTitleCase } = await import('../common/utils/string-helper');

    const project = await this.prisma.project.create({
      data: {
        ...dto,
        projectName: toTitleCase(dto.projectName),
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        projectNo: dto.projectNo || generatedProjectNo,
        remark: dto.remark ? toTitleCase(dto.remark) : undefined,
        priority: dto.priority || ProjectPriority.Medium,
        status: dto.status || ProjectStatus.Active,
        createdBy: userId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'CREATE', project.id, null, project);

    return project;
  }

  async findAll(pagination: PaginationDto, filter?: FilterProjectDto) {
    const {
      page = 1,
      limit = 25,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = pagination;
    const skip = (page - 1) * limit;

    const cleanedSearch = search?.trim();
    const where: Prisma.ProjectWhereInput = {
      AND: [],
    };

    const andArray = where.AND as Array<Prisma.ProjectWhereInput>;
    const { toTitleCase } = await import('../common/utils/string-helper');

    // Map frontend sort fields to Prisma orderBy
    let orderBy: any;
    if (sortBy === 'groupNo' || sortBy === 'groupName' || sortBy === 'clientGroupName') {
      orderBy = { clientGroup: { groupName: sortOrder } };
    } else if (sortBy === 'companyName' || sortBy === 'companyNo') {
      orderBy = { company: { companyName: sortOrder } };
    } else if (sortBy === 'locationName' || sortBy === 'locationNo') {
      orderBy = { location: { locationName: sortOrder } };
    } else if (sortBy === 'subLocationName' || sortBy === 'subLocationNo') {
      orderBy = { subLocation: { subLocationName: sortOrder } };
    } else if (sortBy === 'address') {
      orderBy = { subLocation: { address: sortOrder } };
    } else if (sortBy === 'pendingTasksCount') {
      orderBy = { pendingTasks: { _count: sortOrder } };
    } else if (sortBy === 'completedTasksCount') {
      orderBy = { completedTasks: { _count: sortOrder } };
    } else {
      // Check if field exists on Project model, otherwise fallback to createdAt
      const validProjectFields = ['id', 'projectNo', 'projectName', 'clientGroupId', 'companyId', 'locationId', 'subLocationId', 'deadline', 'priority', 'status', 'remark', 'createdAt', 'updatedAt'];
      if (validProjectFields.includes(sortBy)) {
        orderBy = { [sortBy]: sortOrder };
      } else {
        orderBy = { createdAt: sortOrder };
      }
    }

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
      if (statusValues.length > 0)
        andArray.push({ status: { in: statusValues as any } });
    }

    // Handle Priority Filter
    if (filter?.priority) {
      const priorityValues =
        typeof filter.priority === 'string'
          ? filter.priority
            .split(/[,\:;|]/)
            .map((v) => v.trim())
            .filter(Boolean)
          : Array.isArray(filter.priority)
            ? filter.priority
            : [filter.priority];
      if (priorityValues.length > 0)
        andArray.push({ priority: { in: priorityValues as any } });
    }

    if (filter?.subLocationId)
      andArray.push({ subLocationId: filter.subLocationId });
    if (filter?.locationId) andArray.push({ locationId: filter.locationId });
    if (filter?.companyId) andArray.push({ companyId: filter.companyId });
    if (filter?.clientGroupId)
      andArray.push({ clientGroupId: filter.clientGroupId });
    if (filter?.projectName)
      andArray.push(
        buildMultiValueFilter('projectName', toTitleCase(filter.projectName)),
      );
    if (filter?.projectNo)
      andArray.push(buildMultiValueFilter('projectNo', filter.projectNo));
    if (filter?.remark)
      andArray.push(
        buildMultiValueFilter('remark', toTitleCase(filter.remark)),
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

    if (filter?.locationName) {
      const multiFilter = buildMultiValueFilter(
        'locationName',
        toTitleCase(filter.locationName),
      );
      if (multiFilter) andArray.push({ location: multiFilter });
    }

    if (filter?.subLocationName) {
      const multiFilter = buildMultiValueFilter(
        'subLocationName',
        toTitleCase(filter.subLocationName),
      );
      if (multiFilter) andArray.push({ subLocation: multiFilter });
    }

    if (filter?.deadline) {
      const values = filter.deadline
        .split(/[,\;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const dateConditions = values
        .map((v) => {
          const date = new Date(v);
          if (isNaN(date.getTime())) return undefined;

          // If it has a time component (not exactly start of day) or was provided as ISO with time
          const hasTime = v.includes('T') || v.includes(':');

          if (hasTime) {
            // Filter for that specific minute
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

      if (dateConditions.length > 0) {
        andArray.push({ OR: dateConditions });
      }
    }

    if (cleanedSearch) {
      const searchValues = cleanedSearch
        .split(/[,\;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const allSearchConditions: Prisma.ProjectWhereInput[] = [];

      for (const val of searchValues) {
        const searchLower = val.toLowerCase();
        const searchTitle = toTitleCase(val);
        const looksLikeCode =
          /^[A-Z]{1,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

        if (looksLikeCode) {
          allSearchConditions.push({
            projectNo: { equals: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            projectNo: { contains: val, mode: 'insensitive' },
          });
        } else {
          allSearchConditions.push({
            projectName: { contains: val, mode: 'insensitive' },
          });
          allSearchConditions.push({
            projectName: { contains: searchTitle, mode: 'insensitive' },
          });
          allSearchConditions.push({
            projectNo: { contains: val, mode: 'insensitive' },
          });
        }

        allSearchConditions.push({
          remark: { contains: val, mode: 'insensitive' },
        });
        allSearchConditions.push({
          remark: { contains: searchTitle, mode: 'insensitive' },
        });
        allSearchConditions.push({
          subLocation: {
            subLocationName: { contains: val, mode: 'insensitive' },
          },
        });
        allSearchConditions.push({
          subLocation: {
            subLocationName: { contains: searchTitle, mode: 'insensitive' },
          },
        });
        allSearchConditions.push({
          subLocation: {
            location: { locationName: { contains: val, mode: 'insensitive' } },
          },
        });
        allSearchConditions.push({
          subLocation: {
            location: {
              locationName: { contains: searchTitle, mode: 'insensitive' },
            },
          },
        });
        allSearchConditions.push({
          subLocation: {
            location: {
              company: { companyName: { contains: val, mode: 'insensitive' } },
            },
          },
        });
        allSearchConditions.push({
          subLocation: {
            location: {
              company: {
                companyName: { contains: searchTitle, mode: 'insensitive' },
              },
            },
          },
        });

        if ('active'.includes(searchLower) && searchLower.length >= 3)
          allSearchConditions.push({ status: 'Active' as any });
        if ('inactive'.includes(searchLower) && searchLower.length >= 3)
          allSearchConditions.push({ status: 'Inactive' as any });
        if ('completed'.includes(searchLower) && searchLower.length >= 3)
          allSearchConditions.push({ status: 'Completed' as any });
        if (
          ('on hold'.includes(searchLower) || 'onhold'.includes(searchLower)) &&
          searchLower.length >= 3
        )
          allSearchConditions.push({ status: 'On_Hold' as any });
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
        this.logger.log(`[CACHE_HIT] Project List - ${cacheKey}`);
        return cached;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: orderBy,
        select: {
          id: true,
          projectNo: true,
          projectName: true,
          clientGroupId: true,
          companyId: true,
          locationId: true,
          subLocationId: true,
          deadline: true,
          priority: true,
          status: true,
          remark: true,
          createdAt: true,
          clientGroup: {
            select: {
              id: true,
              groupName: true,
            },
          },
          subLocation: {
            select: {
              id: true,
              subLocationName: true,
              subLocationCode: true,
              location: {
                select: {
                  id: true,
                  locationName: true,
                  company: {
                    select: {
                      id: true,
                      companyName: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: { pendingTasks: true, completedTasks: true },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    const mappedData = data.map((item) => ({
      ...item,
      groupName: item.clientGroup?.groupName, // Flattened for table column accessor
      subLocationName: item.subLocation?.subLocationName,
      locationName: item.subLocation?.location?.locationName,
      companyName: item.subLocation?.location?.company?.companyName,
    }));

    const response = new PaginatedResponse(mappedData, total, page, limit);

    if (isCacheable) {
      await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
      this.logger.log(`[CACHE_MISS] Project List - Cached result: ${cacheKey}`);
    }

    return response;
  }

  async downloadExcel(query: any, userId: string, res: any) {
    const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

    const mappedData = data.map((item, index) => ({
      srNo: index + 1,
      projectNo: item.projectNo,
      projectName: item.projectName,
      clientGroup: item.groupName || '',
      company: item.companyName || '',
      location: item.locationName || '',
      subLocation: item.subLocationName || '',
      priority: item.priority,
      status: item.status,
      deadline: item.deadline
        ? new Date(item.deadline).toLocaleDateString()
        : '',
      remark: item.remark || '',
    }));

    const columns = [
      { header: '#', key: 'srNo', width: 10 },
      { header: 'Project No', key: 'projectNo', width: 15 },
      { header: 'Project Name', key: 'projectName', width: 30 },
      { header: 'Client Group', key: 'clientGroup', width: 25 },
      { header: 'Company', key: 'company', width: 25 },
      { header: 'Location', key: 'location', width: 25 },
      { header: 'Sub Location', key: 'subLocation', width: 25 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Deadline', key: 'deadline', width: 15 },
      { header: 'Remark', key: 'remark', width: 30 },
    ];

    await this.excelDownloadService.downloadExcel(
      res,
      mappedData,
      columns,
      'projects.xlsx',
      'Projects',
    );
  }

  async findActive(pagination: PaginationDto) {
    const filter: FilterProjectDto = { status: ProjectStatus.Active };
    return this.findAll(pagination, filter);
  }

  async findById(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id },
      include: {
        subLocation: {
          include: {
            location: {
              include: {
                company: {
                  include: {
                    group: true,
                  },
                },
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

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async update(id: string, dto: UpdateProjectDto, userId: string) {
    const existing = await this.findById(id);
    const { toTitleCase } = await import('../common/utils/string-helper');

    if (dto.subLocationId) {
      const subLocation = await this.prisma.subLocation.findUnique({
        where: { id: dto.subLocationId },
      });

      if (!subLocation) {
        throw new NotFoundException('Sub location not found');
      }
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        projectName: dto.projectName ? toTitleCase(dto.projectName) : undefined,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
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

    const updated = await this.prisma.project.update({
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
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            pendingTasks: true,
            completedTasks: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const totalTasks =
      project._count.pendingTasks + project._count.completedTasks;
    if (totalTasks > 0) {
      throw new BadRequestException(
        `Cannot delete Project because it contains ${totalTasks} tasks. Please delete or reassign them first.`,
      );
    }

    await this.prisma.project.delete({
      where: { id },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'HARD_DELETE', id, project, null);

    return { message: 'Project deleted successfully' };
  }

  async bulkCreate(dto: BulkCreateProjectDto, userId: string) {
    this.logger.log(
      `[BULK_CREATE_FAST] Starting for ${dto.projects.length} records`,
    );
    const { toTitleCase } = await import('../common/utils/string-helper');

    const errors: any[] = [];

    const prefix = process.env.P_NUMBER_PREFIX || 'P-';
    const startNo = await this.autoNumberService.generateProjectNo();
    let currentNum = parseInt(
      startNo.replace(new RegExp(`^${prefix}`, 'i'), ''),
    );
    if (isNaN(currentNum)) currentNum = 11001;

    const BATCH_SIZE = 1000;
    const dataToInsert: any[] = [];
    const metaToInsert: Array<{
      rowNumber?: number;
      projectNo: string;
    }> = [];

    // Optimization: Fetch existing projectNos provided in DTO to check for duplicates
    const providedProjectNos = dto.projects
      .map((p) => p.projectNo)
      .filter(Boolean);
    const existingProvided = new Set<string>();
    if (providedProjectNos.length > 0) {
      const chunks = this.excelUploadService.chunk(providedProjectNos, 5000);
      for (const chunk of chunks) {
        const results = await this.prisma.project.findMany({
          where: { projectNo: { in: chunk as string[] } },
          select: { projectNo: true },
        });
        results.forEach((p) => existingProvided.add(p.projectNo));
      }
    }

    for (const projectDto of dto.projects) {
      try {
        const { _rowNumber, ...payload } = projectDto as any;
        const projectName = toTitleCase(
          payload.projectName?.trim() || 'Unnamed Project',
        );
        const remark = payload.remark
          ? toTitleCase(payload.remark)
          : undefined;

        // Unique number logic
        let finalProjectNo = payload.projectNo?.trim();
        if (!finalProjectNo || existingProvided.has(finalProjectNo)) {
          finalProjectNo = `${prefix}${currentNum}`;
          currentNum++;
        }
        existingProvided.add(finalProjectNo);

        dataToInsert.push({
          ...payload,
          projectName,
          remark,
          projectNo: finalProjectNo,
          deadline: payload.deadline ? new Date(payload.deadline) : null,
          priority: payload.priority || ProjectPriority.Medium,
          status: payload.status || ProjectStatus.Active,
          createdBy: userId,
        });
        metaToInsert.push({
          rowNumber: _rowNumber,
          projectNo: finalProjectNo,
        });
      } catch (err) {
        errors.push({
          projectName: projectDto.projectName,
          error: err.message,
        });
      }
    }

    // 2.5 Check existing duplicates in DB and auto-adjust
    const nosToCheck = metaToInsert.map((m) => m.projectNo).filter(Boolean);
    if (nosToCheck.length > 0) {
      const existing = await this.prisma.project.findMany({
        where: { projectNo: { in: nosToCheck as string[] } },
        select: { projectNo: true },
      });
      const existingNoSet = new Set(existing.map((item) => item.projectNo));

      for (let i = 0; i < dataToInsert.length; i++) {
        const meta = metaToInsert[i];
        const dupNo =
          !!meta.projectNo && existingNoSet.has(meta.projectNo);
        if (!dupNo) continue;

        const originalNo = meta.projectNo;
        let newNo = `${prefix}${currentNum}`;
        while (existingProvided.has(newNo) || existingNoSet.has(newNo)) {
          currentNum++;
          newNo = `${prefix}${currentNum}`;
        }
        currentNum++;
        existingProvided.add(newNo);
        dataToInsert[i].projectNo = newNo;
        metaToInsert[i].projectNo = newNo;

        errors.push({
          row: meta.rowNumber,
          projectNo: originalNo,
          newProjectNo: newNo,
          error: 'Duplicate projectNo (auto-adjusted)',
        });
      }
    }

    const chunks: any[][] = this.excelUploadService.chunk(
      dataToInsert,
      BATCH_SIZE,
    );
    let totalInserted = 0;
    for (const chunk of chunks) {
      try {
        const result = await this.prisma.project.createMany({
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
      `[BULK_CREATE_COMPLETED] Processed: ${dto.projects.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`,
    );
    await this.invalidateCache();

    return {
      success: totalInserted,
      failed: dto.projects.length - totalInserted,
      message: `Successfully inserted ${totalInserted} records.`,
      errors,
    };
  }

  async bulkUpdate(dto: BulkUpdateProjectDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const update of dto.updates) {
        try {
          const { id, ...data } = update;

          const updated = await tx.project.update({
            where: { id },
            data: {
              ...data,
              deadline: data.deadline ? new Date(data.deadline) : undefined,
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

  async bulkDelete(dto: BulkDeleteProjectDto, userId: string) {
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
      results,
      errors,
    };
  }

  private shouldProcessInBackground(file?: Express.Multer.File) {
    return !!file?.size && file.size >= this.BACKGROUND_UPLOAD_BYTES;
  }

  private getUploadConfig() {
    return {
      columnMapping: {
        projectNo: ['projectno', 'projectnumber'],
        projectName: ['projectname', 'name'],
        subLocationName: [
          'sublocation',
          'sub location',
          'sub_location',
          'sub-location',
          'sublocationname',
          'clientsublocationname',
        ],
        deadline: ['deadline', 'duedate', 'enddate'],
        priority: ['priority'],
        status: ['status'],
        remark: ['remark', 'remarks', 'notes', 'description'],
      },
      requiredColumns: ['projectName', 'subLocationName'],
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

    // 1. Resolve all subLocationNames to subLocationIds and Hierarchy
    const subLocationNames = Array.from(
      new Set(
        data
          .filter((row) => row.subLocationName)
          .map((row) => row.subLocationName),
      ),
    );
    const detailedSubLocations = await this.prisma.subLocation.findMany({
      where: { subLocationName: { in: subLocationNames } },
      select: {
        id: true,
        subLocationName: true,
        location: {
          select: {
            id: true,
            company: {
              select: {
                id: true,
                group: {
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    const subLocationMap = new Map(
      detailedSubLocations.map((s) => [s.subLocationName.toLowerCase(), s.id]),
    );

    // 2. Build processing data
    const processedData: Array<CreateProjectDto & { _rowNumber?: number }> = [];
    const processingErrors: any[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const status = row.status
          ? this.excelUploadService.validateEnum(
            row.status as string,
            ProjectStatus,
            'Status',
          )
          : ProjectStatus.Active;
        const priority = row.priority
          ? this.excelUploadService.validateEnum(
            row.priority as string,
            ProjectPriority,
            'Priority',
          )
          : ProjectPriority.Medium;

        const subLocationId = subLocationMap.get(
          row.subLocationName?.toLowerCase(),
        );
        if (!subLocationId) {
          throw new Error(`Sub Location not found: ${row.subLocationName}`);
        }

        const fullSubLocation = detailedSubLocations.find(
          (s) => s.id === subLocationId,
        );

        if (!fullSubLocation?.location?.company?.group?.id) {
          throw new Error(
            `Client Group not found for Sub Location: ${row.subLocationName}`,
          );
        }

        processedData.push({
          projectNo: row.projectNo,
          projectName: row.projectName,
          clientGroupId: fullSubLocation.location.company.group.id,
          companyId: fullSubLocation.location.company?.id,
          locationId: fullSubLocation.location?.id,
          subLocationId: subLocationId,
          deadline: row.deadline,
          priority: priority as ProjectPriority,
          status: status as ProjectStatus,
          remark: row.remark,
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

    const subLocationNames = new Set<string>();

    try {
      await this.excelUploadService.streamFileInBatches<any>(
        file,
        columnMapping,
        requiredColumns,
        2000,
        async (batch) => {
          for (const item of batch) {
            const row = item.data;
            if (row.subLocationName) {
              subLocationNames.add(String(row.subLocationName).trim());
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

    const subLocations =
      subLocationNames.size > 0
        ? await this.prisma.subLocation.findMany({
          where: { subLocationName: { in: Array.from(subLocationNames) } },
          select: {
            id: true,
            subLocationName: true,
            location: {
              select: {
                id: true,
                company: {
                  select: {
                    id: true,
                    group: {
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        })
        : [];

    const subLocationMap = new Map(
      subLocations.map((s) => [s.subLocationName.toLowerCase(), s]),
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
          const toInsert: Array<CreateProjectDto & { _rowNumber?: number }> = [];

          for (const item of batch) {
            const row = item.data;
            try {
              const status = row.status
                ? this.excelUploadService.validateEnum(
                  String(row.status),
                  ProjectStatus,
                  'Status',
                )
                : ProjectStatus.Active;
              const priority = row.priority
                ? this.excelUploadService.validateEnum(
                  String(row.priority),
                  ProjectPriority,
                  'Priority',
                )
                : ProjectPriority.Medium;

              const subLocation = subLocationMap.get(
                String(row.subLocationName).toLowerCase(),
              );
              if (!subLocation) {
                throw new Error(
                  `Sub Location not found: ${row.subLocationName}`,
                );
              }

              const groupId = subLocation.location?.company?.group?.id;
              if (!groupId) {
                throw new Error(
                  `Client Group not found for Sub Location: ${row.subLocationName}`,
                );
              }

              toInsert.push({
                projectNo: row.projectNo,
                projectName: row.projectName,
                clientGroupId: groupId,
                companyId: subLocation.location?.company?.id,
                locationId: subLocation.location?.id,
                subLocationId: subLocation.id,
                deadline: row.deadline,
                priority: priority as ProjectPriority,
                status: status as ProjectStatus,
                remark: row.remark,
                _rowNumber: item.rowNumber,
              });
            } catch (err) {
              totalFailed += 1;
              errors.push({ row: item.rowNumber, error: err.message });
            }
          }

          if (toInsert.length > 0) {
            const result = await this.bulkCreate(
              { projects: toInsert },
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
        module: 'project',
        fileName,
        userId,
      });
      this.eventEmitter.emit('project.bulk-upload', {
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
        module: 'project',
        fileName: file.originalname,
        userId,
      });
      this.eventEmitter.emit('project.bulk-upload', {
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

    const result = await this.bulkCreate({ projects: processedData }, userId);

    result.errors = [
      ...(result.errors || []),
      ...parseErrors,
      ...processingErrors,
    ];
    result.failed += parseErrors.length + processingErrors.length;

    return result;
  }

  @OnEvent('project.bulk-upload')
  async handleBackgroundUpload(payload: {
    data?: CreateProjectDto[];
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
          { projects: providedData },
          userId,
        );
        totalSuccess = result.success;
        totalFailed = result.failed;
        errorsDetail = result.errors || [];
      } else {
        throw new Error('No valid data found to import.');
      }

      await this.notificationService.createNotification(userId, {
        title: 'Project Import Completed',
        description: `Successfully imported ${totalSuccess} projects from ${fileName}. Failed: ${totalFailed}`,
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
          message: `Successfully imported ${totalSuccess} projects.`,
          errors: errorsDetail,
        });
      }

      this.logger.log(
        `[BACKGROUND_UPLOAD_COMPLETED] Success: ${totalSuccess}, Failed: ${totalFailed}`,
      );
    } catch (error) {
      this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
      await this.notificationService.createNotification(userId, {
        title: 'Project Import Failed',
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
        entity: 'Project',
        entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: '',
      },
    });
  }
}
