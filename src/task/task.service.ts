import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutoNumberService } from '../common/services/auto-number.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto } from './dto/task.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Prisma, TaskStatus } from '@prisma/client';

@Injectable()
export class TaskService {
    private readonly logger = new Logger(TaskService.name);

    constructor(
        private prisma: PrismaService,
        private autoNumberService: AutoNumberService,
    ) { }

    async create(dto: CreateTaskDto, userId: string) {
        const taskNo = await this.autoNumberService.generateTaskNo();

        return this.prisma.task.create({
            data: {
                ...dto,
                taskNo,
                createdBy: userId,
            },
            include: {
                project: true,
                assignee: true,
                creator: true,
            },
        });
    }

    async findAll(pagination: PaginationDto, filter: FilterTaskDto) {
        const { page = 1, limit = 10 } = pagination;
        const skip = (page - 1) * limit;

        const where: Prisma.TaskWhereInput = {};

        if (filter.search) {
            where.OR = [
                { taskTitle: { contains: filter.search, mode: 'insensitive' } },
                { taskNo: { contains: filter.search, mode: 'insensitive' } },
            ];
        }

        if (filter.taskStatus) {
            where.taskStatus = filter.taskStatus;
        }

        if (filter.priority) {
            where.priority = filter.priority;
        }

        if (filter.projectId) {
            where.projectId = filter.projectId;
        }

        if (filter.assignedTo) {
            where.assignedTo = filter.assignedTo;
        }

        if (filter.createdBy) {
            where.createdBy = filter.createdBy;
        }

        if (filter.workingBy) {
            where.workingBy = filter.workingBy;
        }

        const [data, total] = await Promise.all([
            this.prisma.task.findMany({
                where,
                skip,
                take: limit,
                orderBy: { creatingTime: 'desc' },
                include: {
                    project: true,
                    assignee: true,
                    creator: true,
                    worker: true,
                },
            }),
            this.prisma.task.count({ where }),
        ]);

        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async findById(id: string) {
        const task = await this.prisma.task.findUnique({
            where: { id },
            include: {
                project: true,
                assignee: true,
                creator: true,
                worker: true,
            },
        });

        if (!task) {
            throw new NotFoundException(`Task with ID ${id} not found`);
        }

        return task;
    }

    async update(id: string, dto: UpdateTaskDto, userId: string) {
        await this.findById(id);

        return this.prisma.task.update({
            where: { id },
            data: {
                ...dto,
            },
            include: {
                project: true,
                assignee: true,
                creator: true,
                worker: true,
            },
        });
    }

    async delete(id: string) {
        await this.findById(id);
        return this.prisma.task.delete({ where: { id } });
    }
}
