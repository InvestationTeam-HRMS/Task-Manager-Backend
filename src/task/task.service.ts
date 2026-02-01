import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { CloudinaryService } from '../common/services/cloudinary.service';
import { RedisService } from '../redis/redis.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto, TaskViewMode, UpdateTaskAcceptanceDto } from './dto/task.dto';
import { NotificationService } from '../notification/notification.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, TaskStatus, AcceptanceStatus } from '@prisma/client';
import { toTitleCase } from '../common/utils/string-helper';
import { ExcelDownloadService } from '../common/services/excel-download.service';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { pipeline, Readable } from 'stream';

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
    ) { }

    async create(dto: CreateTaskDto, userId: string, files?: Express.Multer.File[]) {
        const taskNo = await this.autoNumberService.generateTaskNo();

        let document = dto.document;
        if (files && files.length > 0) {
            const savedUrls: string[] = [];
            // Sanitize taskNo for Cloudinary (remove # and other special characters)
            const sanitizedTaskNo = taskNo.replace(/[^a-zA-Z0-9_-]/g, '');

            for (const file of files) {
                if (!file.size || file.size === 0 || !file.buffer || file.buffer.length === 0) continue;

                try {
                    const timestamp = Date.now();
                    const customName = `${sanitizedTaskNo}_${timestamp}_${file.originalname}`;
                    const folder = `hrms/tasks/${sanitizedTaskNo}`;
                    const result = await this.cloudinaryService.uploadFile(file, folder, customName);
                    if (result.secure_url) {
                        savedUrls.push(result.secure_url);
                    }
                } catch (uploadError) {
                    this.logger.error(`[TaskService] File upload error: ${uploadError.message}`);
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
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                taskNo,
                createdBy: userId,
                document,
                reminderTime: dto.reminderTime ? [...new Set(dto.reminderTime)].sort().map(d => new Date(d)) : [],
                editTime: [],
                isSelfTask: (dto.assignedTo === userId && !dto.targetGroupId && !dto.targetTeamId) || false,
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

            if (members.length > 0) {
                const membersToNotify = members.filter(m => m.userId !== userId);

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

                    membersToNotify.forEach(m => recipients.add(m.userId));
                }
            }
        }

        recipients.delete(userId);

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
        return await (this.prisma as any).taskAcceptance.findMany({
            where: {
                userId,
                status: 'PENDING'
            },
            include: {
                pendingTask: {
                    include: {
                        project: { select: { projectName: true } },
                        creator: { select: { teamName: true, email: true } }
                    }
                },
                group: { select: { groupName: true } }
            }
        });
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

            // ALSO NOTIFY Group Members if it's a group task, so their lists refresh and remove the task
            if (updated.pendingTask.targetGroupId) {
                const members = await this.prisma.groupMember.findMany({
                    where: { groupId: updated.pendingTask.targetGroupId },
                    select: { userId: true }
                });

                for (const member of members) {
                    if (member.userId !== userId) { // Don't notify the one who just accepted
                        await this.notificationService.createNotification(member.userId, {
                            title: 'Task Accepted by Peer',
                            description: `The task "${updated.pendingTask.taskTitle}" has been accepted by someone else in your group.`,
                            type: 'TASK',
                            metadata: { taskId: updated.pendingTask.id, taskNo: updated.pendingTask.taskNo },
                        });
                    }
                }
            }
        }

        await this.invalidateCache();
        return updated;
    }

    async findAll(pagination: PaginationDto, filter: FilterTaskDto, userId?: string, role?: string) {
        const { page = 1, limit = 25 } = pagination;
        const skip = (page - 1) * limit;
        const { toTitleCase } = await import('../common/utils/string-helper');

        const isCompletedView = filter.viewMode === TaskViewMode.MY_COMPLETED ||
            filter.viewMode === TaskViewMode.TEAM_COMPLETED ||
            (Array.isArray(filter.taskStatus)
                ? filter.taskStatus.includes(TaskStatus.Completed)
                : filter.taskStatus === TaskStatus.Completed);

        const model: any = isCompletedView ? this.prisma.completedTask : this.prisma.pendingTask;
        const andArray: any[] = [];
        const isAdmin = role?.toUpperCase() === 'ADMIN' || role?.toUpperCase() === 'HR' || role?.toUpperCase() === 'MANAGER';

        // 1. Priority Filters (Project, Priority, Search)
        if (filter.projectId) andArray.push({ projectId: filter.projectId });
        if (filter.priority) andArray.push({ priority: filter.priority });
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

        // 2. View Mode Logic
        if (filter.viewMode && userId) {
            // Helper for "NOT ME" (Matches where I am NOT the assignee/worker, including NULLs)
            const isNotMeAssigned = {
                AND: [
                    { OR: [{ assignedTo: { not: userId } }, { assignedTo: null }] },
                    { OR: [{ targetTeamId: { not: userId } }, { targetTeamId: null }] }
                ]
            };

            const iAmInvolved = {
                OR: [
                    { createdBy: userId },
                    { targetGroup: { members: { some: { userId } } } },
                    { targetTeamId: userId }
                ]
            };

            switch (filter.viewMode) {
                case TaskViewMode.ALL:
                    // No additional filters needed for Admin to show all.
                    // Involvement check for non-admins is handled in the fallback below.
                    break;

                case TaskViewMode.MY_PENDING:
                    andArray.push({
                        taskStatus: TaskStatus.Pending,
                        OR: [{ assignedTo: userId }, { targetTeamId: userId }]
                    });
                    break;

                case TaskViewMode.TEAM_PENDING:
                    andArray.push({ taskStatus: TaskStatus.Pending, isSelfTask: false });
                    // Must be involved (Creator/Member/Team) AND NOT assigned to me personally
                    andArray.push(isNotMeAssigned);
                    andArray.push(iAmInvolved);
                    break;

                case TaskViewMode.MY_COMPLETED:
                    // Task I personally completed
                    andArray.push({ workingBy: userId });
                    break;

                case TaskViewMode.TEAM_COMPLETED:
                    // Task completed by someone else (including NULL if applicable, but workingBy is usually set)
                    andArray.push({ OR: [{ workingBy: { not: userId } }, { workingBy: null }] });
                    andArray.push({ isSelfTask: false });
                    // Involved but not the worker
                    andArray.push(iAmInvolved);
                    break;

                case TaskViewMode.REVIEW_PENDING_BY_ME:
                    andArray.push({ createdBy: userId, taskStatus: TaskStatus.ReviewPending });
                    break;

                case TaskViewMode.REVIEW_PENDING_BY_TEAM:
                    andArray.push({
                        taskStatus: TaskStatus.ReviewPending,
                        isSelfTask: false,
                        OR: [{ createdBy: { not: userId } }, { createdBy: null }]
                    });
                    // Only see reviews for tasks you are involved in
                    andArray.push(iAmInvolved);
                    break;
            }
        } else {
            // Fallback: Use direct DTO filters (Legacy support)
            if (!isAdmin && userId) {
                andArray.push({
                    OR: [
                        { createdBy: userId },
                        { assignedTo: userId },
                        { workingBy: userId },
                        { targetTeamId: userId },
                        { targetGroup: { members: { some: { userId } } } }
                    ]
                });
            }
            if (filter.assignedTo) andArray.push({ assignedTo: filter.assignedTo });
            if (filter.workingBy) andArray.push({ workingBy: filter.workingBy });
            if (filter.taskStatus) andArray.push({ taskStatus: filter.taskStatus });
        }

        const where = { AND: andArray };

        const [data, total] = await Promise.all([
            model.findMany({
                where,
                skip,
                take: limit,
                orderBy: isCompletedView ? { completedAt: 'desc' } : { createdTime: 'desc' },
                include: {
                    project: { select: { id: true, projectName: true, projectNo: true } },
                    assignee: { select: { id: true, teamName: true, email: true } },
                    creator: { select: { id: true, teamName: true, email: true } },
                    targetTeam: { select: { id: true, teamName: true, email: true } },
                    targetGroup: { select: { id: true, groupName: true } },
                    worker: { select: { id: true, teamName: true, email: true } }
                },
            }),
            model.count({ where }),
        ]);

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
        const isAdmin = role?.toUpperCase() === 'ADMIN';
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
            const savedUrls: string[] = [];
            for (const file of files) {
                const timestamp = Date.now();
                const customName = `${task.taskNo}_${timestamp}_${file.originalname}`;
                const folder = `hrms/tasks/${task.taskNo}`;
                const result = await this.cloudinaryService.uploadFile(file, folder, customName);
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
            const savedUrls: string[] = [];
            for (const file of files) {
                const timestamp = Date.now();
                const customName = `${task.taskNo}_${timestamp}_${file.originalname}`;
                const folder = `hrms/tasks/${task.taskNo}`;
                const result = await this.cloudinaryService.uploadFile(file, folder, customName);
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
                    isSelfTask: (task as any).isSelfTask || false,
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

            // Notify Worker/Assignee about completion
            const workerId = task.workingBy || task.assignedTo || task.targetTeamId;
            if (workerId && workerId !== userId) {
                await this.notificationService.createNotification(workerId, {
                    title: 'Task Completed',
                    description: `Your task "${task.taskTitle}" (${task.taskNo}) has been successfully finalized.`,
                    type: 'TASK',
                    metadata: { taskId: completedTask.id, taskNo: task.taskNo, status: 'Completed' },
                });
            }

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
            const savedUrls: string[] = [];
            for (const file of files) {
                const timestamp = Date.now();
                const customName = `${task.taskNo}_${timestamp}_${file.originalname}`;
                const folder = `hrms/tasks/${task.taskNo}`;
                const result = await this.cloudinaryService.uploadFile(file, folder, customName);
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

        // Security Check: Only ADMIN or the Creator can delete
        const isOwner = (existing as any).createdBy === userId;
        const isAdmin = role === 'ADMIN' || role === 'ADMIN';

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
        // Optimization: For formatted output with auto-width, we fetch and map
        const baseWhere: any = {
            OR: [
                { assignedTo: userId },
                { targetTeamId: userId },
                { createdBy: userId },
                { workingBy: userId },
            ]
        };

        const [pendingTasks, completedTasks] = await Promise.all([
            this.prisma.pendingTask.findMany({
                where: baseWhere,
                include: {
                    project: { select: { projectName: true } },
                    assignee: { select: { teamName: true } },
                    worker: { select: { teamName: true } },
                }
            }),
            this.prisma.completedTask.findMany({
                where: baseWhere,
                include: {
                    project: { select: { projectName: true } },
                    assignee: { select: { teamName: true } },
                    worker: { select: { teamName: true } },
                }
            })
        ]);

        const allTasks = [...pendingTasks, ...completedTasks];

        const mappedData = allTasks.map((task, index) => ({
            srNo: index + 1,
            taskNo: task.taskNo,
            taskTitle: task.taskTitle,
            priority: task.priority,
            taskStatus: task.taskStatus,
            project: task.project?.projectName || 'N/A',
            assignee: task.assignee?.teamName || 'N/A',
            worker: task.worker?.teamName || 'N/A',
            createdTime: task.createdTime ? new Date(task.createdTime).toLocaleString() : 'N/A',
            deadline: task.deadline ? new Date(task.deadline).toLocaleString() : 'N/A',
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
            { header: 'Created Time', key: 'createdTime', width: 25 },
            { header: 'Deadline', key: 'deadline', width: 25 },
        ];

        await this.excelDownloadService.downloadExcel(res, mappedData, columns, 'tasks_export.xlsx', 'Tasks');
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
    async getActivityLogs(userId: string, activityIndex: number = 1, taskNo?: string, role?: string) {
        const PAGE_SIZE = 20;
        const skip = (activityIndex - 1) * PAGE_SIZE;

        const isAdmin = role === 'ADMIN' || role === 'HR';

        this.logger.log(`[ActivityLogs] Fetching logs for userId: ${userId}, role: ${role}, index: ${activityIndex}, taskNo: ${taskNo || 'none'}`);

        const where: Prisma.NotificationWhereInput = {};

        if (taskNo) {
            const cleanNo = taskNo.replace(/^#/, '').replace(/^T-/, '');
            // Search globally for any notification mentionining this taskNo
            where.OR = [
                { description: { contains: cleanNo, mode: 'insensitive' } },
                { title: { contains: cleanNo, mode: 'insensitive' } },
                { description: { contains: taskNo, mode: 'insensitive' } },
                { title: { contains: taskNo, mode: 'insensitive' } },
                { metadata: { path: ['taskNo'], equals: taskNo } },
                { metadata: { path: ['taskNo'], equals: cleanNo } },
                { metadata: { path: ['taskNo'], equals: `T-${cleanNo}` } },
            ];
        } else if (!isAdmin) {
            // For regular users (non-admin/non-hr), only show their own notifications
            where.teamId = userId;
        }
        // For Admins/HR, 'where' stays empty if no taskNo, showing ALL notifications globally.

        const notifications = await this.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: PAGE_SIZE + 1, // Fetch one extra to check if there are more
            include: {
                team: {
                    select: { teamName: true, avatar: true }
                }
            }
        });

        this.logger.log(`[ActivityLogs] Found ${notifications.length} notifications`);

        const hasMore = notifications.length > PAGE_SIZE;
        const items = hasMore ? notifications.slice(0, PAGE_SIZE) : notifications;

        // Group by date
        const groupedByDate = new Map<string, any[]>();

        items.forEach(notification => {
            const dateKey = notification.createdAt.toISOString().split('T')[0];

            if (!groupedByDate.has(dateKey)) {
                groupedByDate.set(dateKey, []);
            }

            // Map notification type to activity event type
            let eventType = 'UPDATE_TASK';
            if (notification.type === 'TASK_ASSIGNED') eventType = 'ASSIGN_TASK';
            else if (notification.type === 'TASK') eventType = 'UPDATE_TASK';

            const metadata = notification.metadata as any || {};

            groupedByDate.get(dateKey)!.push({
                type: eventType,
                dateTime: Math.floor(notification.createdAt.getTime() / 1000),
                taskNo: metadata.taskNo || '',
                status: metadata.status || 'Pending',
                userName: notification.team?.teamName || 'System',
                userImg: (notification.team as any)?.avatar || '',
                comment: notification.description,
                notificationType: notification.type,
                title: notification.title,
            });
        });

        // Convert to array format expected by frontend
        const data = Array.from(groupedByDate.entries()).map(([dateKey, events]) => ({
            id: dateKey,
            date: Math.floor(new Date(dateKey).getTime() / 1000),
            events: events.sort((a, b) => b.dateTime - a.dateTime), // Sort by time descending within day
        }));

        this.logger.log(`[ActivityLogs] Returning ${data.length} date groups`);

        return {
            data,
            loadable: hasMore,
        };
    }
}
