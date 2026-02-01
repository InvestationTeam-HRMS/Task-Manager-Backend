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
        private excelDownloadService: ExcelDownloadService,
    ) { }

    async create(dto: CreateClientCompanyDto, userId: string) {
        // Transform companyCode to uppercase
        const companyCodeUpper = dto.companyCode.toUpperCase();

        // Check for duplicate company code
        const existing = await this.prisma.clientCompany.findUnique({
            where: { companyCode: companyCodeUpper },
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
        const { toTitleCase } = await import('../common/utils/string-helper');

        const company = await this.prisma.clientCompany.create({
            data: {
                ...dto,
                companyCode: companyCodeUpper,
                companyName: toTitleCase(dto.companyName),
                address: dto.address ? toTitleCase(dto.address) : undefined,
                companyNo: dto.companyNo || generatedCompanyNo,
                remark: dto.remark ? toTitleCase(dto.remark) : undefined,
                status: dto.status || CompanyStatus.Active,
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
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Handle Status Filter (handle possible multi-select from UI)
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

        if (filter?.groupId) {
            const groupIds = typeof filter.groupId === 'string'
                ? filter.groupId.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.groupId) ? filter.groupId : [filter.groupId];

            if (groupIds.length > 0) {
                andArray.push({
                    groupId: { in: groupIds }
                });
            }
        }
        if (filter?.companyName) andArray.push(buildMultiValueFilter('companyName', toTitleCase(filter.companyName)));
        if (filter?.companyNo) andArray.push(buildMultiValueFilter('companyNo', filter.companyNo));
        if (filter?.companyCode) andArray.push(buildMultiValueFilter('companyCode', filter.companyCode));
        if (filter?.address) andArray.push(buildMultiValueFilter('address', toTitleCase(filter.address)));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));

        if (filter?.groupName) {
            const groupFilter = buildMultiValueFilter('groupName', toTitleCase(filter.groupName));
            if (groupFilter) {
                andArray.push({
                    group: groupFilter
                });
            }
        }

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.ClientCompanyWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);

                const looksLikeCode = /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeCode) {
                    allSearchConditions.push({ companyCode: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ companyNo: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ companyCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ companyNo: { contains: val, mode: 'insensitive' } });
                } else {
                    allSearchConditions.push({ companyName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ companyName: { contains: searchTitle, mode: 'insensitive' } });
                    allSearchConditions.push({ companyCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ companyNo: { contains: val, mode: 'insensitive' } });
                }

                allSearchConditions.push({ address: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ address: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ group: { groupName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ group: { groupName: { contains: searchTitle, mode: 'insensitive' } } });

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
                this.logger.log(`[CACHE_HIT] ClientCompany List - ${cacheKey}`);
                return cached;
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.clientCompany.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                select: {
                    id: true,
                    companyNo: true,
                    companyName: true,
                    companyCode: true,
                    address: true,
                    status: true,
                    remark: true,
                    createdAt: true,
                    groupId: true,
                    group: {
                        select: {
                            id: true,
                            groupName: true,
                        },
                    },
                    _count: {
                        select: { locations: true, teams: true }
                    }
                },
            }),
            this.prisma.clientCompany.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientGroup: item.group,
            groupName: item.group?.groupName, // Flattened for table column accessor
        }));

        const response = new PaginatedResponse(mappedData, total, page, limit);

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
            this.logger.log(`[CACHE_MISS] ClientCompany List - Cached result: ${cacheKey}`);
        }

        return response;
    }

    async downloadExcel(query: any, userId: string, res: any) {
        const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

        const mappedData = data.map((item, index) => ({
            srNo: index + 1,
            companyNo: item.companyNo,
            companyName: item.companyName,
            companyCode: item.companyCode,
            group: item.group?.groupName || 'N/A',
            address: item.address || 'N/A',
            status: item.status,
            remark: item.remark || 'N/A',
        }));

        const columns = [
            { header: '#', key: 'srNo', width: 10 },
            { header: 'Company No', key: 'companyNo', width: 15 },
            { header: 'Company Name', key: 'companyName', width: 30 },
            { header: 'Company Code', key: 'companyCode', width: 15 },
            { header: 'Group', key: 'group', width: 25 },
            { header: 'Address', key: 'address', width: 35 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Remark', key: 'remark', width: 30 },
        ];

        await this.excelDownloadService.downloadExcel(res, mappedData, columns, 'client_companies.xlsx', 'Client Companies');
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterClientCompanyDto = { status: CompanyStatus.Active };
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
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Transform companyCode to uppercase if provided
        const companyCodeUpper = dto.companyCode ? dto.companyCode.toUpperCase() : undefined;

        // Check for duplicate company code if being updated
        if (companyCodeUpper && companyCodeUpper !== existing.companyCode) {
            const duplicate = await this.prisma.clientCompany.findUnique({
                where: { companyCode: companyCodeUpper },
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
                companyCode: companyCodeUpper,
                companyName: dto.companyName ? toTitleCase(dto.companyName) : undefined,
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
        const company = await this.prisma.clientCompany.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        locations: true,
                        subLocations: true,
                        projects: true,
                        teams: true,
                        ipAddresses: true,
                    }
                }
            }
        });

        if (!company) {
            throw new NotFoundException('Client company not found');
        }

        const { _count } = company;
        const childCounts = [
            _count.locations > 0 && `${_count.locations} locations`,
            _count.subLocations > 0 && `${_count.subLocations} sub-locations`,
            _count.projects > 0 && `${_count.projects} projects`,
            _count.teams > 0 && `${_count.teams} teams`,
            _count.ipAddresses > 0 && `${_count.ipAddresses} IP addresses`,
        ].filter(Boolean);

        if (childCounts.length > 0) {
            throw new BadRequestException(
                `Cannot delete Client Company because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`
            );
        }

        await this.prisma.clientCompany.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, company, null);

        return { message: 'Client company deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientCompanyDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.companies.length} records`);
        const { toTitleCase } = await import('../common/utils/string-helper');

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
                const companyName = toTitleCase(companyDto.companyName?.trim() || companyDto.companyCode || 'Unnamed Company');
                const address = companyDto.address ? toTitleCase(companyDto.address) : undefined;
                const remark = companyDto.remark ? toTitleCase(companyDto.remark) : undefined;

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
                    address,
                    remark,
                    companyCode: finalCompanyCode,
                    companyNo: finalCompanyNo,
                    status: companyDto.status || CompanyStatus.Active,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ companyCode: companyDto.companyCode, error: err.message });
            }
        }

        // 3. Batched Inserts
        const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        let totalInserted = 0;
        for (const chunk of chunks) {
            try {
                const result = await this.prisma.clientCompany.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                totalInserted += result.count;
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.companies.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.companies.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
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

    async bulkDelete(dto: BulkDeleteClientCompanyDto, userId: string) {
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

    async uploadExcel(file: Express.Multer.File, userId: string) {
        this.logger.log(`[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`);

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

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        // 1. Resolve all groupNames to groupIds
        const groupNames = Array.from(new Set(data.filter(row => row.groupName).map(row => row.groupName)));
        const groups = await this.prisma.clientGroup.findMany({
            where: { groupName: { in: groupNames } },
            select: { id: true, groupName: true }
        });
        const groupMap = new Map(groups.map(g => [g.groupName.toLowerCase(), g.id]));

        // 2. Build processing data
        const processedData: CreateClientCompanyDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = row.status ? this.excelUploadService.validateEnum(row.status as string, CompanyStatus, 'Status') : CompanyStatus.Active;

                const groupId = groupMap.get(row.groupName?.toLowerCase());
                if (!groupId) {
                    throw new Error(`Client Group not found: ${row.groupName}`);
                }

                processedData.push({
                    companyNo: row.companyNo,
                    companyName: row.companyName,
                    companyCode: row.companyCode,
                    groupId: groupId,
                    address: row.address,
                    status: status as CompanyStatus,
                    remark: row.remark,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ companies: processedData }, userId);

        result.errors = [...(result.errors || []), ...parseErrors, ...processingErrors];
        result.failed += parseErrors.length + processingErrors.length;

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
                entity: 'ClientCompany',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
