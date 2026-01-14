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
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { ClientGroupStatus, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

@Injectable()
export class ClientGroupService {
    private readonly logger = new Logger(ClientGroupService.name);
    private readonly CACHE_TTL = 300; // 5 minutes
    private readonly CACHE_KEY = 'client_groups';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private configService: ConfigService,
    ) { }

    async create(dto: CreateClientGroupDto, userId: string) {
        // Check for duplicate group code
        const existing = await this.prisma.clientGroup.findUnique({
            where: { groupCode: dto.groupCode },
        });

        if (existing) {
            throw new ConflictException('Group code already exists');
        }

        // Generate CG number
        const cgNumber = await this.generateCgNumber();

        const clientGroup = await this.prisma.clientGroup.create({
            data: {
                ...dto,
                cgNumber,
                status: dto.status || ClientGroupStatus.ACTIVE,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', clientGroup.id, null, clientGroup);

        return clientGroup;
    }

    async findAll(pagination: PaginationDto, filter?: FilterClientGroupDto) {
        const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
        const skip = (page - 1) * limit;

        // Build where clause
        const where = {
            deletedAt: null,
            ...(filter?.status && { status: filter.status }),
            ...(filter?.country && { country: filter.country }),
            ...(filter?.groupCode && { groupCode: filter.groupCode }),
            ...(search && {
                OR: [
                    { groupName: { contains: search, mode: 'insensitive' } },
                    { groupCode: { contains: search, mode: 'insensitive' } },
                    { cgNumber: { contains: search, mode: 'insensitive' } },
                    { country: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        // Try cache for list without search
        if (!search) {
            const cacheKey = `${this.CACHE_KEY}:list:${page}:${limit}:${sortBy}:${sortOrder}`;
            const cached = await this.redisService.getCache(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.clientGroup.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: sortOrder },
                include: {
                    creator: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    updater: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            }),
            this.prisma.clientGroup.count({ where }),
        ]);

        const response = new PaginatedResponse(data, total, page, limit);

        // Cache if no search
        if (!search) {
            const cacheKey = `${this.CACHE_KEY}:list:${page}:${limit}:${sortBy}:${sortOrder}`;
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
        }

        return response;
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterClientGroupDto = { status: ClientGroupStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const clientGroup = await this.prisma.clientGroup.findFirst({
            where: { id, deletedAt: null },
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
            where: { groupCode, deletedAt: null },
        });

        if (!clientGroup) {
            throw new NotFoundException('Client group not found');
        }

        return clientGroup;
    }

    async update(id: string, dto: UpdateClientGroupDto, userId: string) {
        const existing = await this.findById(id);

        // Check for duplicate group code if being updated
        if (dto.groupCode && dto.groupCode !== existing.groupCode) {
            const duplicate = await this.prisma.clientGroup.findUnique({
                where: { groupCode: dto.groupCode },
            });

            if (duplicate) {
                throw new ConflictException('Group code already exists');
            }
        }

        const updated = await this.prisma.clientGroup.update({
            where: { id },
            data: {
                ...dto,
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
        const existing = await this.findById(id);

        await this.prisma.clientGroup.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                deletedBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'DELETE', id, existing, null);

        return { message: 'Client group deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientGroupDto, userId: string) {
        const results = [];
        const errors = [];

        await this.prisma.$transaction(async (tx) => {
            for (const clientGroupDto of dto.clientGroups) {
                try {
                    // Check duplicate
                    const existing = await tx.clientGroup.findUnique({
                        where: { groupCode: clientGroupDto.groupCode },
                    });

                    if (existing) {
                        errors.push({
                            groupCode: clientGroupDto.groupCode,
                            error: 'Group code already exists',
                        });
                        continue;
                    }

                    const cgNumber = await this.generateCgNumber();

                    const created = await tx.clientGroup.create({
                        data: {
                            ...clientGroupDto,
                            cgNumber,
                            status: clientGroupDto.status || ClientGroupStatus.ACTIVE,
                            createdBy: userId,
                        },
                    });

                    results.push(created);
                } catch (error) {
                    errors.push({
                        groupCode: clientGroupDto.groupCode,
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

    async bulkUpdate(dto: BulkUpdateClientGroupDto, userId: string) {
        const results = [];
        const errors = [];

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
        const results = [];
        const errors = [];

        await this.prisma.$transaction(async (tx) => {
            for (const id of dto.ids) {
                try {
                    await tx.clientGroup.update({
                        where: { id },
                        data: {
                            deletedAt: new Date(),
                            deletedBy: userId,
                        },
                    });

                    results.push(id);
                } catch (error) {
                    errors.push({
                        id,
                        error: error.message,
                    });
                }
            }
        });

        await this.invalidateCache();

        return {
            success: results.length,
            failed: errors.length,
            deletedIds: results,
            errors,
        };
    }

    async restore(id: string, userId: string) {
        const clientGroup = await this.prisma.clientGroup.findUnique({
            where: { id },
        });

        if (!clientGroup) {
            throw new NotFoundException('Client group not found');
        }

        const restored = await this.prisma.clientGroup.update({
            where: { id },
            data: {
                deletedAt: null,
                deletedBy: null,
                updatedBy: userId,
            },
        });

        await this.invalidateCache();

        return restored;
    }

    async uploadExcel(file: Express.Multer.File, userId: string) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer);

        const worksheet = workbook.getWorksheet(1);
        if (!worksheet) {
            throw new BadRequestException('Invalid Excel file');
        }

        const clientGroups: CreateClientGroupDto[] = [];
        const errors = [];

        // Validate headers
        const headers = worksheet.getRow(1).values as any[];
        const expectedHeaders = ['groupNo', 'groupName', 'groupCode', 'country', 'status', 'remark'];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            try {
                const values = row.values as any[];

                clientGroups.push({
                    groupNo: values[1]?.toString() || '',
                    groupName: values[2]?.toString() || '',
                    groupCode: values[3]?.toString() || '',
                    country: values[4]?.toString() || '',
                    status: values[5] as ClientGroupStatus || ClientGroupStatus.ACTIVE,
                    remark: values[6]?.toString(),
                });
            } catch (error) {
                errors.push({
                    row: rowNumber,
                    error: error.message,
                });
            }
        });

        if (clientGroups.length === 0) {
            throw new BadRequestException('No valid data found in Excel file');
        }

        const result = await this.bulkCreate({ clientGroups }, userId);

        return {
            ...result,
            parseErrors: errors,
        };
    }

    private async generateCgNumber(): Promise<string> {
        const prefix = this.configService.get('CG_NUMBER_PREFIX', 'CG-');
        const startNumber = parseInt(this.configService.get('CG_NUMBER_START', '11001'));

        // Get the last CG number
        const lastClientGroup = await this.prisma.clientGroup.findFirst({
            orderBy: { cgNumber: 'desc' },
            select: { cgNumber: true },
        });

        let nextNumber = startNumber;

        if (lastClientGroup) {
            const lastNumber = parseInt(lastClientGroup.cgNumber.replace(prefix, ''));
            nextNumber = lastNumber + 1;
        }

        return `${prefix}${nextNumber}`;
    }

    private async invalidateCache() {
        await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:*`);
    }

    private async logAudit(userId: string, action: string, entityId: string, oldValue: any, newValue: any) {
        await this.prisma.auditLog.create({
            data: {
                userId,
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
