import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { ExcelUploadService } from '../common/services/excel-upload.service';
import { ExcelDownloadService } from '../common/services/excel-download.service';
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
import { NotificationService } from '../notification/notification.service';
import { toTitleCase } from '../common/utils/string-helper';

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
    private configService: ConfigService,
    private notificationService: NotificationService,
    private excelDownloadService: ExcelDownloadService,
  ) { }

  async create(dto: CreateTeamDto, userId: string) {

    // Email duplication check
    const existingEmail = await this.prisma.team.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingEmail) {
      throw new BadRequestException('Email already registered');
    }

    // Team No duplication check
    if (dto.teamNo) {
      const existingTeamNo = await this.prisma.team.findUnique({
        where: { teamNo: dto.teamNo },
      });
      if (existingTeamNo) {
        throw new BadRequestException('Team Number already exists');
      }
    }

    // Hash password - Use provided password, fallback to default only if not provided
    const hashedPassword = await bcrypt.hash(dto.password || 'Welcome@123', 10);

    const teamNameFormatted = toTitleCase(dto.teamName);

    const generatedTeamNo = await this.autoNumberService.generateTeamNo();

    let roleName = toTitleCase(dto.role || 'Employee');
    if (dto.roleId) {
      const customRole = await this.prisma.role.findUnique({
        where: { id: dto.roleId },
      });
      if (customRole) {
        roleName = toTitleCase(customRole.name);
      }
    }

    const team = await this.prisma.team.create({
      data: {
        ...dto,
        teamName: teamNameFormatted,
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        status: dto.status || TeamStatus.Active,
        loginMethod: dto.loginMethod || LoginMethod.General,
        teamNo: dto.teamNo || generatedTeamNo,
        roleId: dto.roleId,
        role: roleName,
        createdBy: userId,
      },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'CREATE', team.id, null, team);

    // ============================================================
    // SMTP DISABLED: Email sending is currently not working in production.
    // User will login using the email + password set during creation.
    // After login, user can reset their password manually.
    // 
    // To re-enable, uncomment the code below:
    // ------------------------------------------------------------
    // try {
    //   await this.triggerInvitation(dto.email, teamNameFormatted);
    // } catch (err) {
    //   this.logger.error(`Failed to send invitation to ${dto.email}: ${err.message}`);
    // }
    // ============================================================

    this.logger.log(`[TEAM_CREATED] ${dto.email} - Password set directly, no invitation email sent (SMTP disabled)`);

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

    // Handle Status Filter
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

    const handleMultiIdFilter = (field: string, value: any) => {
      if (!value) return;
      const values = typeof value === 'string'
        ? value.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
        : Array.isArray(value) ? value : [value];
      if (values.length > 0) {
        andArray.push({ [field]: { in: values } });
      }
    };

    handleMultiIdFilter('clientGroupId', filter?.clientGroupId);
    handleMultiIdFilter('companyId', filter?.companyId);
    handleMultiIdFilter('locationId', filter?.locationId);
    handleMultiIdFilter('subLocationId', filter?.subLocationId);

    if (filter?.role) andArray.push(buildMultiValueFilter('role', filter.role));

    if (filter?.groupName) andArray.push({ clientGroup: buildMultiValueFilter('groupName', filter.groupName) });
    if (filter?.companyName) andArray.push({ company: buildMultiValueFilter('companyName', filter.companyName) });
    if (filter?.locationName) andArray.push({ location: buildMultiValueFilter('locationName', filter.locationName) });
    if (filter?.subLocationName) andArray.push({ subLocation: buildMultiValueFilter('subLocationName', filter.subLocationName) });

    if (filter?.email) andArray.push(buildMultiValueFilter('email', filter.email));
    if (filter?.phone) andArray.push(buildMultiValueFilter('phone', filter.phone));
    if (filter?.loginMethod) handleMultiIdFilter('loginMethod', filter.loginMethod);
    if (filter?.teamName) andArray.push(buildMultiValueFilter('teamName', filter.teamName));
    if (filter?.teamNo) andArray.push(buildMultiValueFilter('teamNo', filter.teamNo));
    if (filter?.remark) andArray.push(buildMultiValueFilter('remark', filter.remark));


    if (cleanedSearch) {
      const searchValues = cleanedSearch.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
      const allSearchConditions: Prisma.TeamWhereInput[] = [];

      for (const val of searchValues) {
        const searchLower = val.toLowerCase();
        const searchTitle = toTitleCase(val);

        allSearchConditions.push({ teamName: { contains: val, mode: 'insensitive' } });
        allSearchConditions.push({ teamName: { contains: searchTitle, mode: 'insensitive' } });
        allSearchConditions.push({ email: { contains: val, mode: 'insensitive' } });
        allSearchConditions.push({ teamNo: { contains: val, mode: 'insensitive' } });

        if ('active'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: TeamStatus.Active });
        }
        if ('inactive'.includes(searchLower) && searchLower.length >= 3) {
          allSearchConditions.push({ status: TeamStatus.Inactive });
        }

        // Handle Role Search
        allSearchConditions.push({ role: { contains: searchLower, mode: 'insensitive' } });
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
        select: {
          id: true,
          teamNo: true,
          teamName: true,
          email: true,
          phone: true,
          role: true,
          roleId: true,
          customRole: {
            select: {
              id: true,
              name: true,
            },
          },
          status: true,
          loginMethod: true,
          remark: true,
          createdAt: true,
          clientGroupId: true,
          companyId: true,
          locationId: true,
          subLocationId: true,
          clientGroup: {
            select: {
              id: true,
              groupName: true,
              groupCode: true,
            },
          },
          company: {
            select: {
              id: true,
              companyName: true,
              companyCode: true,
            },
          },
          location: {
            select: {
              id: true,
              locationName: true,
              locationCode: true,
            },
          },
          subLocation: {
            select: {
              id: true,
              subLocationName: true,
              subLocationCode: true,
            },
          },
        },
      }),
      this.prisma.team.count({ where }),
    ]);

    // Map the data to include flat field names for frontend table
    const mappedData = data.map((team) => ({
      ...team,
      roleName: toTitleCase(team.customRole?.name || team.role),
      groupName: team.clientGroup?.groupName || '',
      groupCode: team.clientGroup?.groupCode || '',
      companyName: team.company?.companyName || '',
      companyCode: team.company?.companyCode || '',
      locationName: team.location?.locationName || '',
      locationCode: team.location?.locationCode || '',
      subLocationName: team.subLocation?.subLocationName || '',
      subLocationCode: team.subLocation?.subLocationCode || '',
    }));

    const response = new PaginatedResponse(mappedData, total, page, limit);

    if (isCacheable) {
      await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
      this.logger.log(`[CACHE_MISS] Team List - Cached result: ${cacheKey}`);
    }

    return response;
  }

  async downloadExcel(query: any, userId: string, res: any) {
    const { data } = await this.findAll({ page: 1, limit: 1000000 }, query);

    const mappedData = data.map((item: any, index) => ({
      srNo: index + 1,
      teamNo: item.teamNo,
      teamName: item.teamName,
      email: item.email,
      phone: item.phone || 'N/A',
      role: item.roleName || 'N/A',
      groupName: item.groupName || 'N/A',
      companyName: item.companyName || 'N/A',
      locationName: item.locationName || 'N/A',
      subLocationName: item.subLocationName || 'N/A',
      status: item.status,
      loginMethod: item.loginMethod || 'N/A',
      remark: item.remark || 'N/A',
      createdAt: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A',
    }));

    const columns = [
      { header: '#', key: 'srNo', width: 10 },
      { header: 'Team No', key: 'teamNo', width: 15 },
      { header: 'Team Name', key: 'teamName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Role', key: 'role', width: 15 },
      { header: 'Client Group', key: 'groupName', width: 20 },
      { header: 'Company', key: 'companyName', width: 20 },
      { header: 'Location', key: 'locationName', width: 20 },
      { header: 'SubLocation', key: 'subLocationName', width: 20 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Login Method', key: 'loginMethod', width: 15 },
      { header: 'Remark', key: 'remark', width: 25 },
      { header: 'Created Date', key: 'createdAt', width: 20 },
    ];

    await this.excelDownloadService.downloadExcel(res, mappedData, columns, 'teams.xlsx', 'Team Members');
  }

  async findActive(pagination: PaginationDto) {
    const filter: FilterTeamDto = { status: TeamStatus.Active };
    return this.findAll(pagination, filter);
  }

  async findById(id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id },
    });

    if (!team) {
      throw new NotFoundException('Team member not found');
    }

    return team;
  }

  async update(id: string, dto: UpdateTeamDto, userId: string) {
    const existing = await this.findById(id);

    // Email duplication check if changed
    if (dto.email && dto.email.toLowerCase() !== existing.email) {
      const emailDup = await this.prisma.team.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (emailDup) throw new BadRequestException('Email already in use');
    }

    // Team No duplication check if changed
    if (dto.teamNo && dto.teamNo !== existing.teamNo) {
      const idDup = await this.prisma.team.findUnique({
        where: { teamNo: dto.teamNo },
      });
      if (idDup) throw new BadRequestException('Team Number already in use');
    }

    const data: any = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }
    if (dto.teamName) data.teamName = toTitleCase(dto.teamName);
    if (dto.email) data.email = dto.email.toLowerCase();

    if (dto.role) data.role = toTitleCase(dto.role);
    if (dto.roleId) {
      const customRole = await this.prisma.role.findUnique({
        where: { id: dto.roleId },
      });
      if (customRole) {
        data.role = toTitleCase(customRole.name);
      }
    }

    const updated = await this.prisma.team.update({
      where: { id },
      data: {
        ...data,
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
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            createdPendingTasks: true,
            assignedPendingTasks: true,
            workingPendingTasks: true,
            createdCompletedTasks: true,
            assignedCompletedTasks: true,
            workingCompletedTasks: true,
            groupMembers: true,
          }
        }
      }
    });

    if (!team) {
      throw new NotFoundException('Team member not found');
    }

    const { _count } = team;
    const childCounts = [
      _count.createdPendingTasks > 0 && `${_count.createdPendingTasks} created pending tasks`,
      _count.assignedPendingTasks > 0 && `${_count.assignedPendingTasks} assigned pending tasks`,
      _count.workingPendingTasks > 0 && `${_count.workingPendingTasks} working pending tasks`,
      _count.createdCompletedTasks > 0 && `${_count.createdCompletedTasks} created completed tasks`,
      _count.assignedCompletedTasks > 0 && `${_count.assignedCompletedTasks} assigned completed tasks`,
      _count.workingCompletedTasks > 0 && `${_count.workingCompletedTasks} working completed tasks`,
      _count.groupMembers > 0 && `${_count.groupMembers} group memberships`,
    ].filter(Boolean);

    if (childCounts.length > 0) {
      throw new BadRequestException(
        `Cannot delete Team Member because they have: ${childCounts.join(', ')}. Please reassign or remove them first.`
      );
    }

    await this.prisma.team.delete({
      where: { id },
    });

    await this.invalidateCache();
    await this.logAudit(userId, 'DELETE', id, team, null);

    return { message: 'Team member deleted successfully' };
  }

  async bulkCreate(dto: BulkCreateTeamDto, userId: string) {
    this.logger.log(`[BULK_CREATE] Starting for ${dto.teams.length} records`);
    const results: any[] = [];
    const errors: any[] = [];

    for (const teamDto of dto.teams) {
      try {
        const res = await this.create({
          ...teamDto,
          password: teamDto.password || 'Welcome@123',
        }, userId);
        results.push(res);
      } catch (err) {
        errors.push({ email: teamDto.email, error: err.message });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      message: `Successfully processed ${results.length} records.`,
      errors,
    };
  }

  async bulkUpdate(dto: BulkUpdateTeamDto, userId: string) {
    const results: any[] = [];
    const errors: any[] = [];

    for (const item of dto.updates) {
      try {
        const res = await this.update(item.id, item, userId);
        results.push(res);
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

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
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      deletedIds: results,
      errors,
    };
  }

  async uploadExcel(file: Express.Multer.File, userId: string) {
    const columnMapping = {
      teamNo: ['teamno', 'no', 'code', 'id'],
      teamName: ['teamname', 'name'],
      email: ['email', 'mail', 'e-mail'],
      role: ['role', 'designation', 'position'],
      status: ['status', 'state', 'active'],
    };

    const requiredColumns = ['teamName', 'email'];

    const { data, errors: parseErrors } = await this.excelUploadService.parseFile<any>(
      file,
      columnMapping,
      requiredColumns,
    );

    if (data.length === 0) {
      throw new BadRequestException('No valid data found or required columns missing');
    }

    const processedData: any[] = [];
    for (const row of data) {
      processedData.push({
        ...row,
        status: row.status ? this.excelUploadService.validateEnum(row.status, TeamStatus, 'Status') : TeamStatus.Active,
        role: row.role ? toTitleCase(row.role) : 'Employee',
        loginMethod: LoginMethod.General,
      });
    }

    const result = await this.bulkCreate({ teams: processedData }, userId);
    result.errors = [...(result.errors || []), ...parseErrors];

    return result;
  }

  async resendInvitation(id: string, userId: string) {
    const team = await this.findById(id);
    const fullName = team.teamName;

    try {
      await this.triggerInvitation(team.email, fullName);
      await this.logAudit(userId, 'RESEND_INVITATION', id, null, { email: team.email });
      return { message: `Invitation resent to ${team.email}` };
    } catch (err) {
      throw new BadRequestException(`Failed to resend invitation: ${err.message}`);
    }
  }

  async triggerInvitation(email: string, teamName: string) {
    try {
      // 1. Generate invitation token
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');

      // Store token in Redis with 24 hour expiry (86400 seconds)
      await this.redisService.set(`invitation:${token}`, email, 86400);

      // 2. Send email via NotificationService
      await this.notificationService.sendInvitation(email, teamName, token);

      this.logger.log(`[INVITATION] Sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error(`[INVITATION_FAIL] ${error.message}`);
      // Don't throw to prevent blocking creation flow
      return false;
    }
  }

  private async invalidateCache() {
    await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:*`);
    await this.redisService.deleteCachePattern(`client_groups:*`);
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
        entity: 'Team',
        entityId,
        oldValue: oldValue,
        newValue: newValue,
        ipAddress: '',
      },
    });
  }
}
