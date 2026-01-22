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
import {
    CreateClientCompanyDto,
    UpdateClientCompanyDto,
    BulkCreateClientCompanyDto,
    BulkUpdateClientCompanyDto,
    BulkDeleteClientCompanyDto,
    ChangeStatusDto,
    FilterClientCompanyDto,
} from './dto/client-company.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { CompanyStatus, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class ClientCompanyService {
    private readonly logger = new Logger(ClientCompanyService.name);
    private readonly CACHE_TTL = 300; // 5 minutes
    private readonly CACHE_KEY = 'client_companies';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

    async create(dto: CreateClientCompanyDto, userId: string) {
        // Check for duplicate company code
        const existing = await this.prisma.clientCompany.findUnique({
            where: { companyCode: dto.companyCode },
        });

        if (existing) {
            throw new ConflictException('Company code already exists');
        }

        // Verify group exists
        const group = await this.prisma.clientGroup.findFirst({
            where: { id: dto.groupId },
        });

        if (!group) {
            throw new NotFoundException('Client group not found');
        }

        // Generate Company Number
        const generatedCompanyNo = await this.autoNumberService.generateCompanyNo();

        const company = await this.prisma.clientCompany.create({
            data: {
                ...dto,
                companyNo: dto.companyNo || generatedCompanyNo,
                status: dto.status || CompanyStatus.ACTIVE,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', company.id, null, company);

        return company;
    }

    async findAll(pagination: PaginationDto, filter?: FilterClientCompanyDto) {
        const {
            page = 1,
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.ClientCompanyWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.ClientCompanyWhereInput>;

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

        if (filter?.groupId) andArray.push({ groupId: filter.groupId });
        if (filter?.companyName) andArray.push(buildMultiValueFilter('companyName', filter.companyName));
        if (filter?.companyNo) andArray.push(buildMultiValueFilter('companyNo', filter.companyNo));
        if (filter?.companyCode) andArray.push(buildMultiValueFilter('companyCode', filter.companyCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const orConditions: Prisma.ClientCompanyWhereInput[] = [
                { companyName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { companyCode: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { companyNo: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { address: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { remark: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { group: { groupName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
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

        if (andArray.length === 0) delete where.AND;

        const [data, total] = await Promise.all([
            this.prisma.clientCompany.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                include: {
                    group: {
                        select: {
                            id: true,
                            groupName: true,
                            groupCode: true,
                        },
                    },
                },
            }),
            this.prisma.clientCompany.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientGroup: item.group,
            groupName: item.group?.groupName, // Flattened for table column accessor
        }));

        return new PaginatedResponse(mappedData, total, page, limit);
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterClientCompanyDto = { status: CompanyStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const company = await this.prisma.clientCompany.findFirst({
            where: { id },
            include: {
                group: {
                    select: {
                        id: true,
                        groupName: true,
                        groupCode: true,
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

        if (!company) {
            throw new NotFoundException('Client company not found');
        }

        return company;
    }

    async findByCompanyCode(companyCode: string) {
        const company = await this.prisma.clientCompany.findFirst({
            where: { companyCode },
        });

        if (!company) {
            throw new NotFoundException('Client company not found');
        }

        return company;
    }

    async update(id: string, dto: UpdateClientCompanyDto, userId: string) {
        const existing = await this.findById(id);

        // Check for duplicate company code if being updated
        if (dto.companyCode && dto.companyCode !== existing.companyCode) {
            const duplicate = await this.prisma.clientCompany.findUnique({
                where: { companyCode: dto.companyCode },
            });

            if (duplicate) {
                throw new ConflictException('Company code already exists');
            }
        }

        // Verify group exists if being updated
        if (dto.groupId) {
            const group = await this.prisma.clientGroup.findFirst({
                where: { id: dto.groupId },
            });

            if (!group) {
                throw new NotFoundException('Client group not found');
            }
        }

        const updated = await this.prisma.clientCompany.update({
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

        const updated = await this.prisma.clientCompany.update({
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

        await this.prisma.clientCompany.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Client company and all associated data permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientCompanyDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.companies.length} records`);
        const errors: any[] = [];

        // 1. Fetch current data for uniqueness
        const allExisting = await this.prisma.clientCompany.findMany({
            select: { companyCode: true, companyNo: true },
        });
        const existingCodes = new Set(allExisting.map((x) => x.companyCode));
        const existingNos = new Set(allExisting.map((x) => x.companyNo));

        const prefix = 'CC-';
        const startNo = await this.autoNumberService.generateCompanyNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        // 2. Pre-process in memory
        for (const companyDto of dto.companies) {
            try {
                const companyName = companyDto.companyName?.trim() || companyDto.companyCode || 'Unnamed Company';

                // Unique code logic
                let finalCompanyCode = companyDto.companyCode?.trim() || `COMP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                if (existingCodes.has(finalCompanyCode)) {
                    let suffix = 1;
                    const originalCode = finalCompanyCode;
                    while (existingCodes.has(`${originalCode}-${suffix}`)) {
                        suffix++;
                    }
                    finalCompanyCode = `${originalCode}-${suffix}`;
                }
                existingCodes.add(finalCompanyCode);

                // Unique number logic
                let finalCompanyNo = companyDto.companyNo?.trim();
                if (!finalCompanyNo || existingNos.has(finalCompanyNo)) {
                    finalCompanyNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalCompanyNo)) {
                        finalCompanyNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalCompanyNo);

                dataToInsert.push({
                    ...companyDto,
                    companyName,
                    companyCode: finalCompanyCode,
                    companyNo: finalCompanyNo,
                    status: companyDto.status || CompanyStatus.ACTIVE,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ companyCode: companyDto.companyCode, error: err.message });
            }
        }

        // 3. Batched Inserts
        const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        for (const chunk of chunks) {
            try {
                await this.prisma.clientCompany.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.companies.length} | Inserted Approx: ${dataToInsert.length} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: dataToInsert.length,
            failed: errors.length,
            message: `Successfully processed ${dataToInsert.length} records.`,
            errors,
        };
    }

    async bulkUpdate(dto: BulkUpdateClientCompanyDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.clientCompany.update({
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

    async bulkDelete(dto: BulkDeleteClientCompanyDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        for (const id of dto.ids) {
            try {
                const existing = await this.prisma.clientCompany.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.clientCompany.delete({
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
        this.logger.log(
            `[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`,
        );

        // Column mapping - Accept GROUP NAME instead of groupId
        const columnMapping = {
            companyNo: ['companyno', 'companynumber', 'no', 'number'],
            companyName: ['companyname', 'name', 'cname', 'company'],
            companyCode: ['companycode', 'code', 'ccode'],
            groupName: ['groupname', 'clientgroupname', 'group', 'clientgroup'],
            address: ['address', 'physicaladdress', 'street', 'companyaddress', 'addr'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['companyName', 'companyCode', 'groupName'];

        const { data, errors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException(
                'No valid data found to import. Please check file format and column names (Required: companyname, companycode, groupname).',
            );
        }

        // 1. Resolve all groupNames to groupIds in one go to avoid N+1 queries
        const groupNames = Array.from(new Set(data.filter(row => row.groupName).map(row => row.groupName)));
        const groups = await this.prisma.clientGroup.findMany({
            where: { groupName: { in: groupNames } },
            select: { id: true, groupName: true }
        });
        const groupMap = new Map(groups.map(g => [g.groupName.toLowerCase(), g.id]));

        // 2. Validate status and build processing data
        const processedData: CreateClientCompanyDto[] = [];
        for (const row of data) {
            try {
                if (row.status) {
                    this.excelUploadService.validateEnum(row.status as string, CompanyStatus, 'Status');
                }

                const groupId = groupMap.get(row.groupName?.toLowerCase());
                if (!groupId) {
                    this.logger.warn(`[UPLOAD_WARN] Skipping row: Client Group not found: ${row.groupName}`);
                    continue;
                }

                processedData.push({
                    companyNo: row.companyNo,
                    companyName: row.companyName,
                    companyCode: row.companyCode,
                    groupId: groupId,
                    address: row.address,
                    status: row.status as CompanyStatus,
                    remark: row.remark,
                });
            } catch (err) {
                this.logger.error(`[UPLOAD_ROW_ERROR] ${err.message}`);
            }
        }

        const result = await this.bulkCreate({ companies: processedData }, userId);

        if (result.success === 0 && result.failed > 0) {
            const firstError = result.errors?.[0]?.error || 'Unknown validation error';
            throw new BadRequestException(
                `Upload Failed: All ${result.failed} records failed validation. Example error: ${firstError}`,
            );
        }

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
                userId,
                action,
                entity: 'ClientCompany',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
