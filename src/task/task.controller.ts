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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TaskController {
    constructor(private readonly taskService: TaskService) { }

    @Post()
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.HR, UserRole.EMPLOYEE)
    @UseInterceptors(FilesInterceptor('files'))
    create(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() dto: CreateTaskDto,
        @GetUser('id') userId: string
    ) {
        return this.taskService.create(dto, userId, files);
    }

    @Get()
    findAll(
        @Query() filter: FilterTaskDto,
        @GetUser('id') userId: string,
        @GetUser('role') role: UserRole
    ) {
        return this.taskService.findAll(filter, filter, userId, role);
    }

    @Post('bulk-upload')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
    @UseInterceptors(FilesInterceptor('file', 1)) // 'file' matches the frontend key
    bulkUpload(
        @UploadedFiles() files: Express.Multer.File[],
        @GetUser('id') userId: string
    ) {
        if (!files || files.length === 0) throw new BadRequestException('No file uploaded');
        return this.taskService.bulkUpload(files[0], userId);
    }

    @Get('download')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER)
    async download(
        @Query() filter: FilterTaskDto,
        @GetUser('id') userId: string,
        @Res() res: any
    ) {
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="tasks.xlsx"',
        });
        await this.taskService.downloadExcel(filter, userId, res);
    }

    @Get(':id')
    findById(@Param('id') id: string) {
        return this.taskService.findById(id);
    }

    // ... rest of the methods

    @Patch(':id')
    @UseInterceptors(FilesInterceptor('files'))
    update(
        @Param('id') id: string,
        @Body() dto: UpdateTaskDto,
        @GetUser('id') userId: string,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        return this.taskService.update(id, dto, userId, files);
    }

    @Patch(':id/submit-review')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.HR, UserRole.EMPLOYEE)
    submitReview(
        @Param('id') id: string,
        @Body('remark') remark: string,
        @GetUser('id') userId: string,
    ) {
        return this.taskService.submitForReview(id, remark, userId);
    }

    @Patch(':id/finalize-complete')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.HR, UserRole.EMPLOYEE)
    finalizeComplete(
        @Param('id') id: string,
        @Body('remark') remark: string,
        @GetUser('id') userId: string,
    ) {
        return this.taskService.finalizeCompletion(id, remark, userId);
    }

    @Delete(':id')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.HR, UserRole.EMPLOYEE)
    delete(
        @Param('id') id: string,
        @GetUser('id') userId: string,
        @GetUser('role') role: UserRole
    ) {
        return this.taskService.delete(id, userId, role);
    }
}
