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
                status: dto.status || IpAddressStatus.ACTIVE,
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
            limit = 10,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const where = {
            ...(filter?.status && { status: filter.status }),
            ...(filter?.clientGroupId && { clientGroupId: filter.clientGroupId }),
            ...(filter?.companyId && { companyId: filter.companyId }),
            ...(filter?.locationId && { locationId: filter.locationId }),
            ...(filter?.subLocationId && { subLocationId: filter.subLocationId }),
            ...(filter?.ipAddress && { ipAddress: filter.ipAddress }),
            ...(search && {
                OR: [
                    {
                        ipAddressName: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        ipAddress: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        ipNo: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                ],
            }),
        };

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
        const filter: FilterIpAddressDto = { status: IpAddressStatus.ACTIVE };
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
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                updater: {
                    select: { id: true, firstName: true, lastName: true, email: true },
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
        const existing = await this.findById(id);

        await this.prisma.ipAddress.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'IP address permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateIpAddressDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        const allExisting = await this.prisma.ipAddress.findMany({
            select: { ipNo: true },
        });

        const existingNos = new Set(allExisting.map((x) => x.ipNo));

        let currentNum = parseInt(
            (await this.autoNumberService.generateIpNo()).replace('I-', ''),
        );

        for (const ipAddressDto of dto.ipAddresses) {
            try {
                const ipAddressName = ipAddressDto.ipAddressName?.trim() || ipAddressDto.ipAddress || 'Unnamed IP';

                let finalIpNo = ipAddressDto.ipNo?.trim();
                if (!finalIpNo || !finalIpNo.includes('I-') || existingNos.has(finalIpNo)) {
                    finalIpNo = `I-${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalIpNo)) {
                        finalIpNo = `I-${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalIpNo);

                const created = await this.prisma.ipAddress.create({
                    data: {
                        ...ipAddressDto,
                        ipAddressName,
                        ipNo: finalIpNo,
                        status: ipAddressDto.status || IpAddressStatus.ACTIVE,
                        createdBy: userId,
                    },
                });
                results.push(created);
            } catch (error) {
                errors.push({
                    ipAddress: ipAddressDto.ipAddress,
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
                const existing = await this.prisma.ipAddress.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.ipAddress.delete({
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

        const { data, errors } = await this.excelUploadService.parseFile<CreateIpAddressDto>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException(
                'No valid data found to import. Please check file format and column names.',
            );
        }

        // Validate enums and resolve names to IDs
        const processedData: CreateIpAddressDto[] = [];
        for (const row of data) {
            if (row.status) {
                this.excelUploadService.validateEnum(
                    row.status as string,
                    IpAddressStatus,
                    'Status',
                );
            }

            // Resolve clientGroupName to clientGroupId
            let clientGroupId: string | undefined = undefined;
            if ((row as any).clientGroupName) {
                const group = await this.prisma.clientGroup.findFirst({
                    where: { groupName: (row as any).clientGroupName },
                });
                if (!group) {
                    throw new BadRequestException(`Client Group not found: ${(row as any).clientGroupName}`);
                }
                clientGroupId = group.id;
            }

            // Resolve companyName to companyId
            let companyId: string | undefined = undefined;
            if ((row as any).companyName) {
                const company = await this.prisma.clientCompany.findFirst({
                    where: { companyName: (row as any).companyName },
                });
                if (!company) {
                    throw new BadRequestException(`Client Company not found: ${(row as any).companyName}`);
                }
                companyId = company.id;
            }

            // Resolve locationName to locationId
            let locationId: string | undefined = undefined;
            if ((row as any).locationName) {
                const location = await this.prisma.clientLocation.findFirst({
                    where: { locationName: (row as any).locationName },
                });
                if (!location) {
                    throw new BadRequestException(`Client Location not found: ${(row as any).locationName}`);
                }
                locationId = location.id;
            }

            // Resolve subLocationName to subLocationId
            let subLocationId: string | undefined = undefined;
            if ((row as any).subLocationName) {
                const subLocation = await this.prisma.subLocation.findFirst({
                    where: { subLocationName: (row as any).subLocationName },
                });
                if (!subLocation) {
                    throw new BadRequestException(`Sub Location not found: ${(row as any).subLocationName}`);
                }
                subLocationId = subLocation.id;
            }

            processedData.push({
                ipNo: (row as any).ipNo,
                ipAddress: (row as any).ipAddress,
                ipAddressName: (row as any).ipAddressName,
                clientGroupId,
                companyId,
                locationId,
                subLocationId,
                status: (row as any).status,
                remark: (row as any).remark,
            });
        }

        const result = await this.bulkCreate({ ipAddresses: processedData }, userId);

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
                entity: 'IpAddress',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
