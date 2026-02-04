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
import { ExcelDownloadService } from '../common/services/excel-download.service';
import { UploadJobService } from '../common/services/upload-job.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';
import * as fs from 'fs';
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
    private readonly BACKGROUND_UPLOAD_BYTES =
        Number(process.env.EXCEL_BACKGROUND_THRESHOLD_BYTES) || 1 * 1024 * 1024;

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
        private excelDownloadService: ExcelDownloadService,
        private uploadJobService: UploadJobService,
        private eventEmitter: EventEmitter2,
        private notificationService: NotificationService,
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
            AND: [],
        };

        const andArray = where.AND as Array<Prisma.IpAddressWhereInput>;

        // Handle Status Filter
        if (filter?.status) {
            const statusValues =
                typeof filter.status === 'string'
                    ? filter.status
                        .split(/[,\:;|]/)
                        .map((v) => v.trim())
                        .filter(Boolean)
                    : Array.isArray(filter.status)
                        ? filter.status
                        : [filter.status];
            if (statusValues.length > 0)
                andArray.push({ status: { in: statusValues as any } });
        }

        if (filter?.clientGroupId)
            andArray.push({ clientGroupId: filter.clientGroupId });
        if (filter?.groupName)
            andArray.push({
                clientGroup: {
                    groupName: { contains: filter.groupName, mode: 'insensitive' },
                },
            });

        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.companyName)
            andArray.push({
                company: {
                    companyName: { contains: filter.companyName, mode: 'insensitive' },
                },
            });

        if (filter?.locationId) andArray.push({ locationId: filter.locationId });
        if (filter?.locationName)
            andArray.push({
                location: {
                    locationName: { contains: filter.locationName, mode: 'insensitive' },
                },
            });

        if (filter?.subLocationId)
            andArray.push({ subLocationId: filter.subLocationId });
        if (filter?.subLocationName)
            andArray.push({
                subLocation: {
                    subLocationName: {
                        contains: filter.subLocationName,
                        mode: 'insensitive',
                    },
                },
            });

        if (filter?.ipAddressName)
            andArray.push(
                buildMultiValueFilter('ipAddressName', filter.ipAddressName),
            );
        if (filter?.ipAddress)
            andArray.push(buildMultiValueFilter('ipAddress', filter.ipAddress));
        if (filter?.ipNo) andArray.push(buildMultiValueFilter('ipNo', filter.ipNo));
        if (filter?.remark)
            andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const searchValues = cleanedSearch
                .split(/[,\:;|]/)
                .map((v) => v.trim())
                .filter(Boolean);
            const allSearchConditions: Prisma.IpAddressWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const looksLikeIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val);
                const looksLikeCode =
                    /^[A-Z]{2,}-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeIP) {
                    allSearchConditions.push({ ipAddress: { equals: val } });
                    allSearchConditions.push({ ipAddress: { contains: val } }); // Keep contains for partial matches if desired
                } else if (looksLikeCode) {
                    allSearchConditions.push({ ipNo: { equals: val } }); // Exact match for IP No
                    allSearchConditions.push({
                        ipNo: { contains: val, mode: 'insensitive' },
                    }); // Contains for partial matches
                    allSearchConditions.push({
                        clientGroup: { groupCode: { equals: val } },
                    });
                    allSearchConditions.push({
                        clientGroup: { groupCode: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        company: { companyCode: { equals: val } },
                    });
                    allSearchConditions.push({
                        company: { companyCode: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        location: { locationCode: { equals: val } },
                    });
                    allSearchConditions.push({
                        location: { locationCode: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        subLocation: { subLocationCode: { equals: val } },
                    });
                    allSearchConditions.push({
                        subLocation: {
                            subLocationCode: { contains: val, mode: 'insensitive' },
                        },
                    });
                } else {
                    allSearchConditions.push({
                        ipAddressName: { contains: val, mode: 'insensitive' },
                    });
                    allSearchConditions.push({
                        ipAddress: { contains: val, mode: 'insensitive' },
                    });
                    allSearchConditions.push({
                        ipNo: { contains: val, mode: 'insensitive' },
                    });
                    allSearchConditions.push({
                        clientGroup: { groupName: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        company: { companyName: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        location: { locationName: { contains: val, mode: 'insensitive' } },
                    });
                    allSearchConditions.push({
                        subLocation: {
                            subLocationName: { contains: val, mode: 'insensitive' },
                        },
                    });
                }

                allSearchConditions.push({
                    remark: { contains: val, mode: 'insensitive' },
                });

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
            where: { id },
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

    async downloadExcel(query: any, userId: string, res: any) {
        const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

        const mappedData = data.map((item, index) => ({
            srNo: index + 1,
            ipNo: item.ipNo,
            ipAddress: item.ipAddress,
            ipAddressName: item.ipAddressName,
            clientGroupName: item.clientGroup?.groupName || '',
            companyName: item.company?.companyName || '',
            locationName: item.location?.locationName || '',
            subLocationName: item.subLocation?.subLocationName || '',
            status: item.status,
            remark: item.remark || '',
        }));

        const columns = [
            { header: '#', key: 'srNo', width: 10 },
            { header: 'IP No', key: 'ipNo', width: 15 },
            { header: 'IP Address', key: 'ipAddress', width: 20 },
            { header: 'IP Name', key: 'ipAddressName', width: 25 },
            { header: 'Client Group', key: 'clientGroupName', width: 20 },
            { header: 'Company', key: 'companyName', width: 20 },
            { header: 'Location', key: 'locationName', width: 20 },
            { header: 'Sublocation', key: 'subLocationName', width: 20 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Remark', key: 'remark', width: 30 },
        ];

        await this.excelDownloadService.downloadExcel(
            res,
            mappedData,
            columns,
            'ip_addresses.xlsx',
            'IP Addresses',
        );
    }

    async bulkCreate(dto: BulkCreateIpAddressDto, userId: string) {
        this.logger.log(
            `[BULK_CREATE_FAST] Starting for ${dto.ipAddresses.length} records`,
        );
        const errors: any[] = [];

        const prefix = 'I-';
        const startNo = await this.autoNumberService.generateIpNo();
        let currentNum = parseInt(
            startNo.replace(new RegExp(`^${prefix}`, 'i'), ''),
        );
        if (isNaN(currentNum)) currentNum = 11001;

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        // For large datasets, we don't fetch all ipNo.
        // We only check for the ones provided in the DTO if they exist.
        const providedIpNos = dto.ipAddresses.map((x) => x.ipNo).filter(Boolean);
        const existingProvided = new Set<string>();
        if (providedIpNos.length > 0) {
            const chunks = this.excelUploadService.chunk(providedIpNos, 5000);
            for (const chunk of chunks) {
                const results = await this.prisma.ipAddress.findMany({
                    where: { ipNo: { in: chunk as string[] } },
                    select: { ipNo: true },
                });
                results.forEach((r) => existingProvided.add(r.ipNo));
            }
        }

        for (const ipAddressDto of dto.ipAddresses) {
            try {
                const ipAddressName =
                    ipAddressDto.ipAddressName?.trim() ||
                    ipAddressDto.ipAddress ||
                    'Unnamed IP';

                // Unique number logic
                let finalIpNo = ipAddressDto.ipNo?.trim();
                if (!finalIpNo || existingProvided.has(finalIpNo)) {
                    finalIpNo = `${prefix}${currentNum}`;
                    currentNum++;
                }

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

        const chunks: any[][] = this.excelUploadService.chunk(
            dataToInsert,
            BATCH_SIZE,
        );
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

        this.logger.log(
            `[BULK_CREATE_COMPLETED] Processed: ${dto.ipAddresses.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`,
        );
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

    private shouldProcessInBackground(file?: Express.Multer.File) {
        return !!file?.size && file.size >= this.BACKGROUND_UPLOAD_BYTES;
    }

    private getUploadConfig() {
        return {
            columnMapping: {
                ipNo: ['ipno', 'ipnumber'],
                ipAddress: ['ipaddress', 'ip'],
                ipAddressName: ['ipaddressname', 'ipname', 'name'],
                clientGroupName: ['clientgroupname', 'clientgroup', 'groupname'],
                companyName: [
                    'companyname',
                    'clientcompanyname',
                    'company',
                    'clientcompany',
                ],
                locationName: [
                    'locationname',
                    'clientlocationname',
                    'location',
                    'clientlocation',
                ],
                subLocationName: [
                    'sublocationname',
                    'sublocation',
                    'clientsublocationname',
                ],
                status: ['status'],
                remark: ['remark', 'remarks', 'notes', 'description'],
            },
            requiredColumns: ['ipAddress', 'ipAddressName'],
        };
    }

    private async parseAndProcessUpload(file: Express.Multer.File) {
        const { columnMapping, requiredColumns } = this.getUploadConfig();

        const { data, errors: parseErrors } =
            await this.excelUploadService.parseFile<CreateIpAddressDto>(
                file,
                columnMapping,
                requiredColumns,
            );

        if (data.length === 0) {
            throw new BadRequestException(
                'No valid data found to import. Please check file format and column names.',
            );
        }

        // Resolve relations
        const clientGroupNames = Array.from(
            new Set(
                data
                    .filter((r) => (r as any).clientGroupName)
                    .map((r) => (r as any).clientGroupName),
            ),
        );
        const companyNames = Array.from(
            new Set(
                data
                    .filter((r) => (r as any).companyName)
                    .map((r) => (r as any).companyName),
            ),
        );
        const locationNames = Array.from(
            new Set(
                data
                    .filter((r) => (r as any).locationName)
                    .map((r) => (r as any).locationName),
            ),
        );
        const subLocationNames = Array.from(
            new Set(
                data
                    .filter((r) => (r as any).subLocationName)
                    .map((r) => (r as any).subLocationName),
            ),
        );

        const [dbClientGroups, dbCompanies, dbLocations, dbSubLocations] =
            await Promise.all([
                this.prisma.clientGroup.findMany({
                    where: { groupName: { in: clientGroupNames } },
                    select: { id: true, groupName: true },
                }),
                this.prisma.clientCompany.findMany({
                    where: { companyName: { in: companyNames } },
                    select: { id: true, companyName: true },
                }),
                this.prisma.clientLocation.findMany({
                    where: { locationName: { in: locationNames } },
                    select: { id: true, locationName: true },
                }),
                this.prisma.subLocation.findMany({
                    where: { subLocationName: { in: subLocationNames } },
                    select: { id: true, subLocationName: true },
                }),
            ]);

        const clientGroupMap = new Map(
            dbClientGroups.map((g) => [g.groupName.toLowerCase(), g.id]),
        );
        const companyMap = new Map(
            dbCompanies.map((c) => [c.companyName.toLowerCase(), c.id]),
        );
        const locationMap = new Map(
            dbLocations.map((l) => [l.locationName.toLowerCase(), l.id]),
        );
        const subLocationMap = new Map(
            dbSubLocations.map((s) => [s.subLocationName.toLowerCase(), s.id]),
        );

        const processedData: CreateIpAddressDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = (row as any).status
                    ? this.excelUploadService.validateEnum(
                        (row as any).status as string,
                        IpAddressStatus,
                        'Status',
                    )
                    : IpAddressStatus.Active;

                const clientGroupId = clientGroupMap.get(
                    (row as any).clientGroupName?.toLowerCase(),
                );
                if (!clientGroupId)
                    throw new Error(
                        `Client Group "${(row as any).clientGroupName}" not found or missing`,
                    );

                const companyId = companyMap.get(
                    (row as any).companyName?.toLowerCase(),
                );
                const locationId = locationMap.get(
                    (row as any).locationName?.toLowerCase(),
                );
                const subLocationId = subLocationMap.get(
                    (row as any).subLocationName?.toLowerCase(),
                );

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
            throw new BadRequestException(
                `Validation Failed: ${processingErrors[0].error}`,
            );
        }

        return { processedData, parseErrors, processingErrors };
    }

    private async processUploadStreaming(
        file: Express.Multer.File,
        userId: string,
    ) {
        const { columnMapping, requiredColumns } = this.getUploadConfig();

        const clientGroupNames = new Set<string>();
        const companyNames = new Set<string>();
        const locationNames = new Set<string>();
        const subLocationNames = new Set<string>();

        try {
            await this.excelUploadService.streamFileInBatches<any>(
                file,
                columnMapping,
                requiredColumns,
                2000,
                async (batch) => {
                    for (const item of batch) {
                        const row = item.data as any;
                        if (row.clientGroupName) {
                            clientGroupNames.add(String(row.clientGroupName).trim());
                        }
                        if (row.companyName) {
                            companyNames.add(String(row.companyName).trim());
                        }
                        if (row.locationName) {
                            locationNames.add(String(row.locationName).trim());
                        }
                        if (row.subLocationName) {
                            subLocationNames.add(String(row.subLocationName).trim());
                        }
                    }
                },
                { cleanup: false },
            );
        } catch (error) {
            if (file?.path) {
                await fs.promises.unlink(file.path).catch(() => undefined);
            }
            throw error;
        }

        const [dbClientGroups, dbCompanies, dbLocations, dbSubLocations] =
            await Promise.all([
                clientGroupNames.size > 0
                    ? this.prisma.clientGroup.findMany({
                        where: { groupName: { in: Array.from(clientGroupNames) } },
                        select: { id: true, groupName: true },
                    })
                    : [],
                companyNames.size > 0
                    ? this.prisma.clientCompany.findMany({
                        where: { companyName: { in: Array.from(companyNames) } },
                        select: { id: true, companyName: true },
                    })
                    : [],
                locationNames.size > 0
                    ? this.prisma.clientLocation.findMany({
                        where: { locationName: { in: Array.from(locationNames) } },
                        select: { id: true, locationName: true },
                    })
                    : [],
                subLocationNames.size > 0
                    ? this.prisma.subLocation.findMany({
                        where: { subLocationName: { in: Array.from(subLocationNames) } },
                        select: { id: true, subLocationName: true },
                    })
                    : [],
            ]);

        const clientGroupMap = new Map(
            dbClientGroups.map((g) => [g.groupName.toLowerCase(), g.id]),
        );
        const companyMap = new Map(
            dbCompanies.map((c) => [c.companyName.toLowerCase(), c.id]),
        );
        const locationMap = new Map(
            dbLocations.map((l) => [l.locationName.toLowerCase(), l.id]),
        );
        const subLocationMap = new Map(
            dbSubLocations.map((s) => [s.subLocationName.toLowerCase(), s.id]),
        );

        let totalInserted = 0;
        let totalFailed = 0;
        const errors: any[] = [];

        const { errors: parseErrors, processed } =
            await this.excelUploadService.streamFileInBatches<any>(
                file,
                columnMapping,
                requiredColumns,
                1000,
                async (batch) => {
                    const toInsert: CreateIpAddressDto[] = [];

                    for (const item of batch) {
                        const row = item.data as any;
                        try {
                            const status = row.status
                                ? this.excelUploadService.validateEnum(
                                    String(row.status),
                                    IpAddressStatus,
                                    'Status',
                                )
                                : IpAddressStatus.Active;

                            const clientGroupId = clientGroupMap.get(
                                String(row.clientGroupName).toLowerCase(),
                            );
                            if (!clientGroupId) {
                                throw new Error(
                                    `Client Group "${row.clientGroupName}" not found or missing`,
                                );
                            }

                            const companyId = row.companyName
                                ? companyMap.get(String(row.companyName).toLowerCase())
                                : undefined;
                            const locationId = row.locationName
                                ? locationMap.get(String(row.locationName).toLowerCase())
                                : undefined;
                            const subLocationId = row.subLocationName
                                ? subLocationMap.get(
                                    String(row.subLocationName).toLowerCase(),
                                )
                                : undefined;

                            toInsert.push({
                                ipNo: row.ipNo,
                                ipAddress: row.ipAddress,
                                ipAddressName: row.ipAddressName,
                                clientGroupId: clientGroupId,
                                companyId: companyId,
                                locationId: locationId,
                                subLocationId: subLocationId,
                                status: status as IpAddressStatus,
                                remark: row.remark,
                            });
                        } catch (err) {
                            totalFailed += 1;
                            errors.push({ row: item.rowNumber, error: err.message });
                        }
                    }

                    if (toInsert.length > 0) {
                        const result = await this.bulkCreate(
                            { ipAddresses: toInsert },
                            userId,
                        );
                        totalInserted += result.success || 0;
                        totalFailed += result.failed || 0;
                        if (result.errors?.length) {
                            errors.push(...result.errors);
                        }
                    }
                },
            );

        totalFailed += parseErrors.length;
        if (parseErrors.length > 0) {
            errors.push(...parseErrors);
        }

        return {
            success: totalInserted,
            failed: totalFailed || Math.max(0, processed - totalInserted),
            errors,
        };
    }

    async uploadExcel(file: Express.Multer.File, userId: string) {
        this.logger.log(
            `[UPLOAD] File: ${file?.originalname} | Size: ${file?.size}`,
        );
        if (this.shouldProcessInBackground(file)) {
            const fileName = file?.originalname || 'upload.xlsx';
            const job = await this.uploadJobService.createJob({
                module: 'ip-address',
                fileName,
                userId,
            });
            this.eventEmitter.emit('ip-address.bulk-upload', {
                file,
                userId,
                fileName,
                jobId: job.jobId,
            });

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            return {
                message: `Large file (${sizeMb} MB) is being processed in the background. You will be notified once completed.`,
                isBackground: true,
                totalRecords: null,
                jobId: job.jobId,
            };
        }

        const { processedData, parseErrors, processingErrors } =
            await this.parseAndProcessUpload(file);

        // --- BACKGROUND PROCESSING TRIGGER ---
        // If the dataset is large (> 500), we process it in the background
        if (processedData.length > 500) {
            const job = await this.uploadJobService.createJob({
                module: 'ip-address',
                fileName: file.originalname,
                userId,
            });
            this.eventEmitter.emit('ip-address.bulk-upload', {
                data: processedData,
                userId,
                fileName: file.originalname,
                jobId: job.jobId,
            });

            return {
                message: `Large file (${processedData.length} records) is being processed in the background. You will be notified once completed.`,
                isBackground: true,
                totalRecords: processedData.length,
                jobId: job.jobId,
            };
        }

        const result = await this.bulkCreate(
            { ipAddresses: processedData },
            userId,
        );

        result.errors = [
            ...(result.errors || []),
            ...parseErrors,
            ...processingErrors,
        ];
        result.failed += parseErrors.length + processingErrors.length;

        return result;
    }

    @OnEvent('ip-address.bulk-upload')
    async handleBackgroundUpload(payload: {
        data?: CreateIpAddressDto[];
        file?: Express.Multer.File;
        userId: string;
        fileName: string;
        jobId?: string;
    }) {
        const { data: providedData, file, userId, fileName, jobId } = payload;
        this.logger.log(
            `[BACKGROUND_UPLOAD] Starting background upload for ${providedData?.length || 'file'} from ${fileName}`,
        );

        try {
            if (jobId) {
                await this.uploadJobService.markProcessing(jobId);
            }

            let totalSuccess = 0;
            let totalFailed = 0;

            if (file) {
                const result = await this.processUploadStreaming(file, userId);
                totalSuccess = result.success;
                totalFailed = result.failed;
            } else if (providedData && providedData.length > 0) {
                const result = await this.bulkCreate(
                    { ipAddresses: providedData },
                    userId,
                );
                totalSuccess = result.success;
                totalFailed = result.failed;
            } else {
                throw new Error('No valid data found to import.');
            }

            await this.notificationService.createNotification(userId, {
                title: 'Excel Upload Completed',
                description: `Successfully imported ${totalSuccess} IP Addresses from ${fileName}. Failed: ${totalFailed}`,
                type: 'SYSTEM',
                metadata: {
                    fileName,
                    success: totalSuccess,
                    failed: totalFailed,
                },
            });

            if (jobId) {
                await this.uploadJobService.markCompleted(jobId, {
                    success: totalSuccess,
                    failed: totalFailed,
                    message: `Successfully imported ${totalSuccess} IP addresses.`,
                });
            }

            this.logger.log(
                `[BACKGROUND_UPLOAD_COMPLETED] Success: ${totalSuccess}, Failed: ${totalFailed}`,
            );
        } catch (error) {
            this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
            await this.notificationService.createNotification(userId, {
                title: 'Excel Upload Failed',
                description: `Background upload for ${fileName} failed: ${error.message}`,
                type: 'SYSTEM',
                metadata: { fileName, error: error.message },
            });

            if (jobId) {
                await this.uploadJobService.markFailed(jobId, error.message);
            }
        }
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
