import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { RedisService } from '../redis/redis.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto, TaskViewMode, UpdateTaskAcceptanceDto } from './dto/task.dto';
import { NotificationService } from '../notification/notification.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, TaskStatus, AcceptanceStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
const csvParser = require('csv-parser');
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { pipeline, Readable } from 'stream';

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
    ) { }

    async create(dto: CreateTaskDto, userId: string, files?: Express.Multer.File[]) {
        const taskNo = await this.autoNumberService.generateTaskNo();
        const { toTitleCase } = await import('../common/utils/string-helper');
        const fs = await import('fs');
        const path = await import('path');

        let document = dto.document;
        if (files && files.length > 0) {
            const savedPaths: string[] = [];
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            for (const file of files) {
                const fileName = `${taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                fs.writeFileSync(uploadPath, file.buffer);
                savedPaths.push(`/uploads/${fileName}`);
            }
            document = savedPaths.join(',');
        }

        const task = await this.prisma.pendingTask.create({
            data: {
                ...dto,
                taskStatus: TaskStatus.Pending,
                taskTitle: toTitleCase(dto.taskTitle),
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                taskNo,
                createdBy: userId,
                document,
                reminderTime: dto.reminderTime ? [...new Set(dto.reminderTime)].sort().map(d => new Date(d)) : [],
                editTime: [new Date()],
                assignedTo: dto.assignedTo && dto.assignedTo !== 'null' ? dto.assignedTo : null,
                targetGroupId: dto.targetGroupId && dto.targetGroupId !== 'null' ? dto.targetGroupId : null,
                targetTeamId: dto.targetTeamId && dto.targetTeamId !== 'null' ? dto.targetTeamId : null,
            } as any,
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: {
                    include: {
                        members: true
                    }
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
                where: { groupId: task.targetGroupId }
            });

            console.log(`[TaskService] Found ${members.length} members for Group ${task.targetGroupId}`);

            if (members.length > 0) {
                console.log(`[TaskService] Filtering creator (${userId}) from ${members.length} members`);
                // Filter out the creator so they don't get the acceptance popup
                const membersToNotify = members.filter(m => {
                    const isCreator = m.userId === userId;
                    if (isCreator) console.log(`[TaskService] Successfully filtered out creator: ${userId}`);
                    return !isCreator;
                });

                if (membersToNotify.length > 0) {
                    const acceptanceData = membersToNotify.map(m => ({
                        taskId: task.id,
                        userId: m.userId,
                        groupId: task.targetGroupId,
                        status: 'PENDING'
                    }));

                    await (this.prisma as any).taskAcceptance.createMany({
                        data: acceptanceData,
                        skipDuplicates: true
                    });

                    console.log(`[TaskService] Created ${acceptanceData.length} TaskAcceptance records (excluded creator)`);
                    membersToNotify.forEach(m => recipients.add(m.userId));
                } else {
                    console.log(`[TaskService] No other members to notify besides the creator.`);
                }
            }
        }

        recipients.delete(userId);
        console.log(`[TaskService] Notifying recipients for Task ${task.taskNo}:`, Array.from(recipients));

        for (const recipientId of recipients) {
            let description = `A new task "${task.taskTitle}" has been assigned to you.`

            // If it's a group assignment and the user is NOT the primary individual assignee
            if (task.targetGroupId &&
                recipientId !== task.assignedTo &&
                recipientId !== task.targetTeamId) {
                description = `A new task "${task.taskTitle}" has been assigned to your group.`
            }

            await this.notificationService.createNotification(recipientId, {
                title: 'New Task Assigned',
                description,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            });
        }

        await this.invalidateCache();
        return this.sortTaskDates(task);
    }

    async getPendingAcceptances(userId: string) {
        console.log(`[TaskService] Fetching pending acceptances for userId: ${userId}`);
        const acceptances = await (this.prisma as any).taskAcceptance.findMany({
            where: {
                userId,
                status: 'PENDING'
            },
            include: {
                pendingTask: {
                    include: {
                        project: { select: { projectName: true } },
                        creator: { select: { firstName: true, lastName: true } }
                    }
                },
                group: { select: { groupName: true } }
            }
        });
        console.log(`[TaskService] Found ${acceptances.length} acceptances for userId: ${userId}`);
        return acceptances;
    }

    async updateAcceptanceStatus(id: string, dto: UpdateTaskAcceptanceDto, userId: string) {
        const { status } = dto;
        const acceptance = await (this.prisma as any).taskAcceptance.findUnique({
            where: { id },
            include: { pendingTask: true }
        });

        if (!acceptance || acceptance.userId !== userId) {
            throw new NotFoundException('Task acceptance record not found');
        }

        const updated = await (this.prisma as any).taskAcceptance.update({
            where: { id },
            data: {
                status,
                actionAt: new Date()
            },
            include: {
                pendingTask: true
            }
        });

        if (status === 'ACCEPTED') {
            // RACE CONDITION CHECK: Verify if task is already assigned
            if (acceptance.pendingTask.assignedTo) {
                // If assigned to someone else, throw error
                if (acceptance.pendingTask.assignedTo !== userId) {
                    throw new BadRequestException('This task has already been accepted by another group member.');
                }
            } else {
                // Assign the task to the user
                await (this.prisma as any).pendingTask.update({
                    where: { id: acceptance.taskId },
                    data: {
                        assignedTo: userId,
                        taskStatus: TaskStatus.Pending // Ensure it stays pending but assigned
                    }
                });

                // Optional: Auto-reject other pending acceptances for this task to clean up views
                await (this.prisma as any).taskAcceptance.updateMany({
                    where: {
                        taskId: acceptance.taskId,
                        id: { not: id }
                    },
                    data: { status: 'REJECTED' }
                });
            }

            await this.notificationService.createNotification(updated.pendingTask.createdBy, {
                title: 'Task Accepted',
                description: `A member has accepted the task "${updated.pendingTask.taskTitle}".`,
                type: 'TASK',
                metadata: { taskId: updated.pendingTask.id, taskNo: updated.pendingTask.taskNo },
            });
        }

        await this.invalidateCache();
        return updated;
    }

    async findAll(pagination: PaginationDto, filter: FilterTaskDto, userId?: string, role?: string) {
        const { page = 1, limit = 25 } = pagination;
        const skip = (page - 1) * limit;
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Identify which "database" (table) to query
        const isCompletedView = filter.viewMode === TaskViewMode.MY_COMPLETED ||
            filter.viewMode === TaskViewMode.TEAM_COMPLETED ||
            (Array.isArray(filter.taskStatus)
                ? filter.taskStatus.includes(TaskStatus.Completed)
                : filter.taskStatus === TaskStatus.Completed);
        const model: any = isCompletedView ? this.prisma.completedTask : this.prisma.pendingTask;

        const where: any = {
            AND: []
        };

        // Global Security Rule: User must be involved in the task (unless Admin/HR/Manager)
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'HR' || role === 'MANAGER';
        if (!isAdmin && userId) {
            where.AND.push({
                OR: [
                    { assignedTo: userId },
                    { targetTeamId: userId },
                    { createdBy: userId },
                    { workingBy: userId },
                    {
                        targetGroup: { members: { some: { userId } } },
                        ...(isCompletedView ? {} : {
                            assignedTo: null,
                            taskAcceptances: { none: { userId, status: 'REJECTED' } }
                        })
                    }
                ]
            });
        }
        const andArray = where.AND;

        // Specific View Mode Filters
        if (filter.viewMode && userId) {
            switch (filter.viewMode) {
                case TaskViewMode.MY_PENDING:
                    // Only tasks explicitly assigned to me
                    andArray.push({
                        taskStatus: TaskStatus.Pending,
                        OR: [
                            { assignedTo: userId },
                            { targetTeamId: userId }
                        ]
                    });
                    break;
                case TaskViewMode.TEAM_PENDING:
                    // Tasks I created for others OR unassigned group tasks for my team
                    if (isAdmin) {
                        andArray.push({
                            taskStatus: TaskStatus.Pending,
                            OR: [
                                { createdBy: userId, NOT: { assignedTo: userId } },
                                { assignedTo: { not: userId } },
                                { assignedTo: null }
                            ]
                        });
                    } else {
                        // Regular user sees what they created for others
                        andArray.push({
                            taskStatus: TaskStatus.Pending,
                            createdBy: userId,
                            NOT: { assignedTo: userId }
                        });
                    }
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_ME:
                    // I created it, waiting for me to approve
                    andArray.push({ createdBy: userId, taskStatus: TaskStatus.ReviewPending });
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_TEAM:
                    // I submitted it, waiting for someone else to review
                    if (isAdmin) {
                        // Admin sees everything in review that THEY didn't create
                        andArray.push({
                            taskStatus: TaskStatus.ReviewPending,
                            NOT: { createdBy: userId }
                        });
                    } else {
                        andArray.push({
                            OR: [{ assignedTo: userId }, { targetTeamId: userId }],
                            createdBy: { not: userId },
                            taskStatus: TaskStatus.ReviewPending
                        });
                    }
                    break;
                case TaskViewMode.MY_COMPLETED:
                    // Tasks I personally finished
                    andArray.push({ workingBy: userId });
                    break;
                case TaskViewMode.TEAM_COMPLETED:
                    if (isAdmin) {
                        // Admin: Show EVERYTHING completed in the system
                    } else {
                        // Regular user: What I created that others finished
                        andArray.push({
                            createdBy: userId,
                            NOT: { workingBy: userId }
                        });
                    }
                    break;
            }
        }

        console.log(`[TaskService] ===== FIND ALL DEBUG =====`);
        console.log(`[TaskService] User: ${userId}, Role: ${role}, ViewMode: ${filter.viewMode}`);
        console.log(`[TaskService] Using Model: ${isCompletedView ? 'CompletedTask' : 'PendingTask'}`);
        console.log(`[TaskService] Filter Conditions:`, JSON.stringify(where, null, 2));

        if (filter.search) {
            const val = filter.search;
            const searchTitle = toTitleCase(val);
            andArray.push({
                OR: [
                    { taskTitle: { contains: val, mode: 'insensitive' } },
                    { taskTitle: { contains: searchTitle, mode: 'insensitive' } },
                    { taskNo: { contains: val, mode: 'insensitive' } },
                    { additionalNote: { contains: val, mode: 'insensitive' } },
                ]
            });
        }

        console.log(`[TaskService] findAll query:`, {
            viewMode: filter.viewMode,
            model: isCompletedView ? 'CompletedTask' : 'PendingTask',
            isAdmin,
            userId,
            where: JSON.stringify(where, null, 2)
        });

        console.log(`[TaskService] Executing query with skip: ${skip}, limit: ${limit}`);

        const [data, total] = await Promise.all([
            model.findMany({
                where,
                skip,
                take: limit,
                orderBy: isCompletedView ? { completedAt: 'desc' } : { createdTime: 'desc' },
                include: {
                    project: { select: { id: true, projectName: true, projectNo: true } },
                    assignee: { select: { id: true, firstName: true, lastName: true, email: true, teamName: true } },
                    creator: { select: { id: true, firstName: true, lastName: true, email: true } },
                    targetTeam: { select: { id: true, teamName: true, email: true } },
                    targetGroup: { select: { id: true, groupName: true } },
                    worker: { select: { id: true, firstName: true, lastName: true, email: true } }
                },
            }),
            model.count({ where }),
        ]);

        console.log(`[TaskService] findAll result count: ${data.length} for ${isCompletedView ? 'Completed' : 'Pending'} view`);

        return {
            data: data.map(task => this.sortTaskDates(task)),
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        };
    }

    async findById(id: string) {
        // Try Pending first, then Completed
        let task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { project: true, assignee: true, creator: true, targetGroup: true, targetTeam: true }
        } as any);

        if (!task) {
            task = (await this.prisma.completedTask.findUnique({
                where: { id },
                include: { project: true, assignee: true, creator: true, targetGroup: true, targetTeam: true }
            } as any)) as any;
        }

        if (!task) throw new NotFoundException(`Task with ID ${id} not found`);
        return this.sortTaskDates(task);
    }

    async update(id: string, dto: UpdateTaskDto, userId: string, role: string, files?: Express.Multer.File[]) {
        const existingTask = await this.findById(id);

        // Permission Check: Only Admin/SuperAdmin can update tasks
        // (Per user request: "admin ne hr ko task assign kia toh sirf admin edit kar skta hai")
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
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
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const taskNo = (existingTask as any).taskNo;
            for (const file of files) {
                const fileName = `${taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                fs.writeFileSync(uploadPath, file.buffer);
                savedPaths.push(`/uploads/${fileName}`);
            }

            // Merge existing paths from dto.document with new ones
            const existingPaths = dto.document ? dto.document.split(',').filter(Boolean) : [];
            document = [...existingPaths, ...savedPaths].join(',');
        }

        const currentEditTime = (existingTask as any).editTime || [];
        const newEditTime = [...currentEditTime, new Date()];

        const reminderTime = dto.reminderTime
            ? [...new Set([...((existingTask as any).reminderTime || []), ...dto.reminderTime])].sort().map(d => new Date(d))
            : undefined;

        const reviewedTime = dto.reviewedTime
            ? [...new Set([...((existingTask as any).reviewedTime || []), ...dto.reviewedTime])].sort().map(d => new Date(d))
            : undefined;

        const model: any = (existingTask as any).taskStatus === TaskStatus.Completed ? this.prisma.completedTask : this.prisma.pendingTask;

        const updated = await model.update({
            where: { id },
            data: {
                ...dto,
                taskTitle: dto.taskTitle ? toTitleCase(dto.taskTitle) : undefined,
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                remarkChat: dto.remarkChat ? toTitleCase(dto.remarkChat) : undefined,
                editTime: newEditTime,
                reminderTime: reminderTime,
                reviewedTime: reviewedTime,
                document: document,
                // Handle Reassignment: If one is set, others must be null
                assignedTo: dto.assignedTo !== undefined ? dto.assignedTo : undefined,
                targetGroupId: dto.targetGroupId !== undefined ? dto.targetGroupId : undefined,
                targetTeamId: dto.targetTeamId !== undefined ? dto.targetTeamId : undefined,
            },
            include: { assignee: true, creator: true, targetTeam: true }
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
        }

        await this.invalidateCache();
        return this.sortTaskDates(updated);
    }

    async submitForReview(id: string, remark: string, userId: string, files?: Express.Multer.File[]) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { creator: true }
        });

        if (!task) throw new NotFoundException('Task not found');

        // Idempotency check: If already ReviewPending, treat as success
        if (task.taskStatus === TaskStatus.ReviewPending) {
            return this.sortTaskDates(task);
        }

        if (task.taskStatus !== TaskStatus.Pending) throw new BadRequestException('Only pending tasks can be submitted for review');

        let document = task.document;
        if (files && files.length > 0) {
            const fs = await import('fs');
            const path = await import('path');
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const savedPaths: string[] = [];
            for (const file of files) {
                const fileName = `${task.taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                fs.writeFileSync(uploadPath, file.buffer);
                savedPaths.push(`/uploads/${fileName}`);
            }
            const existingDocs = task.document ? task.document.split(',') : [];
            document = [...existingDocs, ...savedPaths].join(',');
        }

        const updated = await this.prisma.pendingTask.update({
            where: { id },
            data: {
                taskStatus: TaskStatus.ReviewPending,
                remarkChat: remark,
                workingBy: userId,
                reviewedTime: { push: new Date() },
                document: document
            },
            include: { creator: true, project: true }
        });

        // Notify Creator
        if (updated.createdBy) {
            await this.notificationService.createNotification(updated.createdBy, {
                title: 'Task Submitted for Review',
                description: `Task "${updated.taskTitle}" (${updated.taskNo}) has been submitted for review.`,
                type: 'TASK',
                metadata: { taskId: updated.id, taskNo: updated.taskNo, status: 'ReviewPending' },
            });
        }

        await this.invalidateCache();
        return this.sortTaskDates(updated);
    }

    async finalizeCompletion(id: string, remark: string, userId: string, files?: Express.Multer.File[]) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { project: true, assignee: true, creator: true, targetGroup: true, targetTeam: true, worker: true }
        });

        if (!task) throw new NotFoundException('Task not found');
        if (task.taskStatus !== TaskStatus.ReviewPending) throw new BadRequestException('Only tasks in review can be finalized');

        let document = task.document;
        if (files && files.length > 0) {
            const fs = await import('fs');
            const path = await import('path');
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const savedPaths: string[] = [];
            for (const file of files) {
                const fileName = `${task.taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                fs.writeFileSync(uploadPath, file.buffer);
                savedPaths.push(`/uploads/${fileName}`);
            }
            const existingDocs = task.document ? task.document.split(',') : [];
            document = [...existingDocs, ...savedPaths].join(',');
        }

        try {
            console.log(`[TaskService] Starting completion process for ${task.taskNo}...`);

            const completedTask = await this.prisma.$transaction(async (tx) => {
                const completedData: any = {
                    id: task.id,
                    taskNo: task.taskNo,
                    taskTitle: task.taskTitle,
                    priority: task.priority,
                    taskStatus: TaskStatus.Completed,
                    additionalNote: task.additionalNote,
                    deadline: task.deadline,
                    completeTime: new Date(),
                    completedAt: new Date(),
                    reviewedTime: Array.isArray(task.reviewedTime) ? [...task.reviewedTime, new Date()] : [new Date()],
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
                };

                // Create the completed task
                const completed = await tx.completedTask.create({
                    data: completedData
                });

                // Delete from pending table (Cascade handles children like TaskAcceptance)
                await tx.pendingTask.delete({
                    where: { id: task.id }
                });

                return completed;
            });

            console.log(`[TaskService] SAVE SUCCESS: Task ${task.taskNo} moved to CompletedTask table.`);
            await this.invalidateCache();
            return this.sortTaskDates(completedTask);

        } catch (error: any) {
            console.error(`[TaskService] SAVE FAILED for Task ${task.taskNo}`);
            console.error(`[TaskService] Error Detail:`, error.message);

            // Check for record already in CompletedTask (Idempotency)
            if (error.code === 'P2002') {
                const alreadyCompleted = await this.prisma.completedTask.findUnique({
                    where: { taskNo: task.taskNo }
                });
                if (alreadyCompleted) {
                    // If it's already there, just clean up Pending if it still exists
                    await this.prisma.pendingTask.deleteMany({ where: { taskNo: task.taskNo } }).catch(() => { });
                    return this.sortTaskDates(alreadyCompleted);
                }
            }
            throw new BadRequestException(`Save Failed: ${error.message || 'Database error'}`);
        }
    }

    sortTaskDates(task: any) {
        if (!task) return task;
        const dateFields = ['reviewedTime', 'reminderTime', 'editTime'];
        dateFields.forEach(field => {
            if (Array.isArray(task[field])) {
                task[field] = task[field]
                    .map((d: any) => (d instanceof Date ? d : new Date(d)))
                    .filter((d: Date) => !isNaN(d.getTime()))
                    .sort((a: Date, b: Date) => a.getTime() - b.getTime());
            }
        });

        // Single date fields
        const singleDateFields = ['completeTime', 'createdTime', 'deadline', 'completedAt', 'updatedAt'];
        singleDateFields.forEach(field => {
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
        if ((task as any).createdBy !== userId) {
            throw new ForbiddenException('Only the task creator can send a reminder.');
        }

        const recipients = new Set<string>();
        if ((task as any).assignedTo) recipients.add((task as any).assignedTo);
        if ((task as any).targetTeamId) recipients.add((task as any).targetTeamId);

        if ((task as any).targetGroupId) {
            const members = await this.prisma.groupMember.findMany({
                where: { groupId: (task as any).targetGroupId }
            });
            members.forEach(m => recipients.add(m.userId));
        }

        recipients.delete(userId);

        if (recipients.size === 0) {
            throw new BadRequestException('No recipients found to send reminder to.');
        }

        for (const recipientId of recipients) {
            await this.notificationService.createNotification(recipientId, {
                title: 'Task Reminder 🔔',
                description: `Reminder for task: "${(task as any).taskTitle}". Please check and update.`,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: (task as any).taskNo, type: 'REMINDER' },
            });

            // If it's a group task, ensure/reset the acceptance popup for members
            if ((task as any).targetGroupId) {
                await (this.prisma as any).taskAcceptance.upsert({
                    where: {
                        taskId_userId: {
                            taskId: task.id,
                            userId: recipientId
                        }
                    },
                    update: { status: 'PENDING' },
                    create: {
                        taskId: task.id,
                        userId: recipientId,
                        groupId: (task as any).targetGroupId,
                        status: 'PENDING'
                    }
                });
            }
        }

        const model: any = (task as any).taskStatus === TaskStatus.Completed ? this.prisma.completedTask : this.prisma.pendingTask;

        await model.update({
            where: { id },
            data: {
                reminderTime: { push: new Date() }
            }
        });

        return { message: 'Reminder sent successfully' };
    }

    async rejectTask(id: string, remark: string, userId: string, files?: Express.Multer.File[]) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { project: true, assignee: true, creator: true, targetGroup: true, targetTeam: true, worker: true }
        });

        if (!task) throw new NotFoundException('Task not found');
        if (task.taskStatus !== TaskStatus.ReviewPending) throw new BadRequestException('Only tasks in review can be rejected');

        // Check permission: Only creator can reject
        if (task.createdBy !== userId) {
            throw new ForbiddenException('Only the task creator can reject a task.');
        }

        let document = task.document;
        if (files && files.length > 0) {
            const fs = await import('fs');
            const path = await import('path');
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const savedPaths: string[] = [];
            for (const file of files) {
                const fileName = `${task.taskNo}_${Date.now()}_${file.originalname}`;
                const uploadPath = path.join(uploadDir, fileName);
                fs.writeFileSync(uploadPath, file.buffer);
                savedPaths.push(`/uploads/${fileName}`);
            }
            const existingDocs = task.document ? task.document.split(',') : [];
            document = [...existingDocs, ...savedPaths].join(',');
        }

        const updated = await this.prisma.pendingTask.update({
            where: { id },
            data: {
                taskStatus: TaskStatus.Pending,
                remarkChat: remark,
                reviewedTime: { push: new Date() },
                document: document
            },
            include: { creator: true, project: true, assignee: true, worker: true }
        });

        // Notify Worker/Assignee about rejection
        const workerId = task.workingBy || task.assignedTo || task.targetTeamId;
        if (workerId && workerId !== userId) {
            await this.notificationService.createNotification(workerId, {
                title: 'Task Rejected',
                description: `Your work on task "${task.taskTitle}" has been rejected. Reason: ${remark}`,
                type: 'TASK',
                metadata: { taskId: updated.id, taskNo: task.taskNo, status: 'Pending' },
            });
        }

        await this.invalidateCache();
        return this.sortTaskDates(updated);
    }

    async delete(id: string, userId: string, role: string) {
        // User requested to remove delete logic completely for tasks
        throw new ForbiddenException('Task deletion is disabled.');

        /* 
        const existing = await this.findById(id);

        // Security Check: Only ADMIN/SUPER_ADMIN or the Creator can delete
        const isOwner = (existing as any).createdBy === userId;
        const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

        if (!isOwner && !isAdmin) {
            throw new ForbiddenException('You do not have permission to delete this task. Only the creator or an admin can delete tasks.');
        }

        const model: any = (existing as any).taskStatus === TaskStatus.Completed ? this.prisma.completedTask : this.prisma.pendingTask;
        const deleted = await model.delete({ where: { id } });
        await this.invalidateCache();
        return deleted;
        */
    }


    /**
     * Bulk Upload Logic: Excel -> CSV -> Streaming Read -> Batch Insert
     */
    async bulkUpload(file: Express.Multer.File, userId: string) {
        const tempExcelPath = path.join(process.cwd(), 'uploads', `bulk_${Date.now()}.xlsx`);
        const tempCsvPath = path.join(process.cwd(), 'uploads', `bulk_${Date.now()}.csv`);

        try {
            // 1. Save Excel file temporarily
            fs.writeFileSync(tempExcelPath, file.buffer);

            // 2. Convert Excel to CSV via Streaming
            await this.convertExcelToCsvStreaming(tempExcelPath, tempCsvPath);

            // 3. Process CSV in chunks
            const results = await this.processCsvAndInsert(tempCsvPath, userId);

            return {
                message: 'Bulk upload completed',
                ...results
            };
        } finally {
            // 4. Cleanup temp files
            if (fs.existsSync(tempExcelPath)) fs.unlinkSync(tempExcelPath);
            if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
        }
    }

    private async convertExcelToCsvStreaming(excelPath: string, csvPath: string) {
        const workbook = new ExcelJS.stream.xlsx.WorkbookReader(excelPath, {});
        const writeStream = fs.createWriteStream(csvPath);

        for await (const worksheet of workbook) {
            for await (const row of worksheet) {
                if (Array.isArray(row.values)) {
                    // Skip internal exceljs indexing by using values.slice(1)
                    const rowData = row.values.slice(1).map(v => v === null || v === undefined ? '' : String(v));
                    writeStream.write(rowData.join(',') + '\n');
                }
            }
        }
        writeStream.end();
        return new Promise<boolean>((resolve) => writeStream.on('finish', () => resolve(true)));
    }

    private async processCsvAndInsert(csvPath: string, userId: string) {
        const parser = fs.createReadStream(csvPath).pipe(csvParser({ skipLines: 0 }));

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

        return { successCount, failCount, errors: errors.slice(0, 100) }; // Limit error log size
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
        // ... existing downloadExcel implementation ...
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: res,
            useStyles: true,
            useSharedStrings: true
        });

        const sheet = workbook.addWorksheet('Tasks');

        sheet.columns = [
            { header: 'Task No', key: 'taskNo', width: 15 },
            { header: 'Title', key: 'taskTitle', width: 30 },
            { header: 'Priority', key: 'priority', width: 10 },
            { header: 'Status', key: 'taskStatus', width: 15 },
            { header: 'Created Time', key: 'createdTime', width: 25 },
            { header: 'Deadline', key: 'deadline', width: 20 },
        ];

        let cursor: string | undefined = undefined;
        const BATCH_SIZE = 5000;

        // Optimization: Large scale dataset streaming for Pending and Completed tasks
        // This is a simplified version of the filter logic for streaming
        const baseWhere: any = {
            OR: [
                { assignedTo: userId },
                { targetTeamId: userId },
                { createdBy: userId },
                { workingBy: userId },
            ]
        };

        const processTable = async (model: any) => {
            let hasMore = true;
            let lastId: string | undefined = undefined;

            while (hasMore) {
                const data = await model.findMany({
                    where: baseWhere,
                    take: BATCH_SIZE,
                    skip: lastId ? 1 : 0,
                    cursor: lastId ? { id: lastId } : undefined,
                    orderBy: { id: 'asc' }
                });

                if (data.length === 0) {
                    hasMore = false;
                    continue;
                }

                for (const task of data) {
                    sheet.addRow({
                        taskNo: task.taskNo,
                        taskTitle: task.taskTitle,
                        priority: task.priority,
                        taskStatus: task.taskStatus,
                        createdTime: task.createdTime,
                        deadline: task.deadline,
                    }).commit();
                }

                lastId = data[data.length - 1].id;
                if (data.length < BATCH_SIZE) hasMore = false;
            }
        };

        // Stream from both tables
        await processTable(this.prisma.pendingTask);
        await processTable(this.prisma.completedTask);

        await workbook.commit();
    }

    private async invalidateCache() {
        try {
            await this.redisService.deleteCachePattern(this.CACHE_KEY + '*');
            this.logger.log('Cache invalidated for tasks');
        } catch (error) {
            this.logger.error('Failed to invalidate cache', error);
        }
    }
}
