import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectService } from './project.service';
import {
    CreateProjectDto,
    UpdateProjectDto,
    BulkCreateProjectDto,
    BulkUpdateProjectDto,
    BulkDeleteProjectDto,
    ChangeStatusDto,
} from './dto/project.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';


@Controller('projects')
export class ProjectController {
    constructor(private projectService: ProjectService) { }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:create')
    create(@Body() dto: CreateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:view')
    findAll(@Query() query: any) {
        return this.projectService.findAll(query, query);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:download')
    async exportExcel(
        @Query() query: any,
        @GetUser('id') userId: string,
        @Res() res: Response,
    ) {
        return this.projectService.downloadExcel(query, userId, res);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.projectService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.projectService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:edit')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateProjectDto,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:edit')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:delete')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.projectService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:create')
    bulkCreate(@Body() dto: BulkCreateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:edit')
    bulkUpdate(@Body() dto: BulkUpdateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:delete')
    bulkDelete(@Body() dto: BulkDeleteProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkDelete(dto, userId);
    }

    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('project:upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.uploadExcel(file, userId);
    }
}
