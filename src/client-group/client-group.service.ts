import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
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

@Injectable()
export class ClientGroupService {
    private readonly logger = new Logger(ClientGroupService.name);
    private readonly CACHE_TTL = 300; // 5 minutes
    private readonly CACHE_KEY = 'client_groups';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private configService: ConfigService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

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
        const generatedGroupNo = await this.autoNumberService.generateClientGroupNo();
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
        const { page = 1, limit = 25, search, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.ClientGroupWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.ClientGroupWhereInput>;
        const { toTitleCase } = await import('../common/utils/string-helper');

        if (filter?.status) {
            const statusValues = typeof filter.status === 'string'
                ? filter.status.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.status) ? filter.status : [filter.status];

            if (statusValues.length > 0) {
                andArray.push({ status: { in: statusValues as any } });
            }
        }

        if (filter?.country) andArray.push(buildMultiValueFilter('country', toTitleCase(filter.country)));
        if (filter?.groupName) andArray.push(buildMultiValueFilter('groupName', toTitleCase(filter.groupName)));
        if (filter?.groupNo) andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
        if (filter?.groupCode) andArray.push(buildMultiValueFilter('groupCode', filter.groupCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.ClientGroupWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);

                // Check if value looks like a code (contains hyphen or is alphanumeric with specific pattern)
                const looksLikeCode = /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeCode) {
                    // For code-like values, use exact match OR contains for flexibility
                    allSearchConditions.push({ groupCode: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ groupNo: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ groupCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ groupNo: { contains: val, mode: 'insensitive' } });
                } else {
                    // For text values, use contains
                    allSearchConditions.push({ groupName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ groupName: { contains: searchTitle, mode: 'insensitive' } });
                    allSearchConditions.push({ groupCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ groupNo: { contains: val, mode: 'insensitive' } });
                }

                // Always search in country and remark
                allSearchConditions.push({ country: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ country: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });

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
        const isCacheable = !cleanedSearch && (!filter || Object.keys(filter).length === 0);
        const cacheKey = `${this.CACHE_KEY}:list:p${page}:l${limit}:s${sortBy}:${sortOrder}`;

        if (isCacheable) {
            const cached = await this.redisService.getCache<PaginatedResponse<any>>(cacheKey);
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
                orderBy: { [sortBy]: sortOrder },
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
                        select: { companies: true, teams: true }
                    }
                }
            }),
            this.prisma.clientGroup.count({ where }),
        ]);

        const response = new PaginatedResponse(data, total, page, limit);

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
            this.logger.log(`[CACHE_MISS] ClientGroup List - Cached result: ${cacheKey}`);
        }

        return response;
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
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                updater: {
                    select: { id: true, firstName: true, lastName: true, email: true },
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
        const groupCodeUpper = dto.groupCode ? dto.groupCode.toUpperCase() : undefined;

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
                    }
                }
            }
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
                `Cannot delete Client Group because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`
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
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.clientGroups.length} records`);
        const { toTitleCase } = await import('../common/utils/string-helper');

        const errors: any[] = [];

        // 1. Fetch current max for uniqueness
        const allExisting = await this.prisma.clientGroup.findMany({
            select: { groupCode: true, groupNo: true }
        });
        const existingCodes = new Set(allExisting.map(x => x.groupCode));
        const existingNos = new Set(allExisting.map(x => x.groupNo));

        const prefix = this.configService.get('CG_NUMBER_PREFIX', 'CG-');
        const startNo = await this.autoNumberService.generateClientGroupNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        // 2. Pre-process and validate in memory
        for (const clientGroupDto of dto.clientGroups) {
            try {
                const groupName = toTitleCase(clientGroupDto.groupName?.trim() || clientGroupDto.groupCode || 'Unnamed Group');
                const country = clientGroupDto.country ? toTitleCase(clientGroupDto.country) : undefined;
                const remark = clientGroupDto.remark ? toTitleCase(clientGroupDto.remark) : undefined;

                // Unique Code Logic
                let finalGroupCode = clientGroupDto.groupCode?.trim() || `GC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
                let finalGroupNo = clientGroupDto.groupNo?.trim();
                if (!finalGroupNo || existingNos.has(finalGroupNo)) {
                    finalGroupNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalGroupNo)) {
                        finalGroupNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalGroupNo);

                dataToInsert.push({
                    ...clientGroupDto,
                    groupName,
                    country,
                    remark,
                    groupCode: finalGroupCode,
                    groupNo: finalGroupNo,
                    status: clientGroupDto.status || ClientGroupStatus.Active,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ groupCode: clientGroupDto.groupCode, error: err.message });
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
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.clientGroups.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);

        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.clientGroups.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
            errors,
            errorsDetail: errors
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



    async uploadExcel(file: Express.Multer.File, userId: string) {
        this.logger.log(`[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`);

        const columnMapping = {
            groupNo: ['groupno', 'groupnumber', 'no', 'number'],
            groupName: ['groupname', 'name', 'gname', 'group'],
            groupCode: ['groupcode', 'code', 'gcode', 'groupcode'],
            country: ['country', 'location'],
            status: ['status'],
            remark: ['remark', 'remarks', 'notes', 'description']
        };

        const requiredColumns = ['groupName', 'groupCode'];

        const parseResult = await this.excelUploadService.parseFile(
            file,
            columnMapping,
            requiredColumns,
        );
        const data = parseResult.data as any[];
        const parseErrors = parseResult.errors;

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        const processedData: CreateClientGroupDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i] as any;
            try {
                const status = row.status ? this.excelUploadService.validateEnum(String(row.status), ClientGroupStatus, 'Status') : ClientGroupStatus.Active;

                processedData.push({
                    ...row,
                    status: status as ClientGroupStatus,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ clientGroups: processedData }, userId);

        // Merge parse errors and processing errors into result
        result.errors = [...(result.errors || []), ...parseErrors, ...processingErrors];
        result.failed += parseErrors.length + processingErrors.length;

        return result;
    }

    private async invalidateCache() {
        await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:*`);
    }

    private async logAudit(userId: string, action: string, entityId: string, oldValue: any, newValue: any) {
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
