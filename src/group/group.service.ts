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

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
        private excelDownloadService: ExcelDownloadService,
    ) { }

    async create(dto: CreateGroupDto, userId: string) {
        const { toTitleCase } = await import('../common/utils/string-helper');

        const existing = await this.prisma.group.findFirst({
            where: { groupName: toTitleCase(dto.groupName) },
        });

        if (existing) {
            throw new ConflictException('Group name already exists');
        }

        const groupNo = await this.autoNumberService.generateGroupNo();

        const group = await this.prisma.group.create({
            data: {
                ...dto,
                groupName: toTitleCase(dto.groupName),
                groupNo: dto.groupNo || groupNo,
                status: dto.status || GroupStatus.Active,
                createdBy: userId,
            },
        });

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
            AND: []
        };

        const andArray = where.AND as Array<Prisma.GroupWhereInput>;
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Handle Status Filter
        if (filter?.status) {
            const statusValues = typeof filter.status === 'string'
                ? filter.status.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.status) ? filter.status : [filter.status];

            if (statusValues.length > 0) {
                andArray.push({
                    status: { in: statusValues as any }
                });
            }
        }

        if (filter?.groupName) andArray.push(buildMultiValueFilter('groupName', toTitleCase(filter.groupName)));
        if (filter?.groupNo) andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.GroupWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);

                allSearchConditions.push({ groupName: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ groupName: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ groupNo: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });

                if ('active'.includes(searchLower) && searchLower.length >= 3) {
                    allSearchConditions.push({ status: GroupStatus.Active });
                }
                if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
                    allSearchConditions.push({ status: GroupStatus.Inactive });
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
                                    firstName: true,
                                    lastName: true,
                                    email: true,
                                },
                            },
                        },
                    },
                    _count: {
                        select: { pendingTasks: true, completedTasks: true }
                    }
                },
            }),
            this.prisma.group.count({ where }),
        ]);

        // Add teamMemberEmails field to each group
        const data = rawData.map(group => ({
            ...group,
            teamMemberEmails: group.members
                .map(m => m.team?.email)
                .filter(Boolean)
                .join(', '),
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
            members: item.members.map(m => `${m.team.firstName || ''} ${m.team.lastName || ''}`.trim()).join(', '),
            teamMemberEmails: item.teamMemberEmails || item.members.map(m => m.team?.email).filter(Boolean).join(', '),
            status: item.status,
            createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A',
            remark: item.remark || 'N/A',
        }));

        const columns = [
            { header: '#', key: 'srNo', width: 10 },
            { header: 'Group No', key: 'groupNo', width: 15 },
            { header: 'Group Name', key: 'groupName', width: 30 },
            { header: 'Members', key: 'members', width: 50 },
            { header: 'Team Member Emails', key: 'teamMemberEmails', width: 50 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Created Date', key: 'createdAt', width: 20 },
            { header: 'Remark', key: 'remark', width: 30 },
        ];

        await this.excelDownloadService.downloadExcel(res, mappedData, columns, 'internal_groups.xlsx', 'Internal Groups');
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
                                firstName: true,
                                lastName: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
            },
        });

        // Add teamMemberEmails field to each group
        return groups.map(group => ({
            ...group,
            teamMemberEmails: group.members
                .map(m => m.team?.email)
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
                                firstName: true,
                                lastName: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
                creator: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                updater: {
                    select: { id: true, firstName: true, lastName: true, email: true },
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
                .map(m => m.team?.email)
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

        const updated = await this.prisma.group.update({
            where: { id },
            data: {
                ...dto,
                groupName: dto.groupName ? toTitleCase(dto.groupName) : undefined,
                updatedBy: userId,
            },
        });

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
                    }
                }
            }
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
                `Cannot delete Group because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`
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
        this.logger.log(`[BULK_CREATE] Starting for ${dto.groups.length} records`);
        const { toTitleCase } = await import('../common/utils/string-helper');
        const errors: any[] = [];
        const results: any[] = [];

        for (const groupDto of dto.groups) {
            try {
                const res = await this.create(groupDto, userId);
                results.push(res);
            } catch (err) {
                errors.push({ groupName: groupDto.groupName, error: err.message });
            }
        }

        return {
            success: results.length,
            failed: errors.length,
            message: `Successfully processed ${results.length} records.`,
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

    async uploadExcel(file: Express.Multer.File, userId: string) {
        const columnMapping = {
            groupNo: ['groupno', 'no', 'code'],
            groupName: ['groupname', 'name'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes'],
        };

        const requiredColumns = ['groupName'];

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found or required columns missing');
        }

        const processedData: any[] = [];
        for (const row of data) {
            processedData.push({
                ...row,
                status: row.status ? this.excelUploadService.validateEnum(row.status, GroupStatus, 'Status') : GroupStatus.Active,
            });
        }

        const result = await this.bulkCreate({ groups: processedData }, userId);
        result.errors = [...(result.errors || []), ...parseErrors];

        return result;
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
