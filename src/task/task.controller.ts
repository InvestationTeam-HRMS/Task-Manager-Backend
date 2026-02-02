import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    UploadedFiles,
    Res,
    BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TaskService } from './task.service';
import { CreateTaskDto, UpdateTaskDto, FilterTaskDto } from './dto/task.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { AcceptanceStatus } from '@prisma/client';
import { UpdateTaskAcceptanceDto } from './dto/task-acceptance.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskController {
    constructor(private readonly taskService: TaskService) { }

    @Get('logs')
    async getActivityLogs(
        @GetUser('id') userId: string,
        @GetUser('role') role: string,
        @Query('activityIndex') activityIndex: number = 1,
        @Query('taskNo') taskNo?: string,
        @Query('mentionedOnly') mentionedOnly: string = 'false',
    ) {
        return this.taskService.getActivityLogs(userId, activityIndex, taskNo, role, mentionedOnly === 'true');
    }

    @Post()
    @UseGuards(PermissionsGuard)
    @Permissions('task:create')
    @UseInterceptors(FilesInterceptor('files'))
    async create(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() dto: CreateTaskDto,
        @GetUser('id') userId: string
    ) {
        const result = await this.taskService.create(dto, userId, files);
        return { data: result };
    }

    @Get()
    @UseGuards(PermissionsGuard)
    @Permissions('task:view')
    findAll(
        @Query() filter: FilterTaskDto,
        @GetUser('id') userId: string,
        @GetUser('role') role: string
    ) {
        return this.taskService.findAll(filter, filter, userId, role);
    }

    @Post('bulk-upload')
    @UseGuards(PermissionsGuard)
    @Permissions('task:upload')
    @UseInterceptors(FilesInterceptor('file', 1))
    bulkUpload(
        @UploadedFiles() files: Express.Multer.File[],
        @GetUser('id') userId: string
    ) {
        if (!files || files.length === 0) throw new BadRequestException('No file uploaded');
        return this.taskService.bulkUpload(files[0], userId);
    }

    @Get('export/excel')
    @UseGuards(PermissionsGuard)
    @Permissions('task:download')
    async exportExcel(
        @Query() filter: FilterTaskDto,
        @GetUser('id') userId: string,
        @Res() res: Response
    ) {
        await this.taskService.downloadExcel(filter, userId, res);
    }

    @Get('acceptances/pending')
    getPendingAcceptances(@GetUser('id') userId: string) {
        return this.taskService.getPendingAcceptances(userId);
    }

    @Patch('acceptances/:id')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    updateAcceptanceStatus(
        @Param('id') id: string,
        @Body() dto: UpdateTaskAcceptanceDto,
        @GetUser('id') userId: string
    ) {
        return this.taskService.updateAcceptanceStatus(id, dto, userId);
    }

    @Get(':id')
    @UseGuards(PermissionsGuard)
    @Permissions('task:view')
    async findById(@Param('id') id: string) {
        const result = await this.taskService.findById(id);
        return { data: result };
    }

    @Patch(':id')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    @UseInterceptors(FilesInterceptor('files'))
    async update(
        @Param('id') id: string,
        @Body() dto: UpdateTaskDto,
        @GetUser('id') userId: string,
        @GetUser('role') role: string,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        const result = await this.taskService.update(id, dto, userId, role, files);
        return { data: result };
    }

    @Patch(':id/submit-review')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    @UseInterceptors(FilesInterceptor('attachments'))
    async submitReview(
        @Param('id') id: string,
        @Body('remark') remark: string,
        @GetUser('id') userId: string,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        const result = await this.taskService.submitForReview(id, remark, userId, files);
        return { data: result };
    }

    @Patch(':id/finalize-complete')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    @UseInterceptors(FilesInterceptor('attachments'))
    async finalizeComplete(
        @Param('id') id: string,
        @Body('remark') remark: string,
        @GetUser('id') userId: string,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        const result = await this.taskService.finalizeCompletion(id, remark, userId, files);
        return { data: result };
    }

    @Patch(':id/reminder')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    sendReminder(
        @Param('id') id: string,
        @GetUser('id') userId: string,
    ) {
        return this.taskService.sendReminder(id, userId);
    }

    @Patch(':id/reject')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    @UseInterceptors(FilesInterceptor('attachments'))
    async rejectTask(
        @Param('id') id: string,
        @Body('remark') remark: string,
        @GetUser('id') userId: string,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        const result = await this.taskService.rejectTask(id, remark, userId, files);
        return { data: result };
    }

    @Patch(':id/revert-to-pending')
    @UseGuards(PermissionsGuard)
    @Permissions('task:edit')
    async revertToPending(
        @Param('id') id: string,
        @GetUser('id') userId: string,
    ) {
        const result = await this.taskService.revertToPending(id, userId);
        return { data: result };
    }

    @Delete(':id')
    @UseGuards(PermissionsGuard)
    @Permissions('task:delete')
    delete(
        @Param('id') id: string,
        @GetUser('id') userId: string,
        @GetUser('role') role: string
    ) {
        return this.taskService.delete(id, userId, role);
    }
}
