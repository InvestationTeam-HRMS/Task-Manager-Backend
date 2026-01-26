import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { RedisService } from '../redis/redis.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto, TaskViewMode } from './dto/task.dto';
import { NotificationService } from '../notification/notification.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, TaskStatus } from '@prisma/client';
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
            const file = files[0];
            // Rule: <TaskNumber>_<OriginalFileName>
            const fileName = `${taskNo}_${file.originalname}`;
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const uploadPath = path.join(uploadDir, fileName);
            fs.writeFileSync(uploadPath, file.buffer);
            document = `/uploads/${fileName}`;
        }

        const task = await this.prisma.pendingTask.create({
            data: {
                ...dto,
                taskStatus: TaskStatus.Pending, // Automated Status Derivation
                taskTitle: toTitleCase(dto.taskTitle),
                additionalNote: dto.additionalNote ? toTitleCase(dto.additionalNote) : undefined,
                taskNo,
                createdBy: userId,
                document,
                reminderTime: dto.reminderTime ? [...new Set(dto.reminderTime)].sort().map(d => new Date(d)) : [],
                editTime: [new Date()], // Initialize edit history
                // Sanitize UUIDs to handle strings from FormData
                assignedTo: dto.assignedTo && dto.assignedTo !== 'null' ? dto.assignedTo : null,
                targetGroupId: dto.targetGroupId && dto.targetGroupId !== 'null' ? dto.targetGroupId : null,
                targetTeamId: dto.targetTeamId && dto.targetTeamId !== 'null' ? dto.targetTeamId : null,
            } as any,
            include: {
                project: true,
                assignee: true,
                creator: true,
                targetGroup: true,
                targetTeam: true,
            },
        });

        // Send notifications to Assignee or Target Team
        const recipients = new Set<string>();

        // If assigned to individual user
        if (task.assignedTo) {
            recipients.add(task.assignedTo);
        }

        // If assigned to target team (which is actually a single user/team entity)
        if (task.targetTeamId) {
            recipients.add(task.targetTeamId);
        }

        // Don't notify the creator
        recipients.delete(userId);

        for (const recipientId of recipients) {
            await this.notificationService.createNotification(recipientId, {
                title: 'New Task Assigned',
                description: `A new task "${task.taskTitle}" has been assigned to you.`,
                type: 'TASK',
                metadata: { taskId: task.id, taskNo: task.taskNo },
            });
        }

        await this.invalidateCache();
        return this.sortTaskDates(task);
    }

    async findAll(pagination: PaginationDto, filter: FilterTaskDto, userId?: string, role?: string) {
        const { page = 1, limit = 25 } = pagination;
        const skip = (page - 1) * limit;
        const { toTitleCase } = await import('../common/utils/string-helper');

        // Identify which "database" (table) to query
        const isCompletedView = filter.viewMode === TaskViewMode.MY_COMPLETED || filter.viewMode === TaskViewMode.TEAM_COMPLETED;
        const model: any = isCompletedView ? this.prisma.completedTask : this.prisma.pendingTask;

        const where: any = {
            AND: [
                // Global Security Rule: User must be involved in the task
                {
                    OR: [
                        { assignedTo: userId },
                        { targetTeamId: userId },
                        { createdBy: userId },
                        { workingBy: userId },
                    ]
                }
            ]
        };
        const andArray = where.AND;

        // Specific View Mode Filters
        if (filter.viewMode && userId) {
            switch (filter.viewMode) {
                case TaskViewMode.MY_PENDING:
                    andArray.push({
                        OR: [{ assignedTo: userId }, { targetTeamId: userId }],
                        taskStatus: TaskStatus.Pending
                    });
                    break;
                case TaskViewMode.TEAM_PENDING:
                    andArray.push({
                        createdBy: userId,
                        taskStatus: TaskStatus.Pending,
                        // Not assigned to me (could be someone else or no one)
                        AND: [
                            { OR: [{ assignedTo: { not: userId } }, { assignedTo: null }] },
                            { OR: [{ targetTeamId: { not: userId } }, { targetTeamId: null }] }
                        ]
                    });
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_ME:
                    // Show tasks waiting for user to review (user is creator)
                    andArray.push({ createdBy: userId, taskStatus: TaskStatus.ReviewPending });
                    break;
                case TaskViewMode.REVIEW_PENDING_BY_TEAM:
                    // Show tasks user submitted for review (user is assignee)
                    andArray.push({
                        OR: [{ assignedTo: userId }, { targetTeamId: userId }],
                        taskStatus: TaskStatus.ReviewPending
                    });
                    break;
                case TaskViewMode.MY_COMPLETED:
                    andArray.push({
                        OR: [{ assignedTo: userId }, { targetTeamId: userId }],
                        taskStatus: TaskStatus.Completed
                    });
                    break;
                case TaskViewMode.TEAM_COMPLETED:
                    andArray.push({
                        createdBy: userId,
                        taskStatus: TaskStatus.Completed,
                        AND: [
                            { OR: [{ assignedTo: { not: userId } }, { assignedTo: null }] },
                            { OR: [{ targetTeamId: { not: userId } }, { targetTeamId: null }] }
                        ]
                    });
                    break;
            }
        }

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

        const [data, total] = await Promise.all([
            model.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdTime: 'desc' },
                include: {
                    project: { select: { id: true, projectName: true, projectNo: true } },
                    assignee: { select: { id: true, firstName: true, lastName: true, email: true, teamName: true } },
                    creator: { select: { id: true, firstName: true, lastName: true, email: true } },
                    targetTeam: { select: { id: true, teamName: true, email: true } },
                    targetGroup: { select: { id: true, groupName: true, groupCode: true } }
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

    async update(id: string, dto: UpdateTaskDto, userId: string, files?: Express.Multer.File[]) {
        const existingTask = await this.findById(id);
        const { toTitleCase } = await import('../common/utils/string-helper');
        const fs = await import('fs');
        const path = await import('path');

        // Handle File Update
        let document = dto.document; // Default to existing/incoming string
        if (files && files.length > 0) {
            const file = files[0];
            const taskNo = (existingTask as any).taskNo;
            const fileName = `${taskNo}_${file.originalname}`;
            const uploadDir = path.join(process.cwd(), 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const uploadPath = path.join(uploadDir, fileName);
            fs.writeFileSync(uploadPath, file.buffer);
            document = `/uploads/${fileName}`;
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

    async submitForReview(id: string, remark: string, userId: string) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { creator: true }
        });

        if (!task) throw new NotFoundException('Task not found');
        if (task.taskStatus !== TaskStatus.Pending) throw new BadRequestException('Only pending tasks can be submitted for review');

        const updated = await this.prisma.pendingTask.update({
            where: { id },
            data: {
                taskStatus: TaskStatus.ReviewPending,
                remarkChat: remark,
                workingBy: userId,
                reviewedTime: { push: new Date() }
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

    async finalizeCompletion(id: string, remark: string, userId: string) {
        const task = await this.prisma.pendingTask.findUnique({
            where: { id },
            include: { project: true, assignee: true, creator: true, targetGroup: true, targetTeam: true, worker: true }
        });

        if (!task) throw new NotFoundException('Task not found');
        if (task.taskStatus !== TaskStatus.ReviewPending) throw new BadRequestException('Only tasks in review can be finalized');

        // Security: Usually only creator/admin can finalize. 
        // For now, we allow the caller (who should be guarded by controller)

        const completedTask = await this.prisma.$transaction(async (tx) => {
            // 1. Create in CompletedTask
            const completed = await tx.completedTask.create({
                data: {
                    taskNo: task.taskNo,
                    taskTitle: task.taskTitle,
                    priority: task.priority,
                    taskStatus: TaskStatus.Completed,
                    additionalNote: task.additionalNote,
                    deadline: task.deadline,
                    document: task.document,
                    remarkChat: remark || task.remarkChat,
                    createdTime: task.createdTime,
                    completeTime: new Date(),
                    completedAt: new Date(),
                    projectId: task.projectId,
                    assignedTo: task.assignedTo,
                    targetGroupId: task.targetGroupId,
                    targetTeamId: task.targetTeamId,
                    createdBy: task.createdBy,
                    workingBy: task.workingBy,
                    editTime: task.editTime,
                    reviewedTime: [...task.reviewedTime, new Date()],
                    reminderTime: task.reminderTime,
                }
            });

            // 2. Delete from PendingTask
            await tx.pendingTask.delete({ where: { id: task.id } });

            return completed;
        });

        // Notify Worker/Assignee
        const workerId = task.workingBy || task.assignedTo || task.targetTeamId;
        if (workerId && workerId !== userId) {
            await this.notificationService.createNotification(workerId, {
                title: 'Task Completed & Approved',
                description: `Your work on task "${task.taskTitle}" has been approved and marked as completed.`,
                type: 'TASK',
                metadata: { taskId: completedTask.id, taskNo: task.taskNo, status: 'Completed' },
            });
        }

        await this.invalidateCache();
        return this.sortTaskDates(completedTask);
    }

    private sortTaskDates(task: any) {
        if (!task) return task;
        const dateFields = ['reviewedTime', 'reminderTime', 'editTime'];
        dateFields.forEach(field => {
            if (Array.isArray(task[field])) {
                task[field] = task[field].sort((a: Date, b: Date) => a.getTime() - b.getTime());
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

    async delete(id: string, userId: string, role: string) {
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
    }

    private async invalidateCache() {
        await this.redisService.deleteCachePattern(`${this.CACHE_KEY}:* `);
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

        // Note: For 1 crore rows, we stream both Pending and Completed tasks
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
}
