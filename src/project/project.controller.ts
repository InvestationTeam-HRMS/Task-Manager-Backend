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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('projects')
export class ProjectController {
    constructor(private projectService: ProjectService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    create(@Body() dto: CreateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    findAll(@Query() query: any) {
        return this.projectService.findAll(query, query);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
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
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateProjectDto,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.projectService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkCreate(@Body() dto: BulkCreateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkUpdate(@Body() dto: BulkUpdateProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    bulkDelete(@Body() dto: BulkDeleteProjectDto, @GetUser('id') userId: string) {
        return this.projectService.bulkDelete(dto, userId);
    }



    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(
        UserRole.ADMIN,
        UserRole.HR,
        UserRole.EMPLOYEE,
        UserRole.MANAGER,
    )
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.projectService.uploadExcel(file, userId);
    }
}
