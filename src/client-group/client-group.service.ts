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
import { PassThrough } from 'stream';

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

        // Generate Group Number
        const generatedGroupNo = await this.generateGroupNo();

        const clientGroup = await this.prisma.clientGroup.create({
            data: {
                ...dto,
                groupNo: dto.groupNo || generatedGroupNo,
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
                    { groupName: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    { groupCode: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    { groupNo: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    { country: { contains: search, mode: Prisma.QueryMode.insensitive } },
                ],
            }),
        };

        const [data, total] = await Promise.all([
            this.prisma.clientGroup.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
            }),
            this.prisma.clientGroup.count({ where }),
        ]);

        return new PaginatedResponse(data, total, page, limit);
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
        const results: any[] = [];
        const errors: any[] = [];

        // Pre-fetch the base starting number to avoid duplicate generation issues in transaction
        let currentGroupNoStr = await this.generateGroupNo();
        const prefix = this.configService.get('CG_NUMBER_PREFIX', 'CG-');
        let currentNum = parseInt(currentGroupNoStr.replace(prefix, ''));

        await this.prisma.$transaction(async (tx) => {
            // Get all existing groupCodes to check against
            const existingGroups = await tx.clientGroup.findMany({
                select: { groupCode: true }
            });
            const existingCodes = new Set(existingGroups.map(g => g.groupCode));
            const codesInCurrentBatch = new Set<string>();

            for (const clientGroupDto of dto.clientGroups) {
                try {
                    let finalGroupCode = clientGroupDto.groupCode;

                    // If groupCode is already in DB or in this batch, make it unique
                    let suffix = 1;
                    const originalCode = finalGroupCode;
                    while (existingCodes.has(finalGroupCode) || codesInCurrentBatch.has(finalGroupCode)) {
                        finalGroupCode = `${originalCode}-${suffix}`;
                        suffix++;
                    }
                    codesInCurrentBatch.add(finalGroupCode);

                    // Generate unique Group No
                    let finalGroupNo = clientGroupDto.groupNo;
                    if (!finalGroupNo || finalGroupNo.trim() === '') {
                        finalGroupNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }

                    const created = await tx.clientGroup.create({
                        data: {
                            ...clientGroupDto,
                            groupCode: finalGroupCode,
                            groupNo: finalGroupNo,
                            status: clientGroupDto.status || ClientGroupStatus.ACTIVE,
                            createdBy: userId,
                        },
                    });

                    results.push(created);
                } catch (error) {
                    this.logger.error(`[BULK_CREATE_ERROR] Row failed: ${clientGroupDto.groupCode} - Error: ${error.message}`);
                    errors.push({
                        groupCode: clientGroupDto.groupCode,
                        error: error.message,
                    });
                }
            }
        });

        this.logger.log(`[BULK_CREATE_COMPLETED] Success: ${results.length}, Failed: ${errors.length}`);

        await this.invalidateCache();

        return {
            success: results.length,
            failed: errors.length,
            results,
            errors,
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

        await this.prisma.$transaction(async (tx) => {
            for (const id of dto.ids) {
                try {
                    // HARD DELETE
                    await tx.clientGroup.delete({
                        where: { id },
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
        this.logger.log(`[UPLOAD_V4_DEPLOYED] File: ${file?.originalname} | Size: ${file?.size}`);

        if (!file || !file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('No file data received.');
        }

        const buffer = file.buffer;
        const fileName = file.originalname.toLowerCase();

        // 1. Identify format: XLSX starts with 'PK' (0x50 0x4B)
        const isXlsxSignature = buffer[0] === 0x50 && buffer[1] === 0x4B;
        const isCsvExtension = fileName.endsWith('.csv');

        const workbook = new ExcelJS.Workbook();
        let formatUsed = '';

        try {
            if (isXlsxSignature) {
                formatUsed = 'XLSX';
                this.logger.log(`[UPLOAD_PARSER] Using XLSX parser for ${fileName}`);
                await workbook.xlsx.load(buffer as any);
            } else if (isCsvExtension || fileName.endsWith('.txt')) {
                formatUsed = 'CSV';
                this.logger.log(`[UPLOAD_PARSER] Using CSV parser for ${fileName}`);
                const bufferStream = new PassThrough();
                bufferStream.end(buffer as any);
                await workbook.csv.read(bufferStream);
            } else {
                throw new BadRequestException('Unsupported file format. Please upload a valid .xlsx or .csv file.');
            }
        } catch (error) {
            this.logger.error(`[UPLOAD_PARSE_FAILED] Format: ${formatUsed}, File: ${fileName}, Error: ${error.message}`);
            // If it's already a BadRequestException, rethrow it
            if (error instanceof BadRequestException) throw error;
            // Otherwise, wrap in a friendly message
            throw new BadRequestException(`Failed to parse ${formatUsed} file. Please ensure the file is not corrupted.`);
        }

        const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount < 2) {
            throw new BadRequestException('The file is empty or missing data rows.');
        }

        const clientGroups: CreateClientGroupDto[] = [];
        const parseErrors: any[] = [];

        this.logger.log(`[UPLOAD_DATA] Processing worksheet with ${worksheet.rowCount} max rows.`);

        // Use a standard loop to ensure we check every row up to rowCount
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);

            // Check if row has any data (built-in check + our custom check)
            if (!row || !row.hasValues) continue;

            try {
                const getVal = (idx: number) => {
                    const cell = row.getCell(idx);
                    if (!cell || cell.value === null || cell.value === undefined) return '';

                    // Handle ExcelJS value objects (formulas, shared strings, etc)
                    const val = cell.value;
                    if (typeof val === 'object') {
                        if ('result' in (val as any)) return (val as any).result?.toString().trim() || '';
                        if ('text' in (val as any)) return (val as any).text?.toString().trim() || '';
                        if ('richText' in (val as any)) {
                            return (val as any).richText.map((rt: any) => rt.text).join('').trim();
                        }
                        return '';
                    }
                    return val.toString().trim();
                };

                const groupName = getVal(2);
                const groupCode = getVal(3);

                // Basic validation: if both name and code are missing, it's likely an empty row or junk
                if (!groupName && !groupCode) {
                    continue;
                }

                clientGroups.push({
                    groupNo: getVal(1),
                    groupName: groupName,
                    groupCode: groupCode,
                    country: getVal(4),
                    status: (getVal(5).toUpperCase() as ClientGroupStatus) || ClientGroupStatus.ACTIVE,
                    remark: getVal(6),
                });

                this.logger.debug(`[UPLOAD_PARSED] Row ${i}: Found ${groupCode}`);
            } catch (e) {
                this.logger.error(`[UPLOAD_PARSE_ROW_ERROR] Row ${i}: ${e.message}`);
                parseErrors.push({ row: i, error: e.message });
            }
        }

        this.logger.log(`[UPLOAD_PARSED_ALL] Successfully parsed ${clientGroups.length} records. Failures: ${parseErrors.length}`);

        if (clientGroups.length === 0) {
            throw new BadRequestException('No valid data found to import.');
        }

        return this.bulkCreate({ clientGroups }, userId);
    }

    private async generateGroupNo(): Promise<string> {
        const prefix = this.configService.get('CG_NUMBER_PREFIX', 'CG-');
        const startNumber = parseInt(this.configService.get('CG_NUMBER_START', '11001'));

        // Get the last Group number
        const lastClientGroup = await this.prisma.clientGroup.findFirst({
            orderBy: { groupNo: 'desc' },
            select: { groupNo: true },
        });

        let nextNumber = startNumber;

        if (lastClientGroup) {
            const lastNumber = parseInt(lastClientGroup.groupNo.replace(prefix, ''));
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
