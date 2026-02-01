import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { ExcelUploadService } from '../common/services/excel-upload.service';
import {
    CreateIpAddressDto,
    UpdateIpAddressDto,
    BulkCreateIpAddressDto,
    BulkUpdateIpAddressDto,
    BulkDeleteIpAddressDto,
    ChangeStatusDto,
    FilterIpAddressDto,
} from './dto/ip-address.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { IpAddressStatus, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class IpAddressService {
    private readonly logger = new Logger(IpAddressService.name);
    private readonly CACHE_TTL = 300;
    private readonly CACHE_KEY = 'ip_addresses';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

    async create(dto: CreateIpAddressDto, userId: string) {
        // Validate optional relationships
        if (dto.clientGroupId) {
            const group = await this.prisma.clientGroup.findFirst({
                where: { id: dto.clientGroupId },
            });
            if (!group) throw new NotFoundException('Client group not found');
        }

        if (dto.companyId) {
            const company = await this.prisma.clientCompany.findFirst({
                where: { id: dto.companyId },
            });
            if (!company) throw new NotFoundException('Client company not found');
        }

        if (dto.locationId) {
            const location = await this.prisma.clientLocation.findFirst({
                where: { id: dto.locationId },
            });
            if (!location) throw new NotFoundException('Client location not found');
        }

        if (dto.subLocationId) {
            const subLocation = await this.prisma.subLocation.findFirst({
                where: { id: dto.subLocationId },
            });
            if (!subLocation) throw new NotFoundException('Sub location not found');
        }

        const generatedIpNo = await this.autoNumberService.generateIpNo();

        const ipAddress = await this.prisma.ipAddress.create({
            data: {
                ...dto,
                ipNo: dto.ipNo || generatedIpNo,
                status: dto.status || IpAddressStatus.Active,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', ipAddress.id, null, ipAddress);

        return ipAddress;
    }

    async findAll(pagination: PaginationDto, filter?: FilterIpAddressDto) {
        const {
            page = 1,
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.IpAddressWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.IpAddressWhereInput>;

        // Handle Status Filter
        if (filter?.status) {
            const statusValues = typeof filter.status === 'string'
                ? filter.status.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.status) ? filter.status : [filter.status];
            if (statusValues.length > 0) andArray.push({ status: { in: statusValues as any } });
        }

        if (filter?.clientGroupId) andArray.push({ clientGroupId: filter.clientGroupId });
        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.locationId) andArray.push({ locationId: filter.locationId });
        if (filter?.subLocationId) andArray.push({ subLocationId: filter.subLocationId });
        if (filter?.ipAddressName) andArray.push(buildMultiValueFilter('ipAddressName', filter.ipAddressName));
        if (filter?.ipAddress) andArray.push(buildMultiValueFilter('ipAddress', filter.ipAddress));
        if (filter?.ipNo) andArray.push(buildMultiValueFilter('ipNo', filter.ipNo));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.IpAddressWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const looksLikeIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val);
                const looksLikeCode = /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeIP) {
                    allSearchConditions.push({ ipAddress: { equals: val } });
                    allSearchConditions.push({ ipAddress: { contains: val } }); // Keep contains for partial matches if desired
                } else if (looksLikeCode) {
                    allSearchConditions.push({ ipNo: { equals: val } }); // Exact match for IP No
                    allSearchConditions.push({ ipNo: { contains: val, mode: 'insensitive' } }); // Contains for partial matches
                    allSearchConditions.push({ clientGroup: { groupCode: { equals: val } } });
                    allSearchConditions.push({ clientGroup: { groupCode: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ company: { companyCode: { equals: val } } });
                    allSearchConditions.push({ company: { companyCode: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ location: { locationCode: { equals: val } } });
                    allSearchConditions.push({ location: { locationCode: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ subLocation: { subLocationCode: { equals: val } } });
                    allSearchConditions.push({ subLocation: { subLocationCode: { contains: val, mode: 'insensitive' } } });
                } else {
                    allSearchConditions.push({ ipAddressName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ ipAddress: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ ipNo: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ clientGroup: { groupName: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ company: { companyName: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ location: { locationName: { contains: val, mode: 'insensitive' } } });
                    allSearchConditions.push({ subLocation: { subLocationName: { contains: val, mode: 'insensitive' } } });
                }

                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });

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

        const [data, total] = await Promise.all([
            this.prisma.ipAddress.findMany({
                where,
                skip: Number(skip),
                take: Number(limit),
                orderBy: { [sortBy]: sortOrder },
                include: {
                    clientGroup: {
                        select: { id: true, groupName: true, groupCode: true },
                    },
                    company: {
                        select: { id: true, companyName: true, companyCode: true },
                    },
                    location: {
                        select: { id: true, locationName: true, locationCode: true },
                    },
                    subLocation: {
                        select: { id: true, subLocationName: true, subLocationCode: true },
                    },
                },
            }),
            this.prisma.ipAddress.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientCompany: item.company,
            clientLocation: item.location,
            groupName: item.clientGroup?.groupName,
            companyName: item.company?.companyName,
            locationName: item.location?.locationName,
            subLocationName: item.subLocation?.subLocationName,
        }));

        return new PaginatedResponse(mappedData, total, page, limit);
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterIpAddressDto = { status: IpAddressStatus.Active };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const ipAddress = await this.prisma.ipAddress.findFirst({
            where: { id },
            include: {
                clientGroup: true,
                company: true,
                location: true,
                subLocation: true,
                creator: {
                    select: { id: true, teamName: true, email: true },
                },
                updater: {
                    select: { id: true, teamName: true, email: true },
                },
            },
        });

        if (!ipAddress) {
            throw new NotFoundException('IP address not found');
        }

        return ipAddress;
    }

    async update(id: string, dto: UpdateIpAddressDto, userId: string) {
        const existing = await this.findById(id);

        // Validate optional relationships if being updated
        if (dto.clientGroupId) {
            const group = await this.prisma.clientGroup.findFirst({
                where: { id: dto.clientGroupId },
            });
            if (!group) throw new NotFoundException('Client group not found');
        }

        if (dto.companyId) {
            const company = await this.prisma.clientCompany.findFirst({
                where: { id: dto.companyId },
            });
            if (!company) throw new NotFoundException('Client company not found');
        }

        if (dto.locationId) {
            const location = await this.prisma.clientLocation.findFirst({
                where: { id: dto.locationId },
            });
            if (!location) throw new NotFoundException('Client location not found');
        }

        if (dto.subLocationId) {
            const subLocation = await this.prisma.subLocation.findFirst({
                where: { id: dto.subLocationId },
            });
            if (!subLocation) throw new NotFoundException('Sub location not found');
        }

        const updated = await this.prisma.ipAddress.update({
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

        const updated = await this.prisma.ipAddress.update({
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
        const ipAddress = await this.prisma.ipAddress.findUnique({
            where: { id }
        });

        if (!ipAddress) {
            throw new NotFoundException('IP address not found');
        }

        await this.prisma.ipAddress.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, ipAddress, null);

        return { message: 'IP address permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateIpAddressDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.ipAddresses.length} records`);
        const errors: any[] = [];

        const allExisting = await this.prisma.ipAddress.findMany({
            select: { ipNo: true },
        });
        const existingNos = new Set(allExisting.map((x) => x.ipNo));

        const prefix = 'I-';
        const startNo = await this.autoNumberService.generateIpNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const ipAddressDto of dto.ipAddresses) {
            try {
                const ipAddressName = ipAddressDto.ipAddressName?.trim() || ipAddressDto.ipAddress || 'Unnamed IP';

                // Unique number logic
                let finalIpNo = ipAddressDto.ipNo?.trim();
                if (!finalIpNo || existingNos.has(finalIpNo)) {
                    finalIpNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalIpNo)) {
                        finalIpNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalIpNo);

                dataToInsert.push({
                    ...ipAddressDto,
                    ipAddressName,
                    ipNo: finalIpNo,
                    status: ipAddressDto.status || IpAddressStatus.Active,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ ipAddress: ipAddressDto.ipAddress, error: err.message });
            }
        }

        const chunks: any[][] = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        let totalInserted = 0;
        for (const chunk of chunks) {
            try {
                const result = await this.prisma.ipAddress.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                totalInserted += result.count;
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.ipAddresses.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.ipAddresses.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
            errors,
        };
    }

    async bulkUpdate(dto: BulkUpdateIpAddressDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.ipAddress.update({
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

    async bulkDelete(dto: BulkDeleteIpAddressDto, userId: string) {
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



    async uploadExcel(file: Express.Multer.File, userId: string) {
        this.logger.log(`[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`);

        const columnMapping = {
            ipNo: ['ipno', 'ipnumber'],
            ipAddress: ['ipaddress', 'ip'],
            ipAddressName: ['ipaddressname', 'ipname', 'name'],
            clientGroupName: ['clientgroupname', 'clientgroup', 'groupname'],
            companyName: ['companyname', 'clientcompanyname', 'company', 'clientcompany'],
            locationName: ['locationname', 'clientlocationname', 'location', 'clientlocation'],
            subLocationName: ['sublocationname', 'sublocation', 'clientsublocationname'],
            status: ['status'],
            remark: ['remark', 'remarks', 'notes', 'description'],
        };

        const requiredColumns = ['ipAddress', 'ipAddressName'];

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<CreateIpAddressDto>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        // Resolve relations
        const clientGroupNames = Array.from(new Set(data.filter(r => (r as any).clientGroupName).map(r => (r as any).clientGroupName)));
        const companyNames = Array.from(new Set(data.filter(r => (r as any).companyName).map(r => (r as any).companyName)));
        const locationNames = Array.from(new Set(data.filter(r => (r as any).locationName).map(r => (r as any).locationName)));
        const subLocationNames = Array.from(new Set(data.filter(r => (r as any).subLocationName).map(r => (r as any).subLocationName)));

        const [dbClientGroups, dbCompanies, dbLocations, dbSubLocations] = await Promise.all([
            this.prisma.clientGroup.findMany({ where: { groupName: { in: clientGroupNames } }, select: { id: true, groupName: true } }),
            this.prisma.clientCompany.findMany({ where: { companyName: { in: companyNames } }, select: { id: true, companyName: true } }),
            this.prisma.clientLocation.findMany({ where: { locationName: { in: locationNames } }, select: { id: true, locationName: true } }),
            this.prisma.subLocation.findMany({ where: { subLocationName: { in: subLocationNames } }, select: { id: true, subLocationName: true } }),
        ]);

        const clientGroupMap = new Map(dbClientGroups.map(g => [g.groupName.toLowerCase(), g.id]));
        const companyMap = new Map(dbCompanies.map(c => [c.companyName.toLowerCase(), c.id]));
        const locationMap = new Map(dbLocations.map(l => [l.locationName.toLowerCase(), l.id]));
        const subLocationMap = new Map(dbSubLocations.map(s => [s.subLocationName.toLowerCase(), s.id]));

        const processedData: CreateIpAddressDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = (row as any).status ? this.excelUploadService.validateEnum((row as any).status as string, IpAddressStatus, 'Status') : IpAddressStatus.Active;

                const clientGroupId = clientGroupMap.get((row as any).clientGroupName?.toLowerCase());
                if (!clientGroupId) throw new Error(`Client Group "${(row as any).clientGroupName}" not found or missing`);

                const companyId = companyMap.get((row as any).companyName?.toLowerCase());
                const locationId = locationMap.get((row as any).locationName?.toLowerCase());
                const subLocationId = subLocationMap.get((row as any).subLocationName?.toLowerCase());

                processedData.push({
                    ipNo: (row as any).ipNo,
                    ipAddress: (row as any).ipAddress,
                    ipAddressName: (row as any).ipAddressName,
                    clientGroupId: clientGroupId,
                    companyId: companyId,
                    locationId: locationId,
                    subLocationId: subLocationId,
                    status: status as IpAddressStatus,
                    remark: (row as any).remark,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ ipAddresses: processedData }, userId);

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
                entity: 'IpAddress',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
