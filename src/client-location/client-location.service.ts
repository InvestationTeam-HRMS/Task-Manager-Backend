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
    CreateClientLocationDto,
    UpdateClientLocationDto,
    BulkCreateClientLocationDto,
    BulkUpdateClientLocationDto,
    BulkDeleteClientLocationDto,
    ChangeStatusDto,
    FilterClientLocationDto,
} from './dto/client-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { LocationStatus, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class ClientLocationService {
    private readonly logger = new Logger(ClientLocationService.name);
    private readonly CACHE_TTL = 300;
    private readonly CACHE_KEY = 'client_locations';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

    async create(dto: CreateClientLocationDto, userId: string) {
        const existing = await this.prisma.clientLocation.findUnique({
            where: { locationCode: dto.locationCode },
        });

        if (existing) {
            throw new ConflictException('Location code already exists');
        }

        const company = await this.prisma.clientCompany.findFirst({
            where: { id: dto.companyId },
        });

        if (!company) {
            throw new NotFoundException('Client company not found');
        }

        const generatedLocationNo = await this.autoNumberService.generateLocationNo();
        const { toTitleCase } = await import('../common/utils/string-helper');

        const location = await this.prisma.clientLocation.create({
            data: {
                ...dto,
                locationName: toTitleCase(dto.locationName),
                address: dto.address ? toTitleCase(dto.address) : undefined,
                locationNo: dto.locationNo || generatedLocationNo,
                remark: dto.remark ? toTitleCase(dto.remark) : undefined,
                status: dto.status || LocationStatus.ACTIVE,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', location.id, null, location);

        return location;
    }

    async findAll(pagination: PaginationDto, filter?: FilterClientLocationDto) {
        const {
            page = 1,
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.ClientLocationWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.ClientLocationWhereInput>;
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

        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.locationName) andArray.push(buildMultiValueFilter('locationName', toTitleCase(filter.locationName)));
        if (filter?.locationNo) andArray.push(buildMultiValueFilter('locationNo', filter.locationNo));
        if (filter?.locationCode) andArray.push(buildMultiValueFilter('locationCode', filter.locationCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.ClientLocationWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);

                const looksLikeCode = /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeCode) {
                    allSearchConditions.push({ locationCode: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ locationNo: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ locationCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ locationNo: { contains: val, mode: 'insensitive' } });
                } else {
                    allSearchConditions.push({ locationName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ locationName: { contains: searchTitle, mode: 'insensitive' } });
                    allSearchConditions.push({ locationCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ locationNo: { contains: val, mode: 'insensitive' } });
                }

                allSearchConditions.push({ address: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ address: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ company: { companyName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ company: { companyName: { contains: searchTitle, mode: 'insensitive' } } });

                if ('active'.includes(searchLower) && searchLower.length >= 3) {
                    allSearchConditions.push({ status: 'ACTIVE' as any });
                }
                if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
                    allSearchConditions.push({ status: 'INACTIVE' as any });
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
                this.logger.log(`[CACHE_HIT] ClientLocation List - ${cacheKey}`);
                return cached;
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.clientLocation.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                select: {
                    id: true,
                    locationNo: true,
                    locationName: true,
                    locationCode: true,
                    address: true,
                    status: true,
                    remark: true,
                    createdAt: true,
                    companyId: true,
                    company: {
                        select: {
                            id: true,
                            companyName: true,
                            companyCode: true,
                        },
                    },
                    _count: {
                        select: { subLocations: true, teams: true, groups: true }
                    }
                },
            }),
            this.prisma.clientLocation.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientCompany: item.company,
            companyName: item.company?.companyName, // Flattened for table column accessor
        }));

        const response = new PaginatedResponse(mappedData, total, page, limit);

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
            this.logger.log(`[CACHE_MISS] ClientLocation List - Cached result: ${cacheKey}`);
        }

        return response;
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterClientLocationDto = { status: LocationStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const location = await this.prisma.clientLocation.findFirst({
            where: { id },
            include: {
                company: {
                    include: {
                        group: true,
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

        if (!location) {
            throw new NotFoundException('Client location not found');
        }

        return location;
    }

    async update(id: string, dto: UpdateClientLocationDto, userId: string) {
        const existing = await this.findById(id);
        const { toTitleCase } = await import('../common/utils/string-helper');

        if (dto.locationCode && dto.locationCode !== existing.locationCode) {
            const duplicate = await this.prisma.clientLocation.findUnique({
                where: { locationCode: dto.locationCode },
            });

            if (duplicate) {
                throw new ConflictException('Location code already exists');
            }
        }

        if (dto.companyId) {
            const company = await this.prisma.clientCompany.findFirst({
                where: { id: dto.companyId },
            });

            if (!company) {
                throw new NotFoundException('Client company not found');
            }
        }

        const updated = await this.prisma.clientLocation.update({
            where: { id },
            data: {
                ...dto,
                locationName: dto.locationName ? toTitleCase(dto.locationName) : undefined,
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

        const updated = await this.prisma.clientLocation.update({
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
        const location = await this.prisma.clientLocation.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        subLocations: true,
                        teams: true,
                        groups: true,
                        ipAddresses: true,
                    }
                }
            }
        });

        if (!location) {
            throw new NotFoundException('Client location not found');
        }

        const { _count } = location;
        const childCounts = [
            _count.subLocations > 0 && `${_count.subLocations} sub-locations`,
            _count.teams > 0 && `${_count.teams} teams`,
            _count.groups > 0 && `${_count.groups} groups`,
            _count.ipAddresses > 0 && `${_count.ipAddresses} IP addresses`,
        ].filter(Boolean);

        if (childCounts.length > 0) {
            throw new BadRequestException(
                `Cannot delete Client Location because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`
            );
        }

        await this.prisma.clientLocation.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, location, null);

        return { message: 'Client location deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientLocationDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.locations.length} records`);
        const { toTitleCase } = await import('../common/utils/string-helper');

        const errors: any[] = [];

        const allExisting = await this.prisma.clientLocation.findMany({
            select: { locationCode: true, locationNo: true },
        });
        const existingCodes = new Set(allExisting.map((x) => x.locationCode));
        const existingNos = new Set(allExisting.map((x) => x.locationNo));

        const prefix = 'CL-';
        const startNo = await this.autoNumberService.generateLocationNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const locationDto of dto.locations) {
            try {
                const locationName = toTitleCase(locationDto.locationName?.trim() || locationDto.locationCode || 'Unnamed Location');
                const address = locationDto.address ? toTitleCase(locationDto.address) : undefined;
                const remark = locationDto.remark ? toTitleCase(locationDto.remark) : undefined;

                // Unique code logic
                let finalLocationCode = locationDto.locationCode?.trim() || `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                if (existingCodes.has(finalLocationCode)) {
                    let suffix = 1;
                    const originalCode = finalLocationCode;
                    while (existingCodes.has(`${originalCode}-${suffix}`)) {
                        suffix++;
                    }
                    finalLocationCode = `${originalCode}-${suffix}`;
                }
                existingCodes.add(finalLocationCode);

                // Unique number logic
                let finalLocationNo = locationDto.locationNo?.trim();
                if (!finalLocationNo || existingNos.has(finalLocationNo)) {
                    finalLocationNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalLocationNo)) {
                        finalLocationNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalLocationNo);

                dataToInsert.push({
                    ...locationDto,
                    locationName,
                    address,
                    remark,
                    locationCode: finalLocationCode,
                    locationNo: finalLocationNo,
                    status: locationDto.status || LocationStatus.ACTIVE,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ locationCode: locationDto.locationCode, error: err.message });
            }
        }

        const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        let totalInserted = 0;
        for (const chunk of chunks) {
            try {
                const result = await this.prisma.clientLocation.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                totalInserted += result.count;
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.locations.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.locations.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
            errors,
        };
    }

    async bulkUpdate(dto: BulkUpdateClientLocationDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.clientLocation.update({
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

    async bulkDelete(dto: BulkDeleteClientLocationDto, userId: string) {
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
            locationNo: ['locationno', 'locationnumber', 'no', 'number'],
            locationName: ['locationname', 'name', 'lname', 'location'],
            locationCode: ['locationcode', 'code', 'lcode'],
            companyName: ['companyname', 'clientcompanyname', 'company', 'clientcompany'],
            address: ['address', 'physicaladdress', 'street', 'locationaddress', 'addr'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['locationName', 'locationCode', 'companyName'];

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        // 1. Resolve all companyNames to companyIds
        const companyNames = Array.from(new Set(data.filter(row => row.companyName).map(row => row.companyName)));
        const companies = await this.prisma.clientCompany.findMany({
            where: { companyName: { in: companyNames } },
            select: { id: true, companyName: true }
        });
        const companyMap = new Map(companies.map(c => [c.companyName.toLowerCase(), c.id]));

        // 2. Build processing data
        const processedData: CreateClientLocationDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = row.status ? this.excelUploadService.validateEnum(row.status as string, LocationStatus, 'Status') : LocationStatus.ACTIVE;

                const companyId = companyMap.get(row.companyName?.toLowerCase());
                if (!companyId) {
                    throw new Error(`Client Company not found: ${row.companyName}`);
                }

                processedData.push({
                    locationNo: row.locationNo,
                    locationName: row.locationName,
                    locationCode: row.locationCode,
                    companyId: companyId,
                    address: row.address,
                    status: status as LocationStatus,
                    remark: row.remark,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ locations: processedData }, userId);

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
                userId,
                action,
                entity: 'ClientLocation',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
