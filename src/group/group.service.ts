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
    CreateGroupDto,
    UpdateGroupDto,
    BulkCreateGroupDto,
    BulkUpdateGroupDto,
    BulkDeleteGroupDto,
    ChangeStatusDto,
    FilterGroupDto,
} from './dto/group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { GroupStatus, Prisma } from '@prisma/client';

@Injectable()
export class GroupService {
    private readonly logger = new Logger(GroupService.name);
    private readonly CACHE_TTL = 300;
    private readonly CACHE_KEY = 'groups';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

    async create(dto: CreateGroupDto, userId: string) {
        // Check for duplicate group code
        const existing = await this.prisma.group.findUnique({
            where: { groupCode: dto.groupCode },
        });

        if (existing) {
            throw new ConflictException('Group code already exists');
        }

        // Validate optional relationships
        if (dto.clientGroupId) {
            const clientGroup = await this.prisma.clientGroup.findFirst({
                where: { id: dto.clientGroupId },
            });
            if (!clientGroup) throw new NotFoundException('Client group not found');
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

        const generatedGroupNo = await this.autoNumberService.generateGroupNo();

        const group = await this.prisma.group.create({
            data: {
                ...dto,
                groupNo: dto.groupNo || generatedGroupNo,
                status: dto.status || GroupStatus.ACTIVE,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', group.id, null, group);

        return group;
    }

    async findAll(pagination: PaginationDto, filter?: FilterGroupDto) {
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
            ...(filter?.groupCode && { groupCode: filter.groupCode }),
            ...(search && {
                OR: [
                    {
                        groupName: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        groupCode: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        groupNo: {
                            contains: search,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                ],
            }),
        };

        const [data, total] = await Promise.all([
            this.prisma.group.findMany({
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
            this.prisma.group.count({ where }),
        ]);

        const mappedData = data.map((item) => ({
            ...item,
            clientCompany: item.company,
            clientLocation: item.location,
            clientGroupName: item.clientGroup?.groupName,
            companyName: item.company?.companyName,
            locationName: item.location?.locationName,
            subLocationName: item.subLocation?.subLocationName,
        }));

        return new PaginatedResponse(mappedData, total, page, limit);
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterGroupDto = { status: GroupStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const group = await this.prisma.group.findFirst({
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

        if (!group) {
            throw new NotFoundException('Group not found');
        }

        return group;
    }

    async update(id: string, dto: UpdateGroupDto, userId: string) {
        const existing = await this.findById(id);

        // Check for duplicate group code if being updated
        if (dto.groupCode && dto.groupCode !== existing.groupCode) {
            const duplicate = await this.prisma.group.findUnique({
                where: { groupCode: dto.groupCode },
            });

            if (duplicate) {
                throw new ConflictException('Group code already exists');
            }
        }

        // Validate optional relationships if being updated
        if (dto.clientGroupId) {
            const clientGroup = await this.prisma.clientGroup.findFirst({
                where: { id: dto.clientGroupId },
            });
            if (!clientGroup) throw new NotFoundException('Client group not found');
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

        const updated = await this.prisma.group.update({
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

        const updated = await this.prisma.group.update({
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

        await this.prisma.group.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Group permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateGroupDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        const allExisting = await this.prisma.group.findMany({
            select: { groupCode: true, groupNo: true },
        });

        const existingCodes = new Set(allExisting.map((x) => x.groupCode));
        const existingNos = new Set(allExisting.map((x) => x.groupNo));

        let currentNum = parseInt(
            (await this.autoNumberService.generateGroupNo()).replace('G-', ''),
        );

        for (const groupDto of dto.groups) {
            try {
                const groupName = groupDto.groupName?.trim() || groupDto.groupCode || 'Unnamed Group';

                // Unique code logic
                let finalGroupCode = groupDto.groupCode?.trim() || `GRP-${Date.now()}`;
                const originalCode = finalGroupCode;
                let cSuffix = 1;
                while (existingCodes.has(finalGroupCode)) {
                    finalGroupCode = `${originalCode}-${cSuffix}`;
                    cSuffix++;
                }
                existingCodes.add(finalGroupCode);

                // Unique number logic
                let finalGroupNo = groupDto.groupNo?.trim();
                if (!finalGroupNo || !finalGroupNo.includes('G-') || existingNos.has(finalGroupNo)) {
                    finalGroupNo = `G-${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalGroupNo)) {
                        finalGroupNo = `G-${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalGroupNo);

                const created = await this.prisma.group.create({
                    data: {
                        ...groupDto,
                        groupName,
                        groupCode: finalGroupCode,
                        groupNo: finalGroupNo,
                        status: groupDto.status || GroupStatus.ACTIVE,
                        createdBy: userId,
                    },
                });
                results.push(created);
            } catch (error) {
                errors.push({
                    groupCode: groupDto.groupCode,
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

    async bulkUpdate(dto: BulkUpdateGroupDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.group.update({
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

    async bulkDelete(dto: BulkDeleteGroupDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        for (const id of dto.ids) {
            try {
                const existing = await this.prisma.group.findUnique({ where: { id } });
                if (!existing) continue;

                await this.prisma.group.delete({
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
            groupNo: ['groupno', 'groupnumber', 'no', 'number'],
            groupName: ['groupname', 'name', 'gname', 'group'],
            groupCode: ['groupcode', 'code', 'gcode'],
            clientGroupName: ['clientgroupname', 'clientgroup', 'groupname'],
            companyName: ['companyname', 'clientcompanyname', 'company', 'clientcompany'],
            locationName: ['locationname', 'clientlocationname', 'location', 'clientlocation'],
            subLocationName: ['sublocationname', 'sublocation', 'clientsublocationname'],
            status: ['status', 'state', 'active'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['groupName', 'groupCode'];

        const { data, errors } = await this.excelUploadService.parseFile<CreateGroupDto>(
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
        const processedData: CreateGroupDto[] = [];
        for (const row of data) {
            if (row.status) {
                this.excelUploadService.validateEnum(row.status as string, GroupStatus, 'Status');
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
                groupNo: (row as any).groupNo,
                groupName: (row as any).groupName,
                groupCode: (row as any).groupCode,
                clientGroupId,
                companyId,
                locationId,
                subLocationId,
                status: (row as any).status,
                remark: (row as any).remark,
            });
        }

        const result = await this.bulkCreate({ groups: processedData }, userId);

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
                entity: 'Group',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
