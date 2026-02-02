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
    CreateSubLocationDto,
    UpdateSubLocationDto,
    BulkCreateSubLocationDto,
    BulkUpdateSubLocationDto,
    BulkDeleteSubLocationDto,
    ChangeStatusDto,
    FilterSubLocationDto,
} from './dto/sub-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { SubLocationStatus, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class SubLocationService {
    private readonly logger = new Logger(SubLocationService.name);
    private readonly CACHE_TTL = 300;
    private readonly CACHE_KEY = 'sub_locations';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
        private excelDownloadService: ExcelDownloadService,
    ) { }

    async create(dto: CreateSubLocationDto, userId: string) {
        // Transform subLocationCode to uppercase
        const subLocationCodeUpper = dto.subLocationCode.toUpperCase();

        const existing = await this.prisma.subLocation.findUnique({
            where: { subLocationCode: subLocationCodeUpper },
        });

        if (existing) {
            throw new ConflictException('Sub-location code already exists');
        }

        // Validate Location Existence if locationId is provided
        if (dto.locationId) {
            const location = await this.prisma.clientLocation.findUnique({
                where: { id: dto.locationId },
            });
            if (!location) {
                throw new NotFoundException('Client Location not found');
            }
        }

        const generatedSubLocationNo = await this.autoNumberService.generateSubLocationNo();
        const { toTitleCase } = await import('../common/utils/string-helper');

        const subLocation = await this.prisma.subLocation.create({
            data: {
                ...dto,
                subLocationCode: subLocationCodeUpper,
                subLocationName: toTitleCase(dto.subLocationName),
                address: dto.address ? toTitleCase(dto.address) : undefined,
                subLocationNo: dto.subLocationNo || generatedSubLocationNo,
                remark: dto.remark ? toTitleCase(dto.remark) : undefined,
                status: dto.status || SubLocationStatus.Active,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', subLocation.id, null, subLocation);

        return subLocation;
    }

    async findAll(pagination: PaginationDto, filter?: FilterSubLocationDto) {
        const {
            page = 1,
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.SubLocationWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.SubLocationWhereInput>;
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

        if (filter?.clientGroupId) andArray.push({ clientGroupId: filter.clientGroupId });
        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.locationId) andArray.push({ locationId: filter.locationId });

        if (filter?.subLocationName) andArray.push(buildMultiValueFilter('subLocationName', toTitleCase(filter.subLocationName)));
        if (filter?.subLocationNo) andArray.push(buildMultiValueFilter('subLocationNo', filter.subLocationNo));
        if (filter?.subLocationCode) andArray.push(buildMultiValueFilter('subLocationCode', filter.subLocationCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));
        if (filter?.address) andArray.push(buildMultiValueFilter('address', toTitleCase(filter.address)));

        if (filter?.groupName) {
            const multiFilter = buildMultiValueFilter('groupName', filter.groupName);
            if (multiFilter) andArray.push({ clientGroup: multiFilter });
        }

        if (filter?.companyName) {
            const multiFilter = buildMultiValueFilter('companyName', filter.companyName);
            if (multiFilter) andArray.push({ company: multiFilter });
        }

        if (filter?.locationName) {
            const multiFilter = buildMultiValueFilter('locationName', toTitleCase(filter.locationName));
            if (multiFilter) andArray.push({ location: multiFilter });
        }

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.SubLocationWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);

                const looksLikeCode = /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeCode) {
                    allSearchConditions.push({ subLocationCode: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationNo: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationNo: { contains: val, mode: 'insensitive' } });
                } else {
                    allSearchConditions.push({ subLocationName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationName: { contains: searchTitle, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationCode: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ subLocationNo: { contains: val, mode: 'insensitive' } });
                }

                allSearchConditions.push({ address: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ address: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ location: { locationName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ location: { locationName: { contains: searchTitle, mode: 'insensitive' } } });

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
                this.logger.log(`[CACHE_HIT] SubLocation List - ${cacheKey}`);
                return cached;
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.subLocation.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                select: {
                    id: true,
                    subLocationNo: true,
                    subLocationName: true,
                    subLocationCode: true,
                    address: true,
                    status: true,
                    remark: true,
                    createdAt: true,
                    locationId: true,
                    clientGroupId: true,
                    companyId: true,
                    location: {
                        select: {
                            id: true,
                            locationName: true,
                            locationCode: true,
                        },
                    },
                    clientGroup: {
                        select: {
                            id: true,
                            groupName: true,
                        },
                    },
                    company: {
                        select: {
                            id: true,
                            companyName: true,
                        },
                    },
                    _count: {
                        select: { projects: true, teams: true }
                    }
                },
            }),
            this.prisma.subLocation.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientLocation: item.location,
            locationName: item.location?.locationName, // Flattened for table column accessor
            groupName: item.clientGroup?.groupName, // Flattened for table column accessor
            companyName: item.company?.companyName, // Flattened for table column accessor
        }));

        const response = new PaginatedResponse(mappedData, total, page, limit);

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
            this.logger.log(`[CACHE_MISS] SubLocation List - Cached result: ${cacheKey}`);
        }

        return response;
    }

    async downloadExcel(query: any, userId: string, res: any) {
        const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

        const mappedData = data.map((item, index) => ({
            srNo: index + 1,
            subLocationNo: item.subLocationNo,
            subLocationName: item.subLocationName,
            subLocationCode: item.subLocationCode,
            location: item.location?.locationName || '',
            address: item.address || '',
            status: item.status,
            remark: item.remark || '',
        }));

        const columns = [
            { header: '#', key: 'srNo', width: 10 },
            { header: 'Sub-Location No', key: 'subLocationNo', width: 15 },
            { header: 'Sub-Location Name', key: 'subLocationName', width: 30 },
            { header: 'Sub-Location Code', key: 'subLocationCode', width: 15 },
            { header: 'Location', key: 'location', width: 25 },
            { header: 'Address', key: 'address', width: 35 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Remark', key: 'remark', width: 30 },
        ];

        await this.excelDownloadService.downloadExcel(res, mappedData, columns, 'sub_locations.xlsx', 'Sub-Locations');
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterSubLocationDto = { status: SubLocationStatus.Active };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const subLocation = await this.prisma.subLocation.findFirst({
            where: { id },
            include: {
                location: {
                    include: {
                        company: true,
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

        if (!subLocation) {
            throw new NotFoundException('Sub-location not found');
        }

        return subLocation;
    }

    async update(id: string, dto: UpdateSubLocationDto, userId: string) {
        const existing = await this.findById(id);
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Transform subLocationCode to uppercase if provided
        const subLocationCodeUpper = dto.subLocationCode ? dto.subLocationCode.toUpperCase() : undefined;

        if (subLocationCodeUpper && subLocationCodeUpper !== existing.subLocationCode) {
            const duplicate = await this.prisma.subLocation.findUnique({
                where: { subLocationCode: subLocationCodeUpper },
            });

            if (duplicate) {
                throw new ConflictException('Sub-location code already exists');
            }
        }

        if (dto.locationId) {
            const location = await this.prisma.clientLocation.findFirst({
                where: { id: dto.locationId },
            });

            if (!location) {
                throw new NotFoundException('Client location not found');
            }
        }

        const updated = await this.prisma.subLocation.update({
            where: { id },
            data: {
                ...dto,
                subLocationCode: subLocationCodeUpper,
                subLocationName: dto.subLocationName ? toTitleCase(dto.subLocationName) : undefined,
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

        const updated = await this.prisma.subLocation.update({
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
        const subLocation = await this.prisma.subLocation.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        projects: true,
                        teams: true,
                        ipAddresses: true,
                    }
                }
            }
        });

        if (!subLocation) {
            throw new NotFoundException('Sub-location not found');
        }

        const { _count } = subLocation;
        const childCounts = [
            _count.projects > 0 && `${_count.projects} projects`,
            _count.teams > 0 && `${_count.teams} teams`,
            _count.ipAddresses > 0 && `${_count.ipAddresses} IP addresses`,
        ].filter(Boolean);

        if (childCounts.length > 0) {
            throw new BadRequestException(
                `Cannot delete Sub-Location because it contains: ${childCounts.join(', ')}. Please delete or reassign them first.`
            );
        }

        await this.prisma.subLocation.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, subLocation, null);

        return { message: 'Sub-location deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateSubLocationDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.subLocations.length} records`);
        const { toTitleCase } = await import('../common/utils/string-helper');

        const errors: any[] = [];

        const allExisting = await this.prisma.subLocation.findMany({
            select: { subLocationCode: true, subLocationNo: true },
        });
        const existingCodes = new Set(allExisting.map((x) => x.subLocationCode));
        const existingNos = new Set(allExisting.map((x) => x.subLocationNo));

        const prefix = 'SL-';
        const startNo = await this.autoNumberService.generateSubLocationNo();
        let currentNum = parseInt(startNo.replace('CSL-', '').replace(prefix, '')) || 1000;

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const subLocationDto of dto.subLocations) {
            try {
                const subLocationName = toTitleCase(subLocationDto.subLocationName?.trim() || subLocationDto.subLocationCode || 'Unnamed Sub-Location');
                const address = subLocationDto.address ? toTitleCase(subLocationDto.address) : undefined;
                const remark = subLocationDto.remark ? toTitleCase(subLocationDto.remark) : undefined;

                // Unique code logic
                let finalSubLocationCode = subLocationDto.subLocationCode?.trim() || `SLOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                if (existingCodes.has(finalSubLocationCode)) {
                    let suffix = 1;
                    const originalCode = finalSubLocationCode;
                    while (existingCodes.has(`${originalCode}-${suffix}`)) {
                        suffix++;
                    }
                    finalSubLocationCode = `${originalCode}-${suffix}`;
                }
                existingCodes.add(finalSubLocationCode);

                // Unique number logic
                let finalSubLocationNo = subLocationDto.subLocationNo?.trim();
                if (!finalSubLocationNo || existingNos.has(finalSubLocationNo)) {
                    finalSubLocationNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalSubLocationNo)) {
                        finalSubLocationNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalSubLocationNo);

                dataToInsert.push({
                    ...subLocationDto,
                    subLocationName,
                    address,
                    remark,
                    subLocationCode: finalSubLocationCode,
                    subLocationNo: finalSubLocationNo,
                    status: subLocationDto.status || SubLocationStatus.Active,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ subLocationCode: subLocationDto.subLocationCode, error: err.message });
            }
        }

        const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        let totalInserted = 0;
        for (const chunk of chunks) {
            try {
                const result = await this.prisma.subLocation.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                totalInserted += result.count;
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.subLocations.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.subLocations.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
            errors,
        };
    }

    async bulkUpdate(dto: BulkUpdateSubLocationDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.subLocation.update({
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

    async bulkDelete(dto: BulkDeleteSubLocationDto, userId: string) {
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
            subLocationNo: ['sublocationno', 'sublocationnumber', 'no', 'number'],
            subLocationName: ['sublocationname', 'name', 'slname', 'sublocation'],
            subLocationCode: ['sublocationcode', 'code', 'slcode'],
            locationName: ['locationname', 'clientlocationname', 'location'],
            address: ['address', 'physicaladdress', 'street', 'sublocationaddress', 'addr'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['subLocationName', 'subLocationCode', 'locationName'];

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        // Resolve all locationNames
        const locationNames = Array.from(new Set(data.filter(row => row.locationName).map(row => row.locationName)));
        const locations = await this.prisma.clientLocation.findMany({
            where: { locationName: { in: locationNames } },
            select: { id: true, locationName: true, clientGroupId: true, companyId: true }
        });
        const locationMap = new Map(locations.map(l => [l.locationName.toLowerCase(), l]));

        // Build processing data
        const processedData: CreateSubLocationDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = row.status ? this.excelUploadService.validateEnum(row.status as string, SubLocationStatus, 'Status') : SubLocationStatus.Active;

                const location = locationMap.get(row.locationName?.toLowerCase());
                if (!location) throw new Error(`Client Location not found: ${row.locationName}`);

                processedData.push({
                    subLocationNo: row.subLocationNo,
                    subLocationName: row.subLocationName,
                    subLocationCode: row.subLocationCode,
                    locationId: location.id,
                    clientGroupId: location.clientGroupId,
                    companyId: location.companyId || undefined,
                    address: row.address,
                    status: status as SubLocationStatus,
                    remark: row.remark,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ subLocations: processedData }, userId);

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
                entity: 'SubLocation',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
