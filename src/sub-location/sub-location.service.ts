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
    ) { }

    async create(dto: CreateSubLocationDto, userId: string) {
        const existing = await this.prisma.subLocation.findUnique({
            where: { subLocationCode: dto.subLocationCode },
        });

        if (existing) {
            throw new ConflictException('Sub location code already exists');
        }

        const location = await this.prisma.clientLocation.findFirst({
            where: { id: dto.locationId },
        });

        if (!location) {
            throw new NotFoundException('Client location not found');
        }

        const generatedSubLocationNo = await this.autoNumberService.generateSubLocationNo();

        const subLocation = await this.prisma.subLocation.create({
            data: {
                ...dto,
                companyId: dto.companyId || location.companyId, // Ensure companyId is set
                subLocationNo: dto.subLocationNo || generatedSubLocationNo,
                status: dto.status || SubLocationStatus.ACTIVE,
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

        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.locationId) andArray.push({ locationId: filter.locationId });
        if (filter?.subLocationName) andArray.push(buildMultiValueFilter('subLocationName', filter.subLocationName));
        if (filter?.subLocationNo) andArray.push(buildMultiValueFilter('subLocationNo', filter.subLocationNo));
        if (filter?.subLocationCode) andArray.push(buildMultiValueFilter('subLocationCode', filter.subLocationCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const orConditions: Prisma.SubLocationWhereInput[] = [
                { subLocationName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { subLocationCode: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { subLocationNo: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { address: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { remark: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { location: { locationName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
                { company: { companyName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
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
            this.prisma.subLocation.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                include: {
                    company: {
                        select: {
                            id: true,
                            companyName: true,
                            companyCode: true,
                        }
                    },
                    location: {
                        select: {
                            id: true,
                            locationName: true,
                            locationCode: true,
                        },
                    },
                },
            }),
            this.prisma.subLocation.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientLocation: item.location,
            clientCompany: item.company,
            locationName: item.location?.locationName,
            companyName: item.company?.companyName,
        }));

        return new PaginatedResponse(mappedData, total, page, limit);
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterSubLocationDto = { status: SubLocationStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const subLocation = await this.prisma.subLocation.findFirst({
            where: { id },
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
                creator: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                updater: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
        });

        if (!subLocation) {
            throw new NotFoundException('Sub location not found');
        }

        return subLocation;
    }

    async update(id: string, dto: UpdateSubLocationDto, userId: string) {
        const existing = await this.findById(id);

        if (dto.subLocationCode && dto.subLocationCode !== existing.subLocationCode) {
            const duplicate = await this.prisma.subLocation.findUnique({
                where: { subLocationCode: dto.subLocationCode },
            });

            if (duplicate) {
                throw new ConflictException('Sub location code already exists');
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
        const existing = await this.findById(id);

        await this.prisma.subLocation.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Sub location and all associated data permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateSubLocationDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.subLocations.length} records`);
        const errors: any[] = [];

        const allExisting = await this.prisma.subLocation.findMany({
            select: { subLocationCode: true, subLocationNo: true },
        });
        const existingCodes = new Set(allExisting.map((x) => x.subLocationCode));
        const existingNos = new Set(allExisting.map((x) => x.subLocationNo));

        const prefix = 'CS-';
        const startNo = await this.autoNumberService.generateSubLocationNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const subLocationDto of dto.subLocations) {
            try {
                const subLocationName = subLocationDto.subLocationName?.trim() || subLocationDto.subLocationCode || 'Unnamed Sub Location';

                // Unique code logic
                let finalSubLocationCode = subLocationDto.subLocationCode?.trim() || `SUBLOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
                    subLocationCode: finalSubLocationCode,
                    subLocationNo: finalSubLocationNo,
                    status: subLocationDto.status || SubLocationStatus.ACTIVE,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ subLocationCode: subLocationDto.subLocationCode, error: err.message });
            }
        }

        const chunks = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        for (const chunk of chunks) {
            try {
                await this.prisma.subLocation.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.subLocations.length} | Inserted Approx: ${dataToInsert.length} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: dataToInsert.length,
            failed: errors.length,
            message: `Successfully processed ${dataToInsert.length} records.`,
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
                const existing = await this.prisma.subLocation.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.subLocation.delete({
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
            results,
            errors,
        };
    }



    async uploadExcel(file: Express.Multer.File, userId: string) {
        const columnMapping = {
            subLocationNo: ['sublocationno', 'sublocationnumber', 'no', 'number'],
            subLocationName: ['sublocationname', 'name', 'sname', 'sublocation'],
            subLocationCode: ['sublocationcode', 'code', 'scode'],
            locationName: ['locationname', 'clientlocationname', 'location', 'clientlocation'],
            companyName: ['companyname', 'clientcompanyname', 'company', 'clientcompany'],
            address: ['address', 'physicaladdress', 'street', 'sublocationaddress', 'addr'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['subLocationName', 'subLocationCode', 'locationName', 'companyName'];

        const { data, errors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException(
                'No valid data found to import. Please check file format and column names.',
            );
        }

        // 1. Resolve all companyNames to companyIds
        const companyNames = Array.from(new Set(data.filter(row => row.companyName).map(row => row.companyName)));
        const companies = await this.prisma.clientCompany.findMany({
            where: { companyName: { in: companyNames } },
            select: { id: true, companyName: true }
        });
        const companyMap = new Map(companies.map(c => [c.companyName.toLowerCase(), c.id]));

        // 2. Resolve all locationNames to locationIds (grouped by company)
        const locationNames = Array.from(new Set(data.filter(row => row.locationName).map(row => row.locationName)));
        const locations = await this.prisma.clientLocation.findMany({
            where: { locationName: { in: locationNames } },
            select: { id: true, locationName: true, companyId: true }
        });
        const locationMap = new Map(locations.map(l => [`${l.companyId}_${l.locationName.toLowerCase()}`, l.id]));

        // 3. Build processing data
        const processedData: CreateSubLocationDto[] = [];
        for (const row of data) {
            try {
                if (row.status) {
                    this.excelUploadService.validateEnum(row.status as string, SubLocationStatus, 'Status');
                }

                const companyId = companyMap.get(row.companyName?.toLowerCase());
                if (!companyId) continue;

                const locationId = locationMap.get(`${companyId}_${row.locationName?.toLowerCase()}`);
                if (!locationId) continue;

                processedData.push({
                    subLocationNo: row.subLocationNo,
                    subLocationName: row.subLocationName,
                    subLocationCode: row.subLocationCode,
                    companyId: companyId,
                    locationId: locationId,
                    address: row.address,
                    status: row.status as SubLocationStatus,
                    remark: row.remark,
                });
            } catch (err) {
                this.logger.error(`[UPLOAD_ROW_ERROR] ${err.message}`);
            }
        }

        const result = await this.bulkCreate({ subLocations: processedData }, userId);

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
                entity: 'SubLocation',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
