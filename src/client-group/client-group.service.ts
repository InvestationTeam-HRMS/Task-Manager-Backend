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
        const generatedGroupNo = await this.autoNumberService.generateClientGroupNo();

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
        const { page = 1, limit = 25, search, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.ClientGroupWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.ClientGroupWhereInput>;

        // Handle Status Filter (handle possible multi-select from UI)
        if (filter?.status) {
            const statusValues = typeof filter.status === 'string'
                ? filter.status.split(/[,\:;]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.status) ? filter.status : [filter.status];

            if (statusValues.length > 0) {
                andArray.push({
                    status: { in: statusValues as any }
                });
            }
        }

        if (filter?.country) andArray.push(buildMultiValueFilter('country', filter.country));
        if (filter?.groupName) andArray.push(buildMultiValueFilter('groupName', filter.groupName));
        if (filter?.groupNo) andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
        if (filter?.groupCode) andArray.push(buildMultiValueFilter('groupCode', filter.groupCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const orConditions: Prisma.ClientGroupWhereInput[] = [
                { groupName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { groupCode: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { groupNo: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { country: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { remark: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
            ];

            const searchLower = cleanedSearch.toLowerCase();
            if ('active'.includes(searchLower) && searchLower.length >= 3) {
                orConditions.push({ status: 'ACTIVE' as any });
            }
            if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
                orConditions.push({ status: 'INACTIVE' as any });
            }

            andArray.push({ OR: orConditions });
        }

        // Clean up empty AND if necessary
        if (andArray.length === 0) delete where.AND;

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

        await this.prisma.clientGroup.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Client group and all associated data permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientGroupDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.clientGroups.length} records`);

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
                const groupName = clientGroupDto.groupName?.trim() || clientGroupDto.groupCode || 'Unnamed Group';

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
                    groupCode: finalGroupCode,
                    groupNo: finalGroupNo,
                    status: clientGroupDto.status || ClientGroupStatus.ACTIVE,
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

        for (const chunk of chunks) {
            try {
                await this.prisma.clientGroup.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.clientGroups.length} | Inserted Approx: ${dataToInsert.length} | Errors: ${errors.length}`);

        await this.invalidateCache();

        return {
            success: dataToInsert.length,
            failed: errors.length,
            message: `Successfully processed ${dataToInsert.length} records.`,
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

        for (const id of dto.ids) {
            try {
                const existing = await this.prisma.clientGroup.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.clientGroup.delete({
                    where: { id },
                });

                await this.logAudit(userId, 'HARD_DELETE', id, existing, null);
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

        // Read header row (Row 1) to determine column indices dynamically
        const headerRow = worksheet.getRow(1);
        const headers: Record<string, number> = {};

        headerRow.eachCell((cell, colNumber) => {
            const val = cell.value?.toString().toLowerCase().trim().replace(/[\s_-]/g, '') || '';
            if (val) headers[val] = colNumber;
        });

        this.logger.log(`[UPLOAD_HEADERS] Found: ${JSON.stringify(headers)}`);

        // Define mandatory and optional column keys (normalized)
        // STRICT MATCHING: Only accept exact Client Group column names
        const keys = {
            groupNo: ['groupno', 'groupnumber'],
            groupName: ['groupname'],  // REMOVED 'name' - too generic
            groupCode: ['groupcode'],  // REMOVED 'code' - too generic
            country: ['country', 'location'],
            status: ['status'],
            remark: ['remark', 'remarks', 'notes', 'description']
        };

        const getColKey = (possibleKeys: string[]) => possibleKeys.find(k => headers[k] !== undefined);

        const keyName = getColKey(keys.groupName);
        const keyCode = getColKey(keys.groupCode);
        const keyStatus = getColKey(keys.status);
        const keyNo = getColKey(keys.groupNo);
        const keyCountry = getColKey(keys.country);
        const keyRemark = getColKey(keys.remark);

        if (!keyName || !keyCode) {
            throw new BadRequestException('Invalid format');
        }

        const clientGroups: CreateClientGroupDto[] = [];
        const parseErrors: any[] = [];

        this.logger.log(`[UPLOAD_DATA] Processing worksheet with ${worksheet.rowCount} max rows.`);

        // Use a standard loop
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            if (!row || !row.hasValues) continue;

            try {
                const getVal = (key: string | undefined) => {
                    if (!key || !headers[key]) return '';
                    const colIdx = headers[key];
                    const cell = row.getCell(colIdx);
                    if (!cell || cell.value === null || cell.value === undefined) return '';

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

                const groupNo = getVal(keyNo);
                const groupName = getVal(keyName);
                const groupCode = getVal(keyCode);
                const country = getVal(keyCountry);
                const statusRaw = getVal(keyStatus).toUpperCase();
                const remark = getVal(keyRemark);

                if (!groupName || !groupCode) {
                    throw new Error('Missing required fields: Group Name or Group Code');
                }

                if (keyStatus && statusRaw && statusRaw !== 'ACTIVE' && statusRaw !== 'INACTIVE') {
                    throw new Error(`Invalid Status: "${statusRaw}". Allowed: ACTIVE, INACTIVE`);
                }

                clientGroups.push({
                    groupNo,
                    groupName,
                    groupCode,
                    country,
                    status: (statusRaw as ClientGroupStatus) || ClientGroupStatus.ACTIVE,
                    remark,
                });

            } catch (e) {
                parseErrors.push({ row: i, error: e.message });
            }
        }

        this.logger.log(`[UPLOAD_PARSED_ALL] Parsed ${clientGroups.length} valid records. parseFailures: ${parseErrors.length}`);

        // FIRST CHECK: No valid records parsed at all
        if (clientGroups.length === 0) {
            this.logger.error(`[UPLOAD_VALIDATION_FAILED] No valid records found. Parse errors: ${parseErrors.length}`);
            throw new BadRequestException('No valid data found to import. Please check file format and column names (Required: groupname, groupcode).');
        }

        this.logger.log(`[UPLOAD_CALLING_BULK_CREATE] Attempting to create ${clientGroups.length} records...`);
        const result = await this.bulkCreate({ clientGroups }, userId);
        this.logger.log(`[UPLOAD_BULK_CREATE_RESULT] Success: ${result.success}, Failed: ${result.failed}`);

        // SECOND CHECK: All records failed validation in bulkCreate
        if (result.success === 0 && result.failed > 0) {
            const firstError = result.errors?.[0]?.error || 'Unknown validation error';
            this.logger.error(`[UPLOAD_ALL_FAILED] ${result.failed} records failed. First error: ${firstError}`);
            throw new BadRequestException(`Upload Failed: All ${result.failed} records failed validation. Example error: ${firstError}`);
        }

        this.logger.log(`[UPLOAD_SUCCESS] Returning result with ${result.success} successful records`);
        return result;
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
