import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { RedisService } from '../redis/redis.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto, TaskViewMode } from './dto/task.dto';
import { NotificationService } from '../notification/notification.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, TaskStatus } from '@prisma/client';

@Injectable()
export class TaskService {
    private readonly logger = new Logger(TaskService.name);
    private readonly CACHE_TTL = 300; // 5 minutes
    private readonly CACHE_KEY = 'tasks';

    constructor(
        private prisma: PrismaService,
        private autoNumberService: AutoNumberService,
        private redisService: RedisService,
        private notificationService: NotificationService,
    ) { }

    async create(dto: CreateTaskDto, userId: string, files?: Express.Multer.File[]) {
        const taskNo = await this.autoNumberService.generateTaskNo();
        const { toTitleCase } = await import('../common/utils/string-helper');
        const fs = await import('fs');
        const path = await import('path');

        let attachment = dto.attachment;
        if (files && files.length > 0) {
            // Simple file save logic for demo
            const file = files[0];
            const fileName = `${Date.now()}-${file.originalname}`;
            const uploadPath = path.join(process.cwd(), 'uploads', fileName);
            fs.writeFileSync(uploadPath, file.buffer);
            attachment = `/uploads/${fileName}`;
        }

        // @ts-ignore
        const task = await this.prisma.task.create({
            data: {
                ...dto,
                // @ts-ignore
                taskTitle: toTitleCase(dto.taskTitle),
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                taskNo,
                createdBy: userId,
                attachment,
            },
            include: {
                // @ts-ignore
                project: true,
                // @ts-ignore
                assignee: true,
                // @ts-ignore
                creator: true,
                // @ts-ignore
                targetGroup: true,
                // @ts-ignore
                targetTeam: true,
            },
        });

        // Send notifications
        if (task.assignedTo) {
            await this.notificationService.createNotification(task.assignedTo, {
                title: 'New Task Assigned',
                description: `A new task "${task.taskTitle}" has been assigned to you.`,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            });
        }

        // @ts-ignore
        if (task.targetGroupId) {
            // @ts-ignore
            await this.notificationService.broadcastToGroup(task.targetGroupId, {
                // @ts-ignore
                title: `New Task for Group: ${task.targetGroup?.groupName || ''}`,
                description: `A new group task "${task.taskTitle}" has been created.`,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            });
        }

        // @ts-ignore
        if (task.targetTeamId) {
            // @ts-ignore
            await this.notificationService.createNotification(task.targetTeamId, { // Placeholder logic
                title: 'New Team Task',
                description: `A new task "${task.taskTitle}" has been assigned to your team.`,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            }).catch(() => { });
        }

        await this.invalidateCache();
        return task;
    }

    async findAll(pagination: PaginationDto, filter: FilterTaskDto, userId?: string, role?: string) {
        const { page = 1, limit = 25 } = pagination;
        const skip = (page - 1) * limit;

        const where: Prisma.TaskWhereInput = {
            AND: []
        };

        const andArray = where.AND as Array<Prisma.TaskWhereInput>;
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Handle ViewMode for specialized task views
        if (filter.viewMode && userId) {
            // Get user's team info for hierarchy resolution
            const userTeam = await this.prisma.team.findFirst({
                where: { email: (await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email },
                select: {
                    id: true,
                    clientGroupId: true,
                    companyId: true,
                    locationId: true,
                    subLocationId: true,
                }
            });

            // Get team members at same or lower hierarchy
            let teamMemberIds: string[] = [];
            if (userTeam) {
                const teamMembers = await this.prisma.team.findMany({
                    where: {
                        AND: [
                            { status: 'Active' },
                            {
                                OR: [
                                    { clientGroupId: userTeam.clientGroupId },
                                    { clientGroupId: null }
                                ]
                            },
                            {
                                OR: [
                                    { companyId: userTeam.companyId },
                                    { companyId: null }
                                ]
                            },
                            {
                                OR: [
                                    { locationId: userTeam.locationId },
                                    { locationId: null }
                                ]
                            },
                            {
                                OR: [
                                    { subLocationId: userTeam.subLocationId },
                                    { subLocationId: null }
                                ]
                            }
                        ]
                    },
                    select: { email: true }
                });

                // Get user IDs from team emails
                const emails = teamMembers.map(t => t.email).filter(Boolean) as string[];
                const users = await this.prisma.user.findMany({
                    where: { email: { in: emails } },
                    select: { id: true }
                });
                teamMemberIds = users.map(u => u.id);
            }

            // Apply viewMode filters
            switch (filter.viewMode) {
                case 'MY_PENDING':
                    andArray.push({
                        assignedTo: userId,
                        taskStatus: { in: ['Pending', 'Working', 'Hold'] }
                    });
                    break;

                case 'MY_COMPLETED':
                    andArray.push({
                        assignedTo: userId,
                        taskStatus: 'Success'
                    });
                    break;

                case 'TEAM_PENDING':
                    andArray.push({
                        OR: [
                            { assignedTo: { in: teamMemberIds } },
                            // @ts-ignore
                            { targetTeamId: userTeam?.id }
                        ],
                        taskStatus: { in: ['Pending', 'Working', 'Hold'] }
                    });
                    break;

                case 'TEAM_COMPLETED':
                    andArray.push({
                        OR: [
                            { assignedTo: { in: teamMemberIds } },
                            // @ts-ignore
                            { targetTeamId: userTeam?.id }
                        ],
                        taskStatus: 'Success'
                    });
                    break;

                case 'REVIEW_PENDING_BY_ME':
                    andArray.push({
                        createdBy: userId,
                        taskStatus: 'Review'
                    });
                    break;

                case 'REVIEW_PENDING_BY_TEAM':
                    andArray.push({
                        createdBy: { in: teamMemberIds },
                        taskStatus: 'Review'
                    });
                    break;
            }
        }

        if (filter.search) {
            const searchValues = filter.search.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean);
            const searchOrConditions: Prisma.TaskWhereInput[] = [];

            for (const val of searchValues) {
                const searchLower = val.toLowerCase();
                const searchTitle = toTitleCase(val);
                const looksLikeCode = /^[A-Z]{1,}-\d+$/i.test(val) || /^TASK-\d+$/i.test(val);

                const fieldOrConditions: Prisma.TaskWhereInput[] = [];

                if (looksLikeCode) {
                    fieldOrConditions.push({ taskNo: { equals: val, mode: 'insensitive' } });
                    fieldOrConditions.push({ taskNo: { contains: val, mode: 'insensitive' } });
                } else {
                    fieldOrConditions.push({ taskTitle: { contains: val, mode: 'insensitive' } });
                    fieldOrConditions.push({ taskTitle: { contains: searchTitle, mode: 'insensitive' } });
                    fieldOrConditions.push({ taskNo: { contains: val, mode: 'insensitive' } });
                }

                fieldOrConditions.push({ additionalNote: { contains: val, mode: 'insensitive' } });
                fieldOrConditions.push({ additionalNote: { contains: searchTitle, mode: 'insensitive' } });
                fieldOrConditions.push({ remarkChat: { contains: val, mode: 'insensitive' } });
                fieldOrConditions.push({ remarkChat: { contains: searchTitle, mode: 'insensitive' } });
                fieldOrConditions.push({ project: { projectName: { contains: val, mode: 'insensitive' } } });
                fieldOrConditions.push({ project: { projectName: { contains: searchTitle, mode: 'insensitive' } } });
                fieldOrConditions.push({ assignee: { firstName: { contains: val, mode: 'insensitive' } } });
                fieldOrConditions.push({ assignee: { lastName: { contains: val, mode: 'insensitive' } } });
                fieldOrConditions.push({ creator: { firstName: { contains: val, mode: 'insensitive' } } });
                fieldOrConditions.push({ worker: { firstName: { contains: val, mode: 'insensitive' } } });

                if ('pending'.includes(searchLower) && searchLower.length >= 3) fieldOrConditions.push({ taskStatus: 'Pending' });
                if ('success'.includes(searchLower) && searchLower.length >= 3) fieldOrConditions.push({ taskStatus: 'Success' });
                if ('working'.includes(searchLower) && searchLower.length >= 3) fieldOrConditions.push({ taskStatus: 'Working' });
                if ('review'.includes(searchLower) && searchLower.length >= 3) fieldOrConditions.push({ taskStatus: 'Review' });
                if ('hold'.includes(searchLower) && searchLower.length >= 3) fieldOrConditions.push({ taskStatus: 'Hold' });

                searchOrConditions.push({ OR: fieldOrConditions });
            }

            if (searchOrConditions.length > 0) {
                andArray.push({ OR: searchOrConditions });
            }
        }

        if (filter.taskStatus) {
            const statusValues = typeof filter.taskStatus === 'string'
                ? filter.taskStatus.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.taskStatus) ? filter.taskStatus : [filter.taskStatus];
            if (statusValues.length > 0) andArray.push({ taskStatus: { in: statusValues as any } });
        }

        if (filter.priority) {
            const priorityValues = typeof filter.priority === 'string'
                ? filter.priority.split(/[,\:;|]/).map(v => v.trim()).filter(Boolean)
                : Array.isArray(filter.priority) ? filter.priority : [filter.priority];
            if (priorityValues.length > 0) andArray.push({ priority: { in: priorityValues as any } });
        }

        if (filter.projectId) andArray.push({ projectId: filter.projectId });
        if (filter.assignedTo) andArray.push({ assignedTo: filter.assignedTo });
        if (filter.createdBy) andArray.push({ createdBy: filter.createdBy });
        if (filter.workingBy) andArray.push({ workingBy: filter.workingBy });

        // Visibility Filtering
        if (role !== 'ADMIN' && role !== 'SUPER_ADMIN' && userId) {
            // @ts-ignore
            const userGroups = await this.prisma.groupMember.findMany({
                where: { userId },
                select: { groupId: true }
            });
            const groupIds = userGroups.map(ug => ug.groupId);

            andArray.push({
                OR: [
                    { assignedTo: userId },
                    { createdBy: userId },
                    { workingBy: userId },
                    // @ts-ignore
                    { targetGroupId: { in: groupIds } }
                ]
            });
        }

        if (andArray.length === 0) delete where.AND;

        // --- Redis Caching ---
        const isCacheable = !filter.search && (!filter || Object.keys(filter).length <= 1);
        const cacheKey = `${this.CACHE_KEY}:list:p${page}:l${limit}`;

        if (isCacheable) {
            const cached = await this.redisService.getCache<any>(cacheKey);
            if (cached) return cached;
        }

        const [data, total] = await Promise.all([
            this.prisma.task.findMany({
                where,
                skip,
                take: limit,
                orderBy: { creatingTime: 'desc' },
                select: {
                    id: true,
                    // @ts-ignore
                    taskNo: true,
                    // @ts-ignore
                    taskTitle: true,
                    // @ts-ignore
                    taskStatus: true,
                    // @ts-ignore
                    priority: true,
                    // @ts-ignore
                    creatingTime: true,
                    // @ts-ignore
                    deadline: true,
                    // @ts-ignore
                    attachment: true,
                    // @ts-ignore
                    additionalNote: true,
                    // @ts-ignore
                    remarkChat: true,
                    // @ts-ignore
                    reminderTime: true,
                    // @ts-ignore
                    reviewedTime: true,
                    // @ts-ignore
                    completeTime: true,
                    // @ts-ignore
                    updatedAt: true,
                    // @ts-ignore
                    projectId: true,
                    project: {
                        select: { id: true, projectName: true, projectNo: true }
                    },
                    assignee: {
                        select: { id: true, firstName: true, lastName: true, email: true }
                    },
                    creator: {
                        select: { id: true, firstName: true, lastName: true, email: true }
                    },
                    worker: {
                        select: { id: true, firstName: true, lastName: true, email: true }
                    },
                    targetTeam: {
                        select: { id: true, teamName: true, email: true }
                    },
                    targetGroup: {
                        select: { id: true, groupName: true, groupCode: true }
                    }
                },
            }),
            this.prisma.task.count({ where }),
        ]);

        const response = {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };

        if (isCacheable) {
            await this.redisService.setCache(cacheKey, response, this.CACHE_TTL);
        }

        return response;
    }

    async findById(id: string) {
        const task = await this.prisma.task.findUnique({
            where: { id },
            include: {
                // @ts-ignore
                project: true,
                // @ts-ignore
                assignee: true,
                // @ts-ignore
                creator: true,
                // @ts-ignore
                worker: true,
                // @ts-ignore
                targetGroup: true,
                // @ts-ignore
                targetTeam: true,
            },
        });

        if (!task) {
            throw new NotFoundException(`Task with ID ${id} not found`);
        }

        return task;
    }

    async update(id: string, dto: UpdateTaskDto, userId: string) {
        await this.findById(id);
        const { toTitleCase } = await import('../common/utils/string-helper');

        const updated = await this.prisma.task.update({
            where: { id },
            data: {
                ...dto,
                // @ts-ignore
                taskTitle: dto.taskTitle ? toTitleCase(dto.taskTitle) : undefined,
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                remarkChat: dto.remarkChat ? toTitleCase(dto.remarkChat) : undefined,
            },
            include: {
                // @ts-ignore
                project: true,
                // @ts-ignore
                assignee: true,
                // @ts-ignore
                creator: true,
                // @ts-ignore
                worker: true,
                // @ts-ignore
                targetGroup: true,
                // @ts-ignore
                targetTeam: true,
            },
        });

        await this.invalidateCache();
        return updated;
    }

    async delete(id: string) {
        await this.findById(id);
        const deleted = await this.prisma.task.delete({ where: { id } });
        await this.invalidateCache();
        return deleted;
    }

    private async invalidateCache() {
        await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:*`);
    }
}
