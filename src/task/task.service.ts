import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { CloudinaryService } from '../common/services/cloudinary.service';
import { RedisService } from '../redis/redis.service';
import { UploadJobService } from '../common/services/upload-job.service';
import {
    CreateTaskDto,
    UpdateTaskDto,
    FilterTaskDto,
    TaskViewMode,
    UpdateTaskAcceptanceDto,
} from './dto/task.dto';
import { NotificationService } from '../notification/notification.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, AcceptanceStatus } from '@prisma/client';
import { TaskStatus } from './dto/task.dto';
import { toTitleCase } from '../common/utils/string-helper';
import { ExcelDownloadService } from '../common/services/excel-download.service';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { pipeline, Readable } from 'stream';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { isAdminRole } from '../common/utils/role-utils';

const csvParser = require('csv-parser');

const pipelineAsync = promisify(pipeline);

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
        private cloudinaryService: CloudinaryService,
        private excelDownloadService: ExcelDownloadService,
        private uploadJobService: UploadJobService,
        private eventEmitter: EventEmitter2,
    ) { }

    /**
     * Log task activity for activity timeline
     * Creates a notification entry that appears in the task's activity log
     */
    private async logTaskActivity(
        actorId: string,
        taskNo: string,
        taskId: string,
        type: 'TASK_CREATED' | 'TASK_ASSIGNED' | 'TASK_STATUS_CHANGE' | 'TASK_REMARK' | 'TASK_FILE_ADDED' | 'TASK_UPDATED',
        description: string,
        metadata?: Record<string, any>,
    ) {
        try {
            await this.prisma.notification.create({
                data: {
                    teamId: actorId,
                    title: type.replace(/_/g, ' ').replace(/TASK /g, ''),
                    description,
                    type,
                    metadata: {
                        taskId,
                        taskNo,
                        ...metadata,
                    },
                    isRead: true, // Mark as read so it doesn't show as unread notification
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to log task activity: ${error.message}`);
        }
    }

    async create(
        dto: CreateTaskDto,
        userId: string,
        files?: Express.Multer.File[],
    ) {
        const taskNo = await this.autoNumberService.generateTaskNo();

        let document = dto.document;
        if (files && files.length > 0) {
            const savedUrls: string[] = [];
            // Sanitize taskNo for Cloudinary (remove # and other special characters)
            const sanitizedTaskNo = taskNo.replace(/[^a-zA-Z0-9_-]/g, '');

            for (const file of files) {
                if (
                    !file.size ||
                    file.size === 0 ||
                    (!file.buffer && !file.path)
                )
                    continue;

                try {
                    const timestamp = Date.now();
                    const customName = `${sanitizedTaskNo}_${timestamp}_${file.originalname}`;
                    const folder = `hrms/tasks/${sanitizedTaskNo}`;
                    const result = await this.cloudinaryService.uploadFile(
                        file,
                        folder,
                        customName,
                    );
                    if (result.secure_url) {
                        savedUrls.push(result.secure_url);
                    }
                } catch (uploadError) {
                    this.logger.error(
                        `[TaskService] File upload error: ${uploadError.message}`,
                    );
                }
            }
            if (savedUrls.length > 0) {
                document = savedUrls.join(',');
            }
        }

        const task = await this.prisma.pendingTask.create({
            data: {
                ...dto,
                taskStatus: TaskStatus.Pending,
                taskTitle: toTitleCase(dto.taskTitle),
                additionalNote: dto.additionalNote
                    ? toTitleCase(dto.additionalNote)
                    : undefined,
                taskNo,
                createdBy: userId,
                document,
                reminderTime: dto.reminderTime
                    ? [...new Set(dto.reminderTime)].sort().map((d) => new Date(d))
                    : [],
                editTime: [],
                isSelfTask:
                    (dto.assignedTo === userId &&
                        !dto.targetGroupId &&
                        !dto.targetTeamId) ||
                    false,
                assignedTo:
                    dto.assignedTo && dto.assignedTo !== 'null' ? dto.assignedTo : null,
                targetGroupId:
                    dto.targetGroupId && dto.targetGroupId !== 'null'
                        ? dto.targetGroupId
                        : null,
                targetTeamId:
                    dto.targetTeamId && dto.targetTeamId !== 'null'
                        ? dto.targetTeamId
                        : null,
            } as any,
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: {
                    include: {
                        members: true,
                    },
                },
                targetTeam: true,
            },
        });

        const recipients = new Set<string>();

        if (task.assignedTo) {
            recipients.add(task.assignedTo);
        }

        if (task.targetTeamId) {
            recipients.add(task.targetTeamId);
        }

        // Handle Group Assignment and Task Acceptance
        if (task.targetGroupId) {
            const members = await this.prisma.groupMember.findMany({
                where: { groupId: task.targetGroupId },
            });

            if (members.length > 0) {
                const membersToNotify = members.filter((m) => m.userId !== userId);

                if (membersToNotify.length > 0) {
                    const acceptanceData = membersToNotify.map((m) => ({
                        taskId: task.id,
                        userId: m.userId,
                        groupId: task.targetGroupId,
                        status: 'PENDING',
                    }));

                    await (this.prisma as any).taskAcceptance.createMany({
                        data: acceptanceData,
                        skipDuplicates: true,
                    });

                    membersToNotify.forEach((m) => recipients.add(m.userId));
                }
            }
        }

        recipients.delete(userId);

        for (const recipientId of recipients) {
            let description = `A new task "${task.taskTitle}" has been assigned to you.`;

            // If it's a group assignment and the user is NOT the primary individual assignee
            if (
                task.targetGroupId &&
                recipientId !== task.assignedTo &&
                recipientId !== task.targetTeamId
            ) {
                description = `A new task "${task.taskTitle}" has been assigned to your group.`;
            }

            await this.notificationService.createNotification(recipientId, {
                title: 'New Task Assigned',
                description,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            });
        }

        // Log task creation activity
        await this.logTaskActivity(
            userId,
            task.taskNo,
            task.id,
            'TASK_CREATED',
            `Task created: ${task.taskTitle}`,
            { status: TaskStatus.Pending },
        );

        // Log assignment activity if assigned to someone
        const assigneeName = task.assignee?.teamName || task.targetTeam?.teamName || task.targetGroup?.groupName;
        if (assigneeName) {
            await this.logTaskActivity(
                userId,
                task.taskNo,
                task.id,
                'TASK_ASSIGNED',
                `Task assigned to ${assigneeName}`,
                { assigneeName },
            );
        }

        await this.invalidateCache();
        return this.sortTaskDates(task);
    }

    async getPendingAcceptances(userId: string) {
        return await (this.prisma as any).taskAcceptance.findMany({
            where: {
                userId,
                status: 'PENDING',
            },
            include: {
                pendingTask: {
                    include: {
                        project: { select: { projectName: true } },
                        creator: { select: { teamName: true, email: true } },
                    },
                },
                group: { select: { groupName: true } },
            },
        });
    }

    async updateAcceptanceStatus(
        id: string,
        dto: UpdateTaskAcceptanceDto,
        userId: string,
    ) {
        const { status } = dto;
        const acceptance = await (this.prisma as any).taskAcceptance.findUnique({
            where: { id },
            include: { pendingTask: true },
        });

        if (!acceptance || acceptance.userId !== userId) {
            throw new NotFoundException('Task acceptance record not found');
        }

        const updated = await (this.prisma as any).taskAcceptance.update({
            where: { id },
            data: {
                status,
                actionAt: new Date(),
            },
            include: {
                pendingTask: true,
            },
        });

        if (status === 'ACCEPTED') {
            // RACE CONDITION CHECK: Verify if task is already assigned
            if (acceptance.pendingTask.assignedTo) {
                // If assigned to someone else, throw error
                if (acceptance.pendingTask.assignedTo !== userId) {
                    throw new BadRequestException(
                        'This task has already been accepted by another group member.',
                    );
                }
            } else {
                // Assign the task to the user
                await (this.prisma as any).pendingTask.update({
                    where: { id: acceptance.taskId },
                    data: {
                        assignedTo: userId,
                        taskStatus: TaskStatus.Pending, // Ensure it stays pending but assigned
                        workingBy: null, // Clear previous worker info if re-pooling
                    },
                });

                // Optional: Auto-reject other pending acceptances for this task to clean up views
                await (this.prisma as any).taskAcceptance.updateMany({
                    where: {
                        taskId: acceptance.taskId,
                        id: { not: id },
                    },
                    data: { status: 'REJECTED' },
                });
            }

            await this.notificationService.createNotification(
                updated.pendingTask.createdBy,
                {
                    title: 'Task Accepted',
                    description: `A member has accepted the task "${updated.pendingTask.taskTitle}" (${updated.pendingTask.taskNo}).`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.pendingTask.id,
                        taskNo: updated.pendingTask.taskNo,
                    },
                },
            );

            // ALSO NOTIFY Group Members if it's a group task, so their lists refresh and remove the task
            if (updated.pendingTask.targetGroupId) {
                const members = await this.prisma.groupMember.findMany({
                    where: { groupId: updated.pendingTask.targetGroupId },
                    select: { userId: true },
                });

                for (const member of members) {
                    if (member.userId !== userId) {
                        // Don't notify the one who just accepted
                        await this.notificationService.createNotification(member.userId, {
                            title: 'Task Accepted by Peer',
                            description: `The task "${updated.pendingTask.taskTitle}" (${updated.pendingTask.taskNo}) has been accepted by someone else in your group.`,
                            type: 'TASK',
                            metadata: {
                                taskId: updated.pendingTask.id,
                                taskNo: updated.pendingTask.taskNo,
                            },
                        });
                    }
                }
            }
        } else if (status === 'REJECTED') {
            // If the user who rejected was the one currently assigned, clear the assignment
            // so others in the group can accept it.
            if (acceptance.pendingTask.assignedTo === userId) {
                await (this.prisma as any).pendingTask.update({
                    where: { id: acceptance.taskId },
                    data: {
                        assignedTo: null,
                        workingBy: null,
                        taskStatus: TaskStatus.Pending // Ensure it returns to Pending if it was in Review
                    },
                });
            }

            // Notify creator that a group member rejected the task
            await this.notificationService.createNotification(
                updated.pendingTask.createdBy,
                {
                    title: 'Task Acceptance Rejected',
                    description: `A group member has declined the task "${updated.pendingTask.taskTitle}" (${updated.pendingTask.taskNo}).`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.pendingTask.id,
                        taskNo: updated.pendingTask.taskNo,
                    },
                },
            );
        }

        await this.invalidateCache();
        return updated;
    }

    async findAll(
        pagination: PaginationDto,
        filter: FilterTaskDto,
        userId?: string,
        role?: string,
    ) {
        const {
            page = 1,
            limit = 25,
            sortBy = 'createdTime',
            sortOrder = 'desc',
        } = pagination;
        const skip = (page - 1) * limit;
        const { toTitleCase } = await import('../common/utils/string-helper');

        const statusValues = filter.taskStatus
            ? typeof filter.taskStatus === 'string'
                ? filter.taskStatus
                    .split(/[,\:;|]/)
                    .map((v) => v.trim())
                    .filter(Boolean)
                : Array.isArray(filter.taskStatus)
                    ? filter.taskStatus
                    : [filter.taskStatus]
            : [];

        const isStrictlyCompleted =
            filter.viewMode === TaskViewMode.MY_COMPLETED ||
            filter.viewMode === TaskViewMode.TEAM_COMPLETED ||
            (statusValues.length > 0 &&
                statusValues.every((s) => s === TaskStatus.Completed));

        const isStrictlyPending =
            filter.viewMode === TaskViewMode.MY_PENDING ||
            filter.viewMode === TaskViewMode.TEAM_PENDING ||
            filter.viewMode === TaskViewMode.REVIEW_PENDING_BY_ME ||
            filter.viewMode === TaskViewMode.REVIEW_PENDING_BY_TEAM ||
            (statusValues.length > 0 &&
                statusValues.every((s) => s !== TaskStatus.Completed));

        // Mixed view if neither strictly pending nor strictly completed
        const isMixedView = !isStrictlyCompleted && !isStrictlyPending;

        const andArray: any[] = [];
        const isAdmin =
            isAdminRole(role) ||
            role?.toUpperCase() === 'HR' ||
            role?.toUpperCase() === 'MANAGER';
        const isUuid = (v: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

        // 1. Priority Filters (Project, Priority, Search)
        if (filter.projectId) {
            if (isUuid(filter.projectId))
                andArray.push({ projectId: filter.projectId });
            else
                andArray.push({
                    project: {
                        OR: [
                            {
                                projectName: {
                                    contains: filter.projectId,
                                    mode: 'insensitive',
                                },
                            },
                            {
                                projectNo: { contains: filter.projectId, mode: 'insensitive' },
                            },
                        ],
                    },
                });
        }

        if (filter.priority) {
            const priorityValues =
                typeof filter.priority === 'string'
                    ? filter.priority
                        .split(/[,\:;|]/)
                        .map((v) => v.trim())
                        .filter(Boolean)
                    : Array.isArray(filter.priority)
                        ? filter.priority
                        : [filter.priority];
            if (priorityValues.length > 0)
                andArray.push({ priority: { in: priorityValues as any } });
        }

        if (filter.assignedTo) {
            if (isUuid(filter.assignedTo))
                andArray.push({ assignedTo: filter.assignedTo });
            else
                andArray.push({
                    OR: [
                        {
                            assignee: {
                                teamName: { contains: filter.assignedTo, mode: 'insensitive' },
                            },
                        },
                        {
                            assignee: {
                                email: { contains: filter.assignedTo, mode: 'insensitive' },
                            },
                        },
                        {
                            targetTeam: {
                                teamName: { contains: filter.assignedTo, mode: 'insensitive' },
                            },
                        },
                        {
                            targetGroup: {
                                groupName: { contains: filter.assignedTo, mode: 'insensitive' },
                            },
                        },
                    ],
                });
        }

        if (filter.createdBy) {
            if (isUuid(filter.createdBy))
                andArray.push({ createdBy: filter.createdBy });
            else
                andArray.push({
                    OR: [
                        {
                            creator: {
                                teamName: { contains: filter.createdBy, mode: 'insensitive' },
                            },
                        },
                        {
                            creator: {
                                email: { contains: filter.createdBy, mode: 'insensitive' },
                            },
                        },
                    ],
                });
        }

        if (filter.taskNo)
            andArray.push({
                taskNo: { contains: filter.taskNo, mode: 'insensitive' },
            });
        if (filter.taskTitle)
            andArray.push({
                taskTitle: { contains: filter.taskTitle, mode: 'insensitive' },
            });
        if (filter.document)
            andArray.push({
                document: { contains: filter.document, mode: 'insensitive' },
            });
        if (filter.remarkChat)
            andArray.push({
                remarkChat: { contains: filter.remarkChat, mode: 'insensitive' },
            });

        // Date Filters
        const dateFields = ['createdTime', 'deadline', 'completeTime'];
        dateFields.forEach((field) => {
            if ((filter as any)[field]) {
                const date = new Date((filter as any)[field]);
                if (!isNaN(date.getTime())) {
                    const startOfDay = new Date(date).setHours(0, 0, 0, 0);
                    const endOfDay = new Date(date).setHours(23, 59, 59, 999);
                    andArray.push({
                        [field]: { gte: new Date(startOfDay), lte: new Date(endOfDay) },
                    });
                }
            }
        });

        if (filter.search) {
            const val = filter.search;
            const searchTitle = toTitleCase(val);
            andArray.push({
                OR: [
                    { taskTitle: { contains: val, mode: 'insensitive' } },
                    { taskTitle: { contains: searchTitle, mode: 'insensitive' } },
                    { taskNo: { contains: val, mode: 'insensitive' } },
                    { additionalNote: { contains: val, mode: 'insensitive' } },
                    { remarkChat: { contains: val, mode: 'insensitive' } },
                    { document: { contains: val, mode: 'insensitive' } },
                    { project: { projectName: { contains: val, mode: 'insensitive' } } },
                    { project: { projectNo: { contains: val, mode: 'insensitive' } } },
                    { assignee: { teamName: { contains: val, mode: 'insensitive' } } },
                    { assignee: { email: { contains: val, mode: 'insensitive' } } },
                    { creator: { teamName: { contains: val, mode: 'insensitive' } } },
                    { creator: { email: { contains: val, mode: 'insensitive' } } },
                    { targetTeam: { teamName: { contains: val, mode: 'insensitive' } } },
                    {
                        targetGroup: { groupName: { contains: val, mode: 'insensitive' } },
                    },
                ],
            });
        }

        // Visibility Rules logic (unchanged structure)
        if (filter.viewMode && userId) {
            switch (filter.viewMode) {
                case TaskViewMode.ALL:
                    // Admin/User sees all dependent on default rules
                    break;
                case TaskViewMode.MY_PENDING:
                    andArray.push({
                        taskStatus: TaskStatus.Pending,
                        OR: [
                            { assignedTo: userId },
                            {
                                AND: [
                                    { assignedTo: null },
                                    { targetTeamId: userId },
                                ],
                            },
                        ],
                    });
                    break;
                case TaskViewMode.TEAM_PENDING:
                    andArray.push({
                        taskStatus: TaskStatus.Pending,
                        isSelfTask: false,
                        createdBy: userId,
                        AND: [
                            { OR: [{ assignedTo: { not: userId } }, { assignedTo: null }] },
                            {
                                OR: [{ targetTeamId: { not: userId } }, { targetTeamId: null }],
                            },
                        ],
                    });
                    break;
                case TaskViewMode.MY_COMPLETED:
                    andArray.push({ workingBy: userId });
                    break;
                case TaskViewMode.TEAM_COMPLETED:
                    andArray.push({
                        createdBy: userId,
                        isSelfTask: false,
                        OR: [{ workingBy: { not: userId } }, { workingBy: null }],
                    });
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_ME:
                    andArray.push({
                        createdBy: userId,
                        taskStatus: TaskStatus.ReviewPending,
                    });
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_TEAM:
                    andArray.push({
                        taskStatus: TaskStatus.ReviewPending,
                        workingBy: userId,
                        isSelfTask: false,
                        createdBy: { not: userId }, // Exclude tasks created by the same user
                    });
                    break;
            }
        }

        if (!isAdmin && userId && (!filter.viewMode || filter.viewMode === TaskViewMode.ALL)) {
            andArray.push({
                OR: [
                    { createdBy: userId },
                    { assignedTo: userId },
                    { workingBy: userId },
                    { targetTeamId: userId },
                    {
                        AND: [
                            { assignedTo: null },
                            { targetGroup: { members: { some: { userId } } } },
                        ],
                    },
                ],
            });
        }

        if (statusValues.length > 0) {
            andArray.push({ taskStatus: { in: statusValues as any } });
        }

        if (filter.workingBy) {
            if (isUuid(filter.workingBy))
                andArray.push({ workingBy: filter.workingBy });
            else
                andArray.push({
                    worker: {
                        teamName: { contains: filter.workingBy, mode: 'insensitive' },
                    },
                });
        }

        const where = { AND: andArray };
        const include = {
            project: { select: { id: true, projectName: true, projectNo: true } },
            assignee: { select: { id: true, teamName: true, email: true } },
            creator: { select: { id: true, teamName: true, email: true } },
            targetTeam: { select: { id: true, teamName: true, email: true } },
            targetGroup: { select: { id: true, groupName: true } },
            worker: { select: { id: true, teamName: true, email: true } },
        };

        let data: any[] = [];
        let total = 0;

        // Map frontend sort fields to Prisma orderBy
        let order: any;
        if (sortBy === 'projectName' || sortBy === 'projectNo') {
            order = { project: { [sortBy === 'projectName' ? 'projectName' : 'projectNo']: sortOrder } };
        } else if (sortBy === 'assigneeName' || sortBy === 'assignee') {
            order = { assignee: { teamName: sortOrder } };
        } else if (sortBy === 'creatorName' || sortBy === 'creator') {
            order = { creator: { teamName: sortOrder } };
        } else if (sortBy === 'targetTeamName' || sortBy === 'targetTeam') {
            order = { targetTeam: { teamName: sortOrder } };
        } else if (sortBy === 'targetGroupName' || sortBy === 'targetGroup') {
            order = { targetGroup: { groupName: sortOrder } };
        } else if (sortBy === 'workerName' || sortBy === 'workingBy') {
            order = { worker: { teamName: sortOrder } };
        } else if (sortBy === 'completeTime' && isStrictlyCompleted) {
            order = { completedAt: sortOrder };
        } else if (sortBy === 'createdTime') {
            order = { createdTime: sortOrder };
        } else {
            // Check if field exists on the model, if not, fallback
            const validFields = ['taskNo', 'taskTitle', 'deadline', 'priority', 'taskStatus', 'id', 'createdAt', 'updatedAt'];
            if (validFields.includes(sortBy)) {
                order = { [sortBy]: sortOrder };
            } else {
                order = { createdTime: sortOrder };
            }
        }

        if (isMixedView) {
            // MERGE STRATEGY: Fetch from both
            const fetchTake = skip + limit;

            const [pendingData, pendingCount, completedData, completedCount] =
                await Promise.all([
                    this.prisma.pendingTask.findMany({
                        where: where as any,
                        take: fetchTake,
                        orderBy: order,
                        include,
                    }),
                    this.prisma.pendingTask.count({ where: where as any }),
                    this.prisma.completedTask.findMany({
                        where: where as any,
                        take: fetchTake,
                        orderBy: order,
                        include,
                    }),
                    this.prisma.completedTask.count({ where: where as any }),
                ]);

            total = pendingCount + completedCount;
            const combined = [...pendingData, ...completedData];

            // Sort combined in memory using the same criteria
            combined.sort((a, b) => {
                const valA = a[sortBy];
                const valB = b[sortBy];

                if (valA === valB) return 0;
                if (valA == null) return 1;
                if (valB == null) return -1;

                let comparison = 0;
                if (valA instanceof Date && valB instanceof Date) {
                    comparison = valA.getTime() - valB.getTime();
                } else if (typeof valA === 'string' && typeof valB === 'string') {
                    comparison = valA.localeCompare(valB, undefined, {
                        numeric: true,
                        sensitivity: 'base',
                    });
                } else {
                    comparison = valA < valB ? -1 : 1;
                }

                return sortOrder === 'asc' ? comparison : -comparison;
            });

            // Slice the requested page
            data = combined.slice(skip, skip + limit);
        } else if (isStrictlyCompleted) {
            const [cData, cCount] = await Promise.all([
                this.prisma.completedTask.findMany({
                    where: where as any,
                    skip,
                    take: limit,
                    orderBy: order,
                    include,
                }),
                this.prisma.completedTask.count({ where: where as any }),
            ]);
            data = cData;
            total = cCount;
        } else {
            // Pending (Default)
            const [pData, pCount] = await Promise.all([
                this.prisma.pendingTask.findMany({
                    where: where as any,
                    skip,
                    take: limit,
                    orderBy: order,
                    include,
                }),
                this.prisma.pendingTask.count({ where: where as any }),
            ]);
            data = pData;
            total = pCount;
        }

        return {
            data: data.map((task) => this.sortTaskDates(task)),
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async findById(id: string) {
        // Try Pending first, then Completed
        let task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: true,
                targetTeam: true,
            },
        } as any);

        if (!task) {
            task = (await this.prisma.completedTask.findUnique({
                where: { id },
                include: {
                    project: true,
                    assignee: true,
                    creator: true,
                    targetGroup: true,
                    targetTeam: true,
                },
            } as any)) as any;
        }

        if (!task) throw new NotFoundException(`Task with ID ${id} not found`);
        return this.sortTaskDates(task);
    }

    async update(
        id: string,
        dto: UpdateTaskDto,
        userId: string,
        role: string,
        files?: Express.Multer.File[],
    ) {
        const existingTask = await this.findById(id);

        // Permission Check: Only Admin/SuperAdmin can update tasks
        // (Per user request: "admin ne hr ko task assign kia toh sirf admin edit kar skta hai")
        const isAdmin = isAdminRole(role);
        if (!isAdmin) {
            throw new ForbiddenException('Only Admins can edit tasks.');
        }

        const { toTitleCase } = await import('../common/utils/string-helper');
        const fs = await import('fs');
        const path = await import('path');

        // Handle File Update
        let document = dto.document; // This contains the existing comma-separated string from frontend
        if (files && files.length > 0) {
            const savedPaths: string[] = [];
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir))
                fs.mkdirSync(uploadDir, { recursive: true });

            const taskNo = existingTask.taskNo;
            for (const file of files) {
                const fileName = `${taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                if (file.buffer) {
                    fs.writeFileSync(uploadPath, file.buffer);
                } else if (file.path) {
                    fs.copyFileSync(file.path, uploadPath);
                    fs.unlinkSync(file.path);
                }
                savedPaths.push(`/uploads/${fileName}`);
            }

            // Merge existing paths from dto.document with new ones
            const existingPaths = dto.document
                ? dto.document.split(',').filter(Boolean)
                : [];
            document = [...existingPaths, ...savedPaths].join(',');
        }

        const currentEditTime = existingTask.editTime || [];
        const newEditTime = [...currentEditTime, new Date()];

        const reminderTime = dto.reminderTime
            ? [
                ...new Set([
                    ...(existingTask.reminderTime || []),
                    ...dto.reminderTime,
                ]),
            ]
                .sort()
                .map((d) => new Date(d))
            : undefined;

        const reviewedTime = dto.reviewedTime
            ? [
                ...new Set([
                    ...(existingTask.reviewedTime || []),
                    ...dto.reviewedTime,
                ]),
            ]
                .sort()
                .map((d) => new Date(d))
            : undefined;

        const model: any =
            existingTask.taskStatus === TaskStatus.Completed
                ? this.prisma.completedTask
                : this.prisma.pendingTask;

        const updated = await model.update({
            where: { id },
            data: {
                ...dto,
                taskTitle: dto.taskTitle ? toTitleCase(dto.taskTitle) : undefined,
                additionalNote: dto.additionalNote
                    ? toTitleCase(dto.additionalNote)
                    : undefined,
                remarkChat: dto.remarkChat ? toTitleCase(dto.remarkChat) : undefined,
                editTime: newEditTime,
                reminderTime: reminderTime,
                reviewedTime: reviewedTime,
                document: document,
                // Handle Reassignment: If one is set, others must be null
                assignedTo: dto.assignedTo !== undefined ? dto.assignedTo : undefined,
                targetGroupId:
                    dto.targetGroupId !== undefined ? dto.targetGroupId : undefined,
                targetTeamId:
                    dto.targetTeamId !== undefined ? dto.targetTeamId : undefined,
            },
            include: { assignee: true, creator: true, targetTeam: true },
        });

        // If assignment changed, notify new assignee (Optimized to avoid duplicate notification if nothing changed)
        // For simplicity in this quick fix, we just assume if these fields are present, it's a reassignment
        if (dto.assignedTo || dto.targetTeamId) {
            const newRecipient = dto.assignedTo || dto.targetTeamId;
            if (newRecipient && newRecipient !== 'null' && newRecipient !== userId) {
                await this.notificationService.createNotification(newRecipient, {
                    title: 'Task Re-Assigned',
                    description: `Task "${updated.taskTitle}" has been re-assigned to you.`,
                    type: 'TASK',
                    metadata: { taskId: updated.id, taskNo: updated.taskNo },
                });
            }
            // Log assignment activity
            const assigneeName = updated.assignee?.teamName || updated.targetTeam?.teamName;
            if (assigneeName) {
                await this.logTaskActivity(
                    userId,
                    updated.taskNo,
                    updated.id,
                    'TASK_ASSIGNED',
                    `Task re-assigned to ${assigneeName}`,
                    { assigneeName },
                );
            }
        }

        // Logic for Status Change Notification (e.g., Manually setting to Pending/Completed)
        if (dto.taskStatus && dto.taskStatus !== existingTask.taskStatus) {
            const workerId =
                updated.workingBy || updated.assignedTo || updated.targetTeamId;
            // Notify the worker if they are NOT the one making the change (e.g. Admin changed it)
            if (workerId && workerId !== userId) {
                await this.notificationService.createNotification(workerId, {
                    title: 'Task Status Updated',
                    description: `The status of task "${updated.taskTitle}" has been updated to ${dto.taskStatus}.`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.id,
                        taskNo: updated.taskNo,
                        status: dto.taskStatus,
                    },
                });
            }
            // Log status change activity
            await this.logTaskActivity(
                userId,
                updated.taskNo,
                updated.id,
                'TASK_STATUS_CHANGE',
                `Status changed to ${dto.taskStatus}`,
                { status: dto.taskStatus, previousStatus: existingTask.taskStatus },
            );
        } else if (dto.remarkChat && dto.remarkChat !== existingTask.remarkChat) {
            // CASE: Remark updated by Admin/Creator without status change
            const workerId = updated.workingBy || updated.assignedTo || updated.targetTeamId;
            if (workerId && workerId !== userId) {
                await this.notificationService.createNotification(workerId, {
                    title: 'New Remark on Task',
                    description: `A new remark has been added to task "${updated.taskTitle}" (${updated.taskNo}).`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.id,
                        taskNo: updated.taskNo,
                        remark: dto.remarkChat,
                    },
                });
            }
            // Log remark activity
            await this.logTaskActivity(
                userId,
                updated.taskNo,
                updated.id,
                'TASK_REMARK',
                dto.remarkChat,
                { remark: dto.remarkChat },
            );
        } else if (dto.taskTitle || dto.additionalNote || dto.deadline || dto.priority) {
            // CASE: Task details updated (title, note, deadline, priority changed)
            const workerId = updated.workingBy || updated.assignedTo || updated.targetTeamId;
            if (workerId && workerId !== userId) {
                await this.notificationService.createNotification(workerId, {
                    title: 'Task Details Updated',
                    description: `The task "${updated.taskTitle}" (${updated.taskNo}) has been updated by the creator.`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.id,
                        taskNo: updated.taskNo,
                    },
                });
            }
            // Log update activity
            await this.logTaskActivity(
                userId,
                updated.taskNo,
                updated.id,
                'TASK_UPDATED',
                `Task details updated`,
                { updatedFields: Object.keys(dto).filter(k => dto[k] !== undefined) },
            );
        }

        // Log file addition if new files were uploaded
        if (files && files.length > 0) {
            await this.logTaskActivity(
                userId,
                updated.taskNo,
                updated.id,
                'TASK_FILE_ADDED',
                `${files.length} file(s) added`,
                { files: files.map(f => f.originalname) },
            );
        }

        await this.invalidateCache();
        return this.sortTaskDates(updated);
    }

    async submitForReview(
        id: string,
        remark: string,
        userId: string,
        files?: Express.Multer.File[],
    ) {
        try {
            this.logger.log(`submitForReview called - id: ${id}, userId: ${userId}, remark: ${remark}, filesCount: ${files?.length || 0}`);

            const task = await this.prisma.pendingTask.findUnique({
                where: { id },
                include: { creator: true },
            });

            if (!task) throw new NotFoundException('Task not found');

            const isAlreadyInReview = (task.taskStatus as any) === TaskStatus.ReviewPending;

            if (!isAlreadyInReview && task.taskStatus !== TaskStatus.Pending)
                throw new BadRequestException(
                    'Only pending tasks can be submitted for review',
                );

            // Validate remark
            if (!remark || remark.trim() === '') {
                throw new BadRequestException('Remark is required');
            }

            let document = task.document;
            if (files && files.length > 0) {
                this.logger.log(`Processing ${files.length} files for task ${task.taskNo}`);
                const savedUrls: string[] = [];
                for (const file of files) {
                    try {
                        const timestamp = Date.now();
                        // Remove # from task number for Cloudinary compatibility
                        const sanitizedTaskNo = task.taskNo.replace('#', '');
                        const customName = `${sanitizedTaskNo}_${timestamp}_${file.originalname}`;
                        const folder = `hrms/tasks/${sanitizedTaskNo}`;
                        this.logger.log(`Uploading file: ${customName}`);
                        const result = await this.cloudinaryService.uploadFile(
                            file,
                            folder,
                            customName,
                        );
                        if (result.secure_url) {
                            savedUrls.push(result.secure_url);
                            this.logger.log(`File uploaded successfully: ${result.secure_url}`);
                        }
                    } catch (fileError) {
                        this.logger.error(`File upload failed: ${fileError.message}`, fileError.stack);
                        throw new BadRequestException(`Failed to upload file: ${file.originalname}`);
                    }
                }
                const existingDocs = task.document ? task.document.split(',') : [];
                document = [...existingDocs, ...savedUrls].join(',');
            }

            const updated = await this.prisma.pendingTask.update({
                where: { id },
                data: {
                    taskStatus: TaskStatus.ReviewPending as any,
                    remarkChat: remark,
                    workingBy: userId,
                    reviewedTime: { push: new Date() },
                    document: document,
                },
                include: { creator: true, project: true },
            });

            // Notify Creator
            if (updated.createdBy && updated.createdBy !== userId) {
                await this.notificationService.createNotification(updated.createdBy, {
                    title: isAlreadyInReview ? 'New Remark on Task' : 'Task Submitted for Review',
                    description: isAlreadyInReview
                        ? `Assignee has added a new remark to task "${updated.taskTitle}" (${updated.taskNo}).`
                        : `Task "${updated.taskTitle}" (${updated.taskNo}) has been submitted for review.`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.id,
                        taskNo: updated.taskNo,
                        status: isAlreadyInReview ? 'Remark Added' : 'Review Pending',
                    },
                });
            }

            // Log activity for submit for review
            if (!isAlreadyInReview) {
                await this.logTaskActivity(
                    userId,
                    updated.taskNo,
                    updated.id,
                    'TASK_STATUS_CHANGE',
                    `Submitted for review`,
                    { status: TaskStatus.ReviewPending, previousStatus: TaskStatus.Pending },
                );
            }

            // Log remark activity
            await this.logTaskActivity(
                userId,
                updated.taskNo,
                updated.id,
                'TASK_REMARK',
                remark,
                { remark },
            );

            // Log file activity if files were uploaded
            if (files && files.length > 0) {
                await this.logTaskActivity(
                    userId,
                    updated.taskNo,
                    updated.id,
                    'TASK_FILE_ADDED',
                    `${files.length} file(s) added`,
                    { files: files.map(f => f.originalname) },
                );
            }

            await this.invalidateCache();
            return this.sortTaskDates(updated);
        } catch (error) {
            this.logger.error(`submitForReview failed: ${error.message}`, error.stack);
            throw error;
        }
    }

    async finalizeCompletion(
        id: string,
        remark: string,
        userId: string,
        files?: Express.Multer.File[],
    ) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: true,
                targetTeam: true,
                worker: true,
            },
        });

        if (!task) throw new NotFoundException('Task not found');
        if ((task.taskStatus as any) !== TaskStatus.ReviewPending)
            throw new BadRequestException('Only tasks in review can be finalized');

        let document = task.document;
        if (files && files.length > 0) {
            const savedUrls: string[] = [];
            for (const file of files) {
                const timestamp = Date.now();
                // Remove # from task number for Cloudinary compatibility
                const sanitizedTaskNo = task.taskNo.replace('#', '');
                const customName = `${sanitizedTaskNo}_${timestamp}_${file.originalname}`;
                const folder = `hrms/tasks/${sanitizedTaskNo}`;
                const result = await this.cloudinaryService.uploadFile(
                    file,
                    folder,
                    customName,
                );
                if (result.secure_url) {
                    savedUrls.push(result.secure_url);
                }
            }
            const existingDocs = task.document ? task.document.split(',') : [];
            document = [...existingDocs, ...savedUrls].join(',');
        }

        try {
            const completedTask = await this.prisma.$transaction(async (tx) => {
                const completedData: any = {
                    id: task.id,
                    taskNo: task.taskNo,
                    taskTitle: task.taskTitle,
                    priority: task.priority,
                    taskStatus: TaskStatus.Completed as any,
                    additionalNote: task.additionalNote,
                    deadline: task.deadline,
                    completeTime: new Date(),
                    completedAt: new Date(),
                    reviewedTime: Array.isArray(task.reviewedTime)
                        ? [...task.reviewedTime, new Date()]
                        : [new Date()],
                    reminderTime: task.reminderTime || [],
                    document: document,
                    remarkChat: remark || task.remarkChat,
                    createdTime: task.createdTime,
                    editTime: task.editTime || [],
                    projectId: task.projectId || null,
                    assignedTo: task.assignedTo || null,
                    targetGroupId: task.targetGroupId || null,
                    targetTeamId: task.targetTeamId || null,
                    createdBy: task.createdBy || null,
                    workingBy: task.workingBy || userId,
                    isSelfTask: (task as any).isSelfTask || false,
                };

                // Create the completed task
                const completed = await tx.completedTask.create({
                    data: completedData,
                });

                // Delete from pending table (Cascade handles children like TaskAcceptance)
                await tx.pendingTask.delete({
                    where: { id: task.id },
                });

                return completed;
            });

            // Notify Worker and Original Assignee about completion
            const recipients = new Set<string>();
            if (task.workingBy) recipients.add(task.workingBy);
            if (task.assignedTo) recipients.add(task.assignedTo);
            if (task.targetTeamId) recipients.add(task.targetTeamId);

            for (const recipientId of recipients) {
                if (recipientId && recipientId !== userId) {
                    await this.notificationService.createNotification(recipientId, {
                        title: 'Task Completed',
                        description: `Your task "${task.taskTitle}" (${task.taskNo}) has been successfully finalized.`,
                        type: 'TASK',
                        metadata: {
                            taskId: completedTask.id,
                            taskNo: task.taskNo,
                            status: 'Completed',
                        },
                    });
                }
            }

            // Log task completion activity
            await this.logTaskActivity(
                userId,
                task.taskNo,
                completedTask.id,
                'TASK_STATUS_CHANGE',
                `Task marked as Completed`,
                { status: TaskStatus.Completed, previousStatus: TaskStatus.ReviewPending },
            );

            // Log remark if provided
            if (remark && remark.trim()) {
                await this.logTaskActivity(
                    userId,
                    task.taskNo,
                    completedTask.id,
                    'TASK_REMARK',
                    remark,
                    { remark },
                );
            }

            // Log file activity if files were uploaded
            if (files && files.length > 0) {
                await this.logTaskActivity(
                    userId,
                    task.taskNo,
                    completedTask.id,
                    'TASK_FILE_ADDED',
                    `${files.length} file(s) added`,
                    { files: files.map(f => f.originalname) },
                );
            }

            await this.invalidateCache();
            return this.sortTaskDates(completedTask);
        } catch (error: any) {
            console.error(`[TaskService] SAVE FAILED for Task ${task.taskNo}`);
            console.error(`[TaskService] Error Detail:`, error.message);

            // Check for record already in CompletedTask (Idempotency)
            if (error.code === 'P2002') {
                const alreadyCompleted = await this.prisma.completedTask.findUnique({
                    where: { taskNo: task.taskNo },
                });
                if (alreadyCompleted) {
                    // If it's already there, just clean up Pending if it still exists
                    await this.prisma.pendingTask
                        .deleteMany({ where: { taskNo: task.taskNo } })
                        .catch(() => { });
                    return this.sortTaskDates(alreadyCompleted);
                }
            }
            throw new BadRequestException(
                `Save Failed: ${error.message || 'Database error'}`,
            );
        }
    }

    sortTaskDates(task: any) {
        if (!task) return task;
        const dateFields = ['reviewedTime', 'reminderTime', 'editTime'];
        dateFields.forEach((field) => {
            if (Array.isArray(task[field])) {
                task[field] = task[field]
                    .map((d: any) => (d instanceof Date ? d : new Date(d)))
                    .filter((d: Date) => !isNaN(d.getTime()))
                    .sort((a: Date, b: Date) => a.getTime() - b.getTime());
            }
        });

        // Single date fields
        const singleDateFields = [
            'completeTime',
            'createdTime',
            'deadline',
            'completedAt',
            'updatedAt',
        ];
        singleDateFields.forEach((field) => {
            if (task[field] && !(task[field] instanceof Date)) {
                const d = new Date(task[field]);
                if (!isNaN(d.getTime())) task[field] = d;
            }
        });

        return task;
    }

    async sendReminder(id: string, userId: string) {
        const task = await this.findById(id);
        if (!task) throw new NotFoundException('Task not found');

        // Check permission: Creator only
        if (task.createdBy !== userId) {
            throw new ForbiddenException(
                'Only the task creator can send a reminder.',
            );
        }

        const recipients = new Set<string>();
        if (task.assignedTo) recipients.add(task.assignedTo);
        if (task.targetTeamId) recipients.add(task.targetTeamId);

        if (task.targetGroupId) {
            const members = await this.prisma.groupMember.findMany({
                where: { groupId: task.targetGroupId },
            });
            members.forEach((m) => recipients.add(m.userId));
        }

        recipients.delete(userId);

        if (recipients.size === 0) {
            throw new BadRequestException('No recipients found to send reminder to.');
        }

        for (const recipientId of recipients) {
            await this.notificationService.createNotification(recipientId, {
                title: 'Task Reminder 🔔',
                description: `Reminder for task: "${task.taskTitle}". Please check and update.`,
                type: 'TASK',
                metadata: {
                    taskId: task.id,
                    taskNo: task.taskNo,
                    type: 'REMINDER',
                },
            });

            // If it's a group task, ensure/reset the acceptance popup for members
            if (task.targetGroupId) {
                await (this.prisma as any).taskAcceptance.upsert({
                    where: {
                        taskId_userId: {
                            taskId: task.id,
                            userId: recipientId,
                        },
                    },
                    update: { status: 'PENDING' },
                    create: {
                        taskId: task.id,
                        userId: recipientId,
                        groupId: task.targetGroupId,
                        status: 'PENDING',
                    },
                });
            }
        }

        const model: any =
            task.taskStatus === TaskStatus.Completed
                ? this.prisma.completedTask
                : this.prisma.pendingTask;

        await model.update({
            where: { id },
            data: {
                reminderTime: { push: new Date() },
            },
        });

        return { message: 'Reminder sent successfully' };
    }

    async rejectTask(
        id: string,
        remark: string,
        userId: string,
        files?: Express.Multer.File[],
    ) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: true,
                targetTeam: true,
                worker: true,
            },
        });

        if (!task) throw new NotFoundException('Task not found');
        if ((task.taskStatus as any) !== TaskStatus.ReviewPending)
            throw new BadRequestException('Only tasks in review can be rejected');

        // Check permission: Only creator can reject
        if (task.createdBy !== userId) {
            throw new ForbiddenException('Only the task creator can reject a task.');
        }

        let document = task.document;
        if (files && files.length > 0) {
            const savedUrls: string[] = [];
            for (const file of files) {
                const timestamp = Date.now();
                // Remove # from task number for Cloudinary compatibility
                const sanitizedTaskNo = task.taskNo.replace('#', '');
                const customName = `${sanitizedTaskNo}_${timestamp}_${file.originalname}`;
                const folder = `hrms/tasks/${sanitizedTaskNo}`;
                const result = await this.cloudinaryService.uploadFile(
                    file,
                    folder,
                    customName,
                );
                if (result.secure_url) {
                    savedUrls.push(result.secure_url);
                }
            }
            const existingDocs = task.document ? task.document.split(',') : [];
            document = [...existingDocs, ...savedUrls].join(',');
        }

        const updated = await this.prisma.pendingTask.update({
            where: { id },
            data: {
                taskStatus: TaskStatus.Pending as any,
                remarkChat: remark,
                reviewedTime: { push: new Date() },
                document: document,
            },
            include: { creator: true, project: true, assignee: true, worker: true },
        });

        // Notify Worker and Original Assignee about rejection
        const recipients = new Set<string>();
        if (task.workingBy) recipients.add(task.workingBy);
        if (task.assignedTo) recipients.add(task.assignedTo);
        if (task.targetTeamId) recipients.add(task.targetTeamId);

        for (const recipientId of recipients) {
            if (recipientId && recipientId !== userId) {
                await this.notificationService.createNotification(recipientId, {
                    title: 'Task Rejected',
                    description: `Your work on task "${task.taskTitle}" (${task.taskNo}) has been rejected. Reason: ${remark}`,
                    type: 'TASK',
                    metadata: {
                        taskId: updated.id,
                        taskNo: task.taskNo,
                        status: 'Pending',
                    },
                });
            }
        }

        await this.invalidateCache();
        return this.sortTaskDates(updated);
    }

    async revertToPending(id: string, userId: string) {
        // Find the completed task
        const task = await this.prisma.completedTask.findUnique({
            where: { id },
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: true,
                targetTeam: true,
                worker: true,
            },
        });

        if (!task) throw new NotFoundException('Completed task not found');

        // Check permission: Only creator can revert
        if (task.createdBy !== userId) {
            throw new ForbiddenException(
                'Only the task creator can revert a completed task.',
            );
        }

        try {
            const pendingTask = await this.prisma.$transaction(async (tx) => {
                // Create the pending task with the same data
                const pendingData: any = {
                    id: task.id,
                    taskNo: task.taskNo,
                    taskTitle: task.taskTitle,
                    priority: task.priority,
                    taskStatus: TaskStatus.Pending,
                    additionalNote: task.additionalNote,
                    deadline: task.deadline,
                    reminderTime: task.reminderTime || [],
                    document: task.document,
                    remarkChat: task.remarkChat,
                    createdTime: task.createdTime,
                    editTime: task.editTime || [],
                    projectId: task.projectId || null,
                    assignedTo: task.assignedTo || null,
                    targetGroupId: task.targetGroupId || null,
                    targetTeamId: task.targetTeamId || null,
                    createdBy: task.createdBy || null,
                    workingBy: task.workingBy || null,
                    isSelfTask: (task as any).isSelfTask || false,
                };

                // Create the pending task
                const pending = await tx.pendingTask.create({
                    data: pendingData,
                });

                // Delete from completed table
                await tx.completedTask.delete({
                    where: { id: task.id },
                });

                return pending;
            });

            // Notify Worker and Original Assignee about revert
            const recipients = new Set<string>();
            if (task.workingBy) recipients.add(task.workingBy);
            if (task.assignedTo) recipients.add(task.assignedTo);
            if (task.targetTeamId) recipients.add(task.targetTeamId);

            for (const recipientId of recipients) {
                if (recipientId && recipientId !== userId) {
                    await this.notificationService.createNotification(recipientId, {
                        title: 'Task Reverted to Pending',
                        description: `Task "${task.taskTitle}" (${task.taskNo}) has been moved back to pending.`,
                        type: 'TASK',
                        metadata: {
                            taskId: pendingTask.id,
                            taskNo: task.taskNo,
                            status: 'Pending',
                        },
                    });
                }
            }

            await this.invalidateCache();
            return this.sortTaskDates(pendingTask);
        } catch (error: any) {
            console.error(`[TaskService] REVERT FAILED for Task ${task.taskNo}`);
            console.error(`[TaskService] Error Detail:`, error.message);

            // Check for record already in PendingTask (Idempotency)
            if (error.code === 'P2002') {
                const alreadyPending = await this.prisma.pendingTask.findUnique({
                    where: { taskNo: task.taskNo },
                });
                if (alreadyPending) {
                    // If it's already there, just clean up Completed if it still exists
                    await this.prisma.completedTask
                        .deleteMany({ where: { taskNo: task.taskNo } })
                        .catch(() => { });
                    return this.sortTaskDates(alreadyPending);
                }
            }
            throw new BadRequestException(
                `Revert Failed: ${error.message || 'Database error'}`,
            );
        }
    }

    async delete(id: string, userId: string, role: string) {
        // User requested to remove delete logic completely for tasks
        throw new ForbiddenException('Task deletion is disabled.');
    }

    /**
     * Bulk Upload Logic: Excel -> CSV -> Streaming Read -> Batch Insert
     */
    async bulkUpload(file: Express.Multer.File, userId: string) {
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const tempExcelPath =
            file.path ||
            path.join(uploadDir, `bulk_${Date.now()}.xlsx`);
        const tempCsvPath = path.join(
            uploadDir,
            `bulk_${Date.now()}.csv`,
        );

        try {
            // 1. Save Excel file temporarily
            if (!file.path) {
                fs.writeFileSync(tempExcelPath, file.buffer);
            }

            // 2. Convert Excel to CSV via Streaming
            await this.convertExcelToCsvStreaming(tempExcelPath, tempCsvPath);

            const results: any = await this.processCsvAndInsert(
                tempCsvPath,
                userId,
                file.originalname,
            );

            // 4. Cleanup temp files if they were processed synchronously
            if (!results.isBackground) {
                if (fs.existsSync(tempExcelPath)) fs.unlinkSync(tempExcelPath);
                if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
            }

            return results;
        } catch (error) {
            // Cleanup on error
            if (fs.existsSync(tempExcelPath)) fs.unlinkSync(tempExcelPath);
            if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
            throw error;
        }
    }

    @OnEvent('task.bulk-upload')
    async handleBackgroundUpload(payload: {
        csvPath: string;
        userId: string;
        fileName: string;
        excelPath: string;
        jobId?: string;
    }) {
        const { csvPath, userId, fileName, excelPath, jobId } = payload;
        this.logger.log(
            `[BACKGROUND_UPLOAD] Starting background task upload for ${fileName}`,
        );

        try {
            if (jobId) {
                await this.uploadJobService.markProcessing(jobId);
            }

            const result = await this.processCsvAndInsert(
                csvPath,
                userId,
                fileName,
                true,
            );

            await this.notificationService.createNotification(userId, {
                title: 'Task Upload Completed',
                description: `Successfully imported ${result.successCount} tasks from ${fileName}. Failed: ${result.failCount}`,
                type: 'SYSTEM',
                metadata: {
                    fileName,
                    success: result.successCount,
                    failed: result.failCount,
                },
            });

            if (jobId) {
                await this.uploadJobService.markCompleted(jobId, {
                    success: result.successCount || 0,
                    failed: result.failCount || 0,
                    message: `Successfully imported ${result.successCount} tasks.`,
                });
            }

            this.logger.log(
                `[BACKGROUND_UPLOAD_COMPLETED] Success: ${result.successCount}, Failed: ${result.failCount}`,
            );
        } catch (error) {
            this.logger.error(`[BACKGROUND_UPLOAD_FAILED] Error: ${error.message}`);
            await this.notificationService.createNotification(userId, {
                title: 'Task Upload Failed',
                description: `Background task upload for ${fileName} failed: ${error.message}`,
                type: 'SYSTEM',
                metadata: { fileName, error: error.message },
            });

            if (jobId) {
                await this.uploadJobService.markFailed(jobId, error.message);
            }
        } finally {
            if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
            if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
        }
    }

    private async convertExcelToCsvStreaming(excelPath: string, csvPath: string) {
        const workbook = new ExcelJS.stream.xlsx.WorkbookReader(excelPath, {});
        const writeStream = fs.createWriteStream(csvPath);

        for await (const worksheet of workbook) {
            for await (const row of worksheet) {
                if (Array.isArray(row.values)) {
                    // Skip internal exceljs indexing by using values.slice(1)
                    const rowData = row.values
                        .slice(1)
                        .map((v) => (v === null || v === undefined ? '' : String(v)));
                    writeStream.write(rowData.join(',') + '\n');
                }
            }
        }
        writeStream.end();
        return new Promise<boolean>((resolve) =>
            writeStream.on('finish', () => resolve(true)),
        );
    }

    private async processCsvAndInsert(
        csvPath: string,
        userId: string,
        fileName: string,
        isFromBackground = false,
        jobId?: string,
    ) {
        // First pass: Count records to decide on background processing
        if (!isFromBackground) {
            let recordCount = 0;
            const counterParser = fs.createReadStream(csvPath).pipe(csvParser());
            for await (const _ of counterParser) {
                recordCount++;
            }

            if (recordCount > 500) {
                // Determine paths to keep
                const excelPath = csvPath.replace('.csv', '.xlsx');
                // We don't cleanup here, handleBackgroundUpload will do it.
                let job = jobId;
                if (!job) {
                    const created = await this.uploadJobService.createJob({
                        module: 'task',
                        fileName,
                        userId,
                    });
                    job = created.jobId;
                }

                this.eventEmitter.emit('task.bulk-upload', {
                    csvPath,
                    userId,
                    fileName,
                    excelPath,
                    jobId: job,
                });

                return {
                    message: `Large file (${recordCount} records) is being processed in the background. You will be notified once completed.`,
                    isBackground: true,
                    totalRecords: recordCount,
                    jobId: job,
                };
            }
        }

        const parser = fs
            .createReadStream(csvPath)
            .pipe(csvParser({ skipLines: 0 }));

        let batch: any[] = [];
        const BATCH_SIZE = 1000;
        let successCount = 0;
        let failCount = 0;
        const errors: any[] = [];
        let rowIndex = 1;

        for await (const record of parser) {
            rowIndex++;
            try {
                const validated = await this.validateBulkRow(record);
                if (validated) {
                    const taskNo = await this.autoNumberService.generateTaskNo();
                    batch.push({
                        ...validated,
                        taskNo,
                        createdBy: userId,
                        taskStatus: TaskStatus.Pending,
                        createdTime: new Date(),
                        editTime: [new Date()],
                    });
                }

                if (batch.length >= BATCH_SIZE) {
                    await this.prisma.pendingTask.createMany({ data: batch });
                    successCount += batch.length;
                    batch = [];
                }
            } catch (err) {
                failCount++;
                errors.push({ row: rowIndex, error: err.message });
            }
        }

        if (batch.length > 0) {
            await this.prisma.pendingTask.createMany({ data: batch });
            successCount += batch.length;
        }

        return {
            message: 'Bulk upload completed',
            successCount,
            failCount,
            errors: errors.slice(0, 100),
        }; // Limit error log size
    }

    private async validateBulkRow(row: any) {
        if (!row.taskTitle) throw new Error('Task Title is missing');
        if (!row.projectId) throw new Error('Project ID is missing');
        // Add more validation logic here
        return {
            taskTitle: row.taskTitle,
            projectId: row.projectId,
            priority: row.priority || 'Medium',
            additionalNote: row.additionalNote || '',
            deadline: row.deadline ? new Date(row.deadline) : null,
        };
    }

    async downloadExcel(filter: FilterTaskDto, userId: string, res: any) {
        // Optimization: For formatted output with auto-width, we fetch and map
        const baseWhere: any = {
            OR: [
                { assignedTo: userId },
                { targetTeamId: userId },
                { createdBy: userId },
                { workingBy: userId },
            ],
        };

        const [pendingTasks, completedTasks] = await Promise.all([
            this.prisma.pendingTask.findMany({
                where: baseWhere,
                include: {
                    project: { select: { projectName: true } },
                    assignee: { select: { teamName: true } },
                    worker: { select: { teamName: true } },
                },
            }),
            this.prisma.completedTask.findMany({
                where: baseWhere,
                include: {
                    project: { select: { projectName: true } },
                    assignee: { select: { teamName: true } },
                    worker: { select: { teamName: true } },
                    creator: { select: { teamName: true } },
                },
            }),
        ]);

        const allTasks = [...pendingTasks, ...completedTasks];

        const mappedData = allTasks.map((task: any, index) => ({
            srNo: index + 1,
            taskNo: task.taskNo,
            taskTitle: task.taskTitle,
            priority: task.priority,
            taskStatus: task.taskStatus,
            project: task.project?.projectName || '',
            assignee: task.assignee?.teamName || '',
            worker: task.worker?.teamName || '',
            createdBy: task.creator?.teamName || '',
            createdTime: task.createdTime
                ? new Date(task.createdTime).toLocaleString()
                : '',
            deadline: task.deadline ? new Date(task.deadline).toLocaleString() : '',
            editTime:
                Array.isArray(task.editTime) && task.editTime.length > 0
                    ? task.editTime
                        .map((d: any) => new Date(d).toLocaleString())
                        .join(', ')
                    : '',
            reminderTime:
                Array.isArray(task.reminderTime) && task.reminderTime.length > 0
                    ? task.reminderTime
                        .map((d: any) => new Date(d).toLocaleString())
                        .join(', ')
                    : '',
            reviewedTime:
                Array.isArray(task.reviewedTime) && task.reviewedTime.length > 0
                    ? task.reviewedTime
                        .map((d: any) => new Date(d).toLocaleString())
                        .join(', ')
                    : '',
            completeTime: task.completeTime
                ? new Date(task.completeTime).toLocaleString()
                : '',
            remark: task.remarkChat || task.additionalNote || '',
        }));

        const columns = [
            { header: '#', key: 'srNo', width: 10 },
            { header: 'Task No', key: 'taskNo', width: 15 },
            { header: 'Title', key: 'taskTitle', width: 35 },
            { header: 'Priority', key: 'priority', width: 12 },
            { header: 'Status', key: 'taskStatus', width: 15 },
            { header: 'Project', key: 'project', width: 25 },
            { header: 'Assignee', key: 'assignee', width: 25 },
            { header: 'Worker', key: 'worker', width: 25 },
            { header: 'Created By', key: 'createdBy', width: 25 },
            { header: 'Created Time', key: 'createdTime', width: 25 },
            { header: 'Deadline', key: 'deadline', width: 25 },
            { header: 'Edit Time', key: 'editTime', width: 25 },
            { header: 'Reminder Time', key: 'reminderTime', width: 25 },
            { header: 'In Review Time', key: 'reviewedTime', width: 25 },
            { header: 'Completed Time', key: 'completeTime', width: 25 },
            { header: 'Remark', key: 'remark', width: 35 },
        ];

        await this.excelDownloadService.downloadExcel(
            res,
            mappedData,
            columns,
            'tasks_export.xlsx',
            'Tasks',
        );
    }

    private async invalidateCache() {
        try {
            await this.redisService.deleteCachePattern(this.CACHE_KEY + '*');
            this.logger.log('Cache invalidated for tasks');
        } catch (error) {
            this.logger.error('Failed to invalidate cache', error);
        }
    }

    /**
     * Get activity logs for task-related notifications
     */
    async getActivityLogs(
        userId: string,
        activityIndex: number = 1,
        taskNo?: string,
        role?: string,
        mentionedOnly: boolean = false,
    ) {
        const PAGE_SIZE = 20;
        const skip = (activityIndex - 1) * PAGE_SIZE;

        const isAdmin = isAdminRole(role) || role?.toUpperCase() === 'HR';

        this.logger.log(
            `[ActivityLogs] Fetching logs for userId: ${userId}, role: ${role}, index: ${activityIndex}, taskNo: ${taskNo || 'none'}, mentionedOnly: ${mentionedOnly}`,
        );

        const where: Prisma.NotificationWhereInput = {};

        if (mentionedOnly) {
            where.type = 'COMMENT_MENTION';
            if (!isAdmin) {
                where.teamId = userId;
            }
        }

        let taskDetails: any = null;

        if (taskNo) {
            const cleanNo = taskNo.replace(/^#/, '').replace(/^T-/, '').trim();
            const digitOnly = taskNo.replace(/\D/g, '');

            const searchPatterns = [taskNo, cleanNo, `#${cleanNo}`, `T-${cleanNo}`];
            if (digitOnly) searchPatterns.push(digitOnly);

            const findTask = async (model: any) => {
                return await model.findFirst({
                    where: {
                        taskNo: {
                            in: searchPatterns,
                            mode: 'insensitive' as Prisma.QueryMode,
                        },
                    },
                    include: {
                        project: { select: { projectName: true } },
                        assignee: { select: { teamName: true, avatar: true } },
                        creator: { select: { teamName: true, avatar: true } },
                        targetTeam: { select: { teamName: true, avatar: true } },
                        targetGroup: { select: { groupName: true } },
                        worker: { select: { teamName: true, avatar: true } },
                    },
                });
            };

            taskDetails = await findTask(this.prisma.pendingTask);
            if (!taskDetails) taskDetails = await findTask(this.prisma.completedTask);

            // Search globally for any notification mentioning this task
            where.OR = [
                {
                    description: {
                        contains: cleanNo,
                        mode: 'insensitive' as Prisma.QueryMode,
                    },
                },
                {
                    title: { contains: cleanNo, mode: 'insensitive' as Prisma.QueryMode },
                },
                { metadata: { path: ['taskNo'], equals: taskNo } },
                { metadata: { path: ['taskNo'], equals: cleanNo } },
            ];
        } else if (!isAdmin) {
            where.teamId = userId;
        }

        const notifications = await this.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: PAGE_SIZE + 1,
            include: {
                team: { select: { teamName: true, avatar: true } },
            },
        });

        const hasMore = notifications.length > PAGE_SIZE;
        const items = hasMore ? notifications.slice(0, PAGE_SIZE) : notifications;

        const events: any[] = items.map((notification) => {
            const metadata = (notification.metadata as any) || {};
            let eventType = 'UPDATE_TASK';
            let status = metadata.status;

            // Map types based on notification type first (our new activity types)
            switch (notification.type) {
                case 'TASK_CREATED':
                    eventType = 'CREATE_TASK';
                    break;
                case 'TASK_ASSIGNED':
                    eventType = 'ASSIGN_TASK';
                    break;
                case 'TASK_STATUS_CHANGE':
                    eventType = 'UPDATE_TASK';
                    status = metadata.status;
                    break;
                case 'TASK_REMARK':
                    eventType = 'COMMENT';
                    break;
                case 'TASK_FILE_ADDED':
                    eventType = 'ADD_FILES_TO_TASK';
                    break;
                case 'TASK_UPDATED':
                    eventType = 'UPDATE_TASK';
                    break;
                case 'COMMENT_MENTION':
                    eventType = 'COMMENT_MENTION';
                    break;
                default:
                    // Fallback: Map based on description content
                    if (
                        notification.description?.toLowerCase().includes('remark') ||
                        notification.description?.toLowerCase().includes('comment')
                    )
                        eventType = 'COMMENT';
                    else if (notification.description?.toLowerCase().includes('tag'))
                        eventType = 'ADD_TAGS_TO_TASK';
                    else if (
                        notification.description?.toLowerCase().includes('file') ||
                        notification.description?.toLowerCase().includes('document')
                    )
                        eventType = 'ADD_FILES_TO_TASK';
                    else if (notification.description?.toLowerCase().includes('assigned'))
                        eventType = 'ASSIGN_TASK';
                    else if (notification.description?.toLowerCase().includes('created'))
                        eventType = 'CREATE_TASK';
            }

            return {
                type: eventType,
                dateTime: Math.floor(notification.createdAt.getTime() / 1000),
                taskNo: metadata.taskNo || '',
                userName: notification.team?.teamName || 'System',
                userImg: notification.team?.avatar || '',
                comment: notification.description,
                status: status,
                tags: metadata.tags || [],
                files: metadata.files || [],
                assignee: metadata.assigneeName,
            };
        });

        // Add Synthetic Events (only if no real logged events exist for that action)
        if (taskNo && taskDetails && activityIndex === 1) {
            // Creation — only add if no real CREATE_TASK event was already logged
            const hasRealCreateEvent = events.some(e => e.type === 'CREATE_TASK');
            if (!hasRealCreateEvent) {
                events.push({
                    type: 'CREATE_TASK',
                    dateTime: Math.floor(
                        new Date(taskDetails.createdTime).getTime() / 1000,
                    ),
                    taskNo: taskDetails.taskNo,
                    userName: taskDetails.creator?.teamName || 'System',
                    userImg: taskDetails.creator?.avatar || '',
                    comment:
                        taskDetails.remarkChat || `Task created: ${taskDetails.taskTitle}`,
                    files: taskDetails.document ? taskDetails.document.split(',') : [],
                });
            }

            // Completion — only add if no real Completed event was already logged
            // HRMS Rule: Only a Manager/Admin can mark as Completed, so use creator (not worker)
            const hasRealCompletedEvent = events.some(
                e => e.type === 'UPDATE_TASK' && String(e.status) === 'Completed',
            );
            if (
                !hasRealCompletedEvent &&
                (taskDetails.taskStatus === 'Completed' || taskDetails.completeTime)
            ) {
                events.push({
                    type: 'UPDATE_TASK',
                    dateTime: Math.floor(
                        new Date(
                            taskDetails.completeTime || taskDetails.updatedAt,
                        ).getTime() / 1000,
                    ),
                    taskNo: taskDetails.taskNo,
                    // HRMS: Completion is done by Manager/Creator, NOT the worker/employee
                    userName: taskDetails.creator?.teamName || 'System',
                    userImg: taskDetails.creator?.avatar || '',
                    status: 'Completed',
                    comment: `Task finalized and completed.`,
                });
            }
        }

        // Deduplicate: Remove events with same type + status + userName within 60s window
        const deduped: typeof events = [];
        for (const event of events) {
            const isDupe = deduped.some(
                (existing) =>
                    existing.type === event.type &&
                    String(existing.status || '') === String(event.status || '') &&
                    existing.userName === event.userName &&
                    Math.abs(existing.dateTime - event.dateTime) < 60,
            );
            if (!isDupe) deduped.push(event);
        }

        // Group by date
        const groupedByDate = new Map<string, any[]>();
        deduped.forEach((event) => {
            const dateKey = new Date(event.dateTime * 1000)
                .toISOString()
                .split('T')[0];
            if (!groupedByDate.has(dateKey)) groupedByDate.set(dateKey, []);
            groupedByDate.get(dateKey)!.push(event);
        });

        const data = Array.from(groupedByDate.entries())
            .map(([dateKey, entries]) => ({
                id: dateKey,
                date: Math.floor(new Date(dateKey).getTime() / 1000),
                events: entries.sort((a, b) => b.dateTime - a.dateTime),
            }))
            .sort((a, b) => b.date - a.date);

        return { data, loadable: hasMore, taskDetails };
    }
}
