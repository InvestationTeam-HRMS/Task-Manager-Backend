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
    CreateTeamDto,
    UpdateTeamDto,
    BulkCreateTeamDto,
    BulkUpdateTeamDto,
    BulkDeleteTeamDto,
    ChangeStatusDto,
    FilterTeamDto,
} from './dto/team.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponse } from '../common/dto/api-response.dto';
import { TeamStatus, LoginMethod, Prisma } from '@prisma/client';
import { buildMultiValueFilter } from '../common/utils/prisma-helper';

@Injectable()
export class TeamService {
    private readonly logger = new Logger(TeamService.name);
    private readonly CACHE_TTL = 300;
    private readonly CACHE_KEY = 'teams';

    constructor(
        private prisma: PrismaService,
        private redisService: RedisService,
        private autoNumberService: AutoNumberService,
        private excelUploadService: ExcelUploadService,
    ) { }

    async create(dto: CreateTeamDto, userId: string) {
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

        const generatedTeamNo = await this.autoNumberService.generateTeamNo();
        const { toTitleCase } = await import('../common/utils/string-helper');

        const team = await this.prisma.team.create({
            data: {
                ...dto,
                teamName: toTitleCase(dto.teamName),
                teamNo: dto.teamNo || generatedTeamNo,
                remark: dto.remark ? toTitleCase(dto.remark) : undefined,
                taskAssignPermission: dto.taskAssignPermission || false,
                loginMethod: dto.loginMethod || LoginMethod.EMAIL,
                status: dto.status || TeamStatus.ACTIVE,
                createdBy: userId,
            },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'CREATE', team.id, null, team);

        return team;
    }

    async findAll(pagination: PaginationDto, filter?: FilterTeamDto) {
        const {
            page = 1,
            limit = 25,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;

        const cleanedSearch = search?.trim();
        const where: Prisma.TeamWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.TeamWhereInput>;

        const { toTitleCase } = await import('../common/utils/string-helper');

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
        if (filter?.teamName) andArray.push(buildMultiValueFilter('teamName', toTitleCase(filter.teamName)));
        if (filter?.teamNo) andArray.push(buildMultiValueFilter('teamNo', filter.teamNo));
        if (filter?.remark) andArray.push(buildMultiValueFilter('remark', toTitleCase(filter.remark)));

        if (cleanedSearch) {
            const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const allSearchConditions: Prisma.TeamWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);
                const looksLikeCode = /^[A-Z]{1,}-\d+$/i.test(val) || /^U-\d+$/i.test(val) || /^[A-Z0-9-]+$/i.test(val);

                if (looksLikeCode) {
                    allSearchConditions.push({ teamNo: { equals: val, mode: 'insensitive' } });
                    allSearchConditions.push({ teamNo: { contains: val, mode: 'insensitive' } });
                } else {
                    allSearchConditions.push({ teamName: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ teamName: { contains: searchTitle, mode: 'insensitive' } });
                    allSearchConditions.push({ teamNo: { contains: val, mode: 'insensitive' } });
                    allSearchConditions.push({ email: { contains: val, mode: 'insensitive' } });
                }

                allSearchConditions.push({ remark: { contains: val, mode: 'insensitive' } });
                allSearchConditions.push({ remark: { contains: searchTitle, mode: 'insensitive' } });
                allSearchConditions.push({ subLocation: { subLocationName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ subLocation: { subLocationName: { contains: searchTitle, mode: 'insensitive' } } });
                allSearchConditions.push({ location: { locationName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ location: { locationName: { contains: searchTitle, mode: 'insensitive' } } });
                allSearchConditions.push({ company: { companyName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ company: { companyName: { contains: searchTitle, mode: 'insensitive' } } });
                allSearchConditions.push({ clientGroup: { groupName: { contains: val, mode: 'insensitive' } } });
                allSearchConditions.push({ clientGroup: { groupName: { contains: searchTitle, mode: 'insensitive' } } });

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
        // Only cache if there's no custom search/filter to avoid cache explosion
        const isCacheable = !cleanedSearch && (!filter || Object.keys(filter).length === 0);
        const cacheKey = `${this.CACHE_KEY}:list:p${page}:l${limit}:s${sortBy}:${sortOrder}`;

        if (isCacheable) {
            const cached = await this.redisService.getCache<PaginatedResponse<any>>(cacheKey);
            if (cached) {
                this.logger.log(`[CACHE_HIT] Team List - ${cacheKey}`);
                return cached;
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.team.findMany({
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
            this.prisma.team.count({ where }),
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

        const response = new PaginatedResponse(mappedData, total, page, limit);

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
            this.logger.log(`[CACHE_MISS] Team List - Cached result: ${cacheKey}`);
        }

        return response;
    }

    async findActive(pagination: PaginationDto) {
        const filter: FilterTeamDto = { status: TeamStatus.ACTIVE };
        return this.findAll(pagination, filter);
    }

    async findById(id: string) {
        const team = await this.prisma.team.findFirst({
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

        if (!team) {
            throw new NotFoundException('Team not found');
        }

        return team;
    }

    async update(id: string, dto: UpdateTeamDto, userId: string) {
        const existing = await this.findById(id);
        const { toTitleCase } = await import('../common/utils/string-helper');

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

        const updated = await this.prisma.team.update({
            where: { id },
            data: {
                ...dto,
                teamName: dto.teamName ? toTitleCase(dto.teamName) : undefined,
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

        const updated = await this.prisma.team.update({
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

        await this.prisma.team.delete({
            where: { id },
        });

        await this.invalidateCache();
        await this.logAudit(userId, 'HARD_DELETE', id, existing, null);

        return { message: 'Team permanently deleted successfully' };
    }

    async bulkCreate(dto: BulkCreateTeamDto, userId: string) {
        this.logger.log(`[BULK_CREATE_FAST] Starting for ${dto.teams.length} records`);
        const errors: any[] = [];
        const { toTitleCase } = await import('../common/utils/string-helper');

        const allExisting = await this.prisma.team.findMany({
            select: { teamNo: true },
        });
        const existingNos = new Set(allExisting.map((x) => x.teamNo));

        const prefix = 'U-';
        const startNo = await this.autoNumberService.generateTeamNo();
        let currentNum = parseInt(startNo.replace(prefix, ''));

        const BATCH_SIZE = 1000;
        const dataToInsert: any[] = [];

        for (const teamDto of dto.teams) {
            try {
                const teamName = toTitleCase(teamDto.teamName?.trim() || 'Unnamed Team');
                const remark = teamDto.remark ? toTitleCase(teamDto.remark) : undefined;

                // Unique number logic
                let finalTeamNo = teamDto.teamNo?.trim();
                if (!finalTeamNo || existingNos.has(finalTeamNo)) {
                    finalTeamNo = `${prefix}${currentNum}`;
                    currentNum++;
                    while (existingNos.has(finalTeamNo)) {
                        finalTeamNo = `${prefix}${currentNum}`;
                        currentNum++;
                    }
                }
                existingNos.add(finalTeamNo);

                dataToInsert.push({
                    ...teamDto,
                    teamName,
                    teamNo: finalTeamNo,
                    remark,
                    taskAssignPermission: teamDto.taskAssignPermission || false,
                    loginMethod: teamDto.loginMethod || LoginMethod.EMAIL,
                    status: teamDto.status || TeamStatus.ACTIVE,
                    createdBy: userId,
                });
            } catch (err) {
                errors.push({ teamName: teamDto.teamName, error: err.message });
            }
        }

        const chunks: any[][] = this.excelUploadService.chunk(dataToInsert, BATCH_SIZE);
        let totalInserted = 0;
        for (const chunk of chunks) {
            try {
                const result = await this.prisma.team.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                totalInserted += result.count;
            } catch (err) {
                this.logger.error(`[BATCH_INSERT_ERROR] ${err.message}`);
                errors.push({ error: 'Batch insert failed', details: err.message });
            }
        }

        this.logger.log(`[BULK_CREATE_COMPLETED] Processed: ${dto.teams.length} | Inserted Actual: ${totalInserted} | Errors: ${errors.length}`);
        await this.invalidateCache();

        return {
            success: totalInserted,
            failed: dto.teams.length - totalInserted,
            message: `Successfully inserted ${totalInserted} records.`,
            errors,
        };
    }

    async bulkUpdate(dto: BulkUpdateTeamDto, userId: string) {
        const results: any[] = [];
        const errors: any[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const update of dto.updates) {
                try {
                    const { id, ...data } = update;

                    const updated = await tx.team.update({
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

    async bulkDelete(dto: BulkDeleteTeamDto, userId: string) {
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
            teamNo: ['teamno', 'teamnumber', 'no', 'number'],
            teamName: ['teamname', 'name', 'tname', 'team'],
            email: ['email', 'mail'],
            phone: ['phone', 'contact', 'mobile', 'tel'],
            taskAssignPermission: ['taskassignpermission', 'taskassign', 'taskpermission'],
            groupName: ['groupname', 'clientgroupname', 'group', 'clientgroup'],
            companyName: ['companyname', 'clientcompanyname', 'company', 'clientcompany'],
            locationName: ['locationname', 'clientlocationname', 'location', 'clientlocation'],
            subLocationName: ['sublocationname', 'clientsublocationname', 'sublocation'],
            status: ['status', 'state', 'active'],
            loginMethod: ['loginmethod', 'login'],
            remark: ['remark', 'remarks', 'notes', 'description', 'comment'],
        };

        const requiredColumns = ['teamName'];

        const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
            file,
            columnMapping,
            requiredColumns,
        );

        if (data.length === 0) {
            throw new BadRequestException('No valid data found to import. Please check file format and column names.');
        }

        // Resolve relations
        const groupNames = Array.from(new Set(data.filter(r => r.groupName).map(r => r.groupName)));
        const companyNames = Array.from(new Set(data.filter(r => r.companyName).map(r => r.companyName)));
        const locationNames = Array.from(new Set(data.filter(r => r.locationName).map(r => r.locationName)));
        const subLocationNames = Array.from(new Set(data.filter(r => r.subLocationName).map(r => r.subLocationName)));

        const [dbGroups, dbCompanies, dbLocations, dbSubLocations] = await Promise.all([
            this.prisma.clientGroup.findMany({ where: { groupName: { in: groupNames } }, select: { id: true, groupName: true } }),
            this.prisma.clientCompany.findMany({ where: { companyName: { in: companyNames } }, select: { id: true, companyName: true } }),
            this.prisma.clientLocation.findMany({ where: { locationName: { in: locationNames } }, select: { id: true, locationName: true } }),
            this.prisma.subLocation.findMany({ where: { subLocationName: { in: subLocationNames } }, select: { id: true, subLocationName: true } }),
        ]);

        const groupMap = new Map(dbGroups.map(g => [g.groupName.toLowerCase(), g.id]));
        const companyMap = new Map(dbCompanies.map(c => [c.companyName.toLowerCase(), c.id]));
        const locationMap = new Map(dbLocations.map(l => [l.locationName.toLowerCase(), l.id]));
        const subLocationMap = new Map(dbSubLocations.map(s => [s.subLocationName.toLowerCase(), s.id]));

        const processedData: CreateTeamDto[] = [];
        const processingErrors: any[] = [];

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const status = row.status ? this.excelUploadService.validateEnum(row.status as string, TeamStatus, 'Status') : TeamStatus.ACTIVE;
                const loginMethod = row.loginMethod ? this.excelUploadService.validateEnum(row.loginMethod as string, LoginMethod, 'LoginMethod') : LoginMethod.EMAIL;

                if (!row.email) throw new Error(`Email is missing for ${row.teamName}`);
                if (!row.phone) throw new Error(`Phone is missing for ${row.teamName}`);

                const clientGroupId = groupMap.get(row.groupName?.toLowerCase());
                if (!clientGroupId) throw new Error(`Client Group "${row.groupName}" not found or missing`);

                const companyId = companyMap.get(row.companyName?.toLowerCase());
                if (!companyId) throw new Error(`Company "${row.companyName}" not found or missing`);

                const locationId = locationMap.get(row.locationName?.toLowerCase());
                if (!locationId) throw new Error(`Location "${row.locationName}" not found or missing`);

                const subLocationId = subLocationMap.get(row.subLocationName?.toLowerCase());
                if (!subLocationId) throw new Error(`Sub Location "${row.subLocationName}" not found or missing`);

                processedData.push({
                    teamNo: row.teamNo,
                    teamName: row.teamName,
                    email: row.email,
                    phone: row.phone,
                    taskAssignPermission: String(row.taskAssignPermission).toLowerCase() === 'true',
                    clientGroupId: clientGroupId,
                    companyId: companyId,
                    locationId: locationId,
                    subLocationId: subLocationId,
                    status: status as TeamStatus,
                    loginMethod: loginMethod as LoginMethod,
                    remark: row.remark,
                });
            } catch (err) {
                processingErrors.push({ row: i + 2, error: err.message });
            }
        }

        if (processedData.length === 0 && processingErrors.length > 0) {
            throw new BadRequestException(`Validation Failed: ${processingErrors[0].error}`);
        }

        const result = await this.bulkCreate({ teams: processedData }, userId);

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
                entity: 'Team',
                entityId,
                oldValue: oldValue,
                newValue: newValue,
                ipAddress: '',
            },
        });
    }
}
