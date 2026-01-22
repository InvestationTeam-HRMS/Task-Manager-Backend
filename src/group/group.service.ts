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

import { buildMultiValueFilter } from '../common/utils/prisma-helper';

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
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.GroupWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.GroupWhereInput>;

        // Handle Status Filter
        if (filter?.status) {
            const statusValues = typeof filter.status === 'string'
                ? filter.status.split(/[,\:;]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.status) ? filter.status : [filter.status];
            if (statusValues.length > 0) andArray.push({ status: { in: statusValues as any } });
        }

        if (filter?.clientGroupId) andArray.push({ clientGroupId: filter.clientGroupId });
        if (filter?.companyId) andArray.push({ companyId: filter.companyId });
        if (filter?.locationId) andArray.push({ locationId: filter.locationId });
        if (filter?.subLocationId) andArray.push({ subLocationId: filter.subLocationId });
        if (filter?.groupName) andArray.push(buildMultiValueFilter('groupName', filter.groupName));
        if (filter?.groupNo) andArray.push(buildMultiValueFilter('groupNo', filter.groupNo));
        if (filter?.groupCode) andArray.push(buildMultiValueFilter('groupCode', filter.groupCode));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));

        if (cleanedSearch) {
            const orConditions: Prisma.GroupWhereInput[] = [
                { groupName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { groupCode: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { groupNo: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { remark: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } },
                { subLocation: { subLocationName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
                { location: { locationName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
                { company: { companyName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
                { clientGroup: { groupName: { contains: cleanedSearch, mode: Prisma.QueryMode.insensitive } } },
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
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.groups.length} records`);
        const errors: any[] = [];

        const allExisting = await this.prisma.group.findMany({
            select: { groupCode: true, groupNo: true },
        });
        const existingCodes = new Set(allExisting.map((x) => x.groupCode));
        const existingNos = new Set(allExisting.map((x) => x.groupNo));

        const prefix = 'G-';
        const startNo = await this.autoNumberService.generateGroupNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const groupDto of dto.groups) {
            try {
                const groupName = groupDto.groupName?.trim() || groupDto.groupCode || 'Unnamed Group';

                // Unique code logic
                let finalGroupCode = groupDto.groupCode?.trim() || `GRP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                if (existingCodes.has(finalGroupCode)) {
                    let suffix = 1;
                    const originalCode = finalGroupCode;
                    while (existingCodes.has(`${originalCode}-${suffix}`)) {
                        suffix++;
                    }
                    finalGroupCode = `${originalCode}-${suffix}`;
                }
                existingCodes.add(finalGroupCode);

                // Unique number logic
                let finalGroupNo = groupDto.groupNo?.trim();
                if (!finalGroupNo || existingNos.has(finalGroupNo)) {
                    finalGroupNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalGroupNo)) {
                        finalGroupNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalGroupNo);

                dataToInsert.push({
                    ...groupDto,
                    groupName,
                    groupCode: finalGroupCode,
                    groupNo: finalGroupNo,
                    status: groupDto.status || GroupStatus.ACTIVE,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ groupCode: groupDto.groupCode, error: err.message });
            }
        }

        const chunks: any[][] = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        for (const chunk of chunks) {
            try {
                await this.prisma.group.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.groups.length} | Inserted Approx: ${dataToInsert.length} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: dataToInsert.length,
            failed: errors.length,
            message: `Successfully processed ${dataToInsert.length} records.`,
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

        // 1. Resolve all relation names in batches
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

        // 2. Build processing data
        const processedData: CreateGroupDto[] = [];
        for (const row of data) {
            try {
                if (row.status) {
                    this.excelUploadService.validateEnum(row.status as string, GroupStatus, 'Status');
                }

                processedData.push({
                    groupNo: (row as any).groupNo,
                    groupName: (row as any).groupName,
                    groupCode: (row as any).groupCode,
                    clientGroupId: (row as any).clientGroupName ? clientGroupMap.get((row as any).clientGroupName.toLowerCase()) : undefined,
                    companyId: (row as any).companyName ? companyMap.get((row as any).companyName.toLowerCase()) : undefined,
                    locationId: (row as any).locationName ? locationMap.get((row as any).locationName.toLowerCase()) : undefined,
                    subLocationId: (row as any).subLocationName ? subLocationMap.get((row as any).subLocationName.toLowerCase()) : undefined,
                    status: (row as any).status as GroupStatus,
                    remark: (row as any).remark,
                });
            } catch (err) {
                this.logger.error(`[UPLOAD_ROW_ERROR] ${err.message}`);
            }
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
