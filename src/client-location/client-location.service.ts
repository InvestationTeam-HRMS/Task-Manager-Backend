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

        const location = await this.prisma.clientLocation.create({
            data: {
                ...dto,
                locationNo: dto.locationNo || generatedLocationNo,
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
        if (filter?.locationName) andArray.push(buildMultiValueFilter('locationName', filter.locationName));
        if (filter?.locationNo) andArray.push(buildMultiValueFilter('locationNo', filter.locationNo));
        if (filter?.locationCode) andArray.push(buildMultiValueFilter('locationCode', filter.locationCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const orConditions: Prisma.ClientLocationWhereInput[] = [
                { locationName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { locationCode: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { locationNo: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { address: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { remark: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
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
            this.prisma.clientLocation.findMany({
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
                        },
                    },
                },
            }),
            this.prisma.clientLocation.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientCompany: item.company,
            companyName: item.company?.companyName, // Flattened for table column accessor
        }));

        return new PaginatedResponse(mappedData, total, page, limit);
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
        const existing = await this.findById(id);

        await this.prisma.clientLocation.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Client location and all associated data permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateClientLocationDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.locations.length} records`);
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
                const locationName = locationDto.locationName?.trim() || locationDto.locationCode || 'Unnamed Location';

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
        for (const chunk of chunks) {
            try {
                await this.prisma.clientLocation.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.locations.length} | Inserted Approx: ${dataToInsert.length} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: dataToInsert.length,
            failed: errors.length,
            message: `Successfully processed ${dataToInsert.length} records.`,
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
                const existing = await this.prisma.clientLocation.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.clientLocation.delete({
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

        // 1. Resolve all companyNames to companyIds in one go
        const companyNames = Array.from(new Set(data.filter(row => row.companyName).map(row => row.companyName)));
        const companies = await this.prisma.clientCompany.findMany({
            where: { companyName: { in: companyNames } },
            select: { id: true, companyName: true }
        });
        const companyMap = new Map(companies.map(c => [c.companyName.toLowerCase(), c.id]));

        // 2. Build processing data
        const processedData: CreateClientLocationDto[] = [];
        for (const row of data) {
            try {
                if (row.status) {
                    this.excelUploadService.validateEnum(row.status as string, LocationStatus, 'Status');
                }

                const companyId = companyMap.get(row.companyName?.toLowerCase());
                if (!companyId) {
                    this.logger.warn(`[UPLOAD_WARN] Skipping row: Client Company not found: ${row.companyName}`);
                    continue;
                }

                processedData.push({
                    locationNo: row.locationNo,
                    locationName: row.locationName,
                    locationCode: row.locationCode,
                    companyId: companyId,
                    address: row.address,
                    status: row.status as LocationStatus,
                    remark: row.remark,
                });
            } catch (err) {
                this.logger.error(`[UPLOAD_ROW_ERROR] ${err.message}`);
            }
        }

        const result = await this.bulkCreate({ locations: processedData }, userId);

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
                entity: 'ClientLocation',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
