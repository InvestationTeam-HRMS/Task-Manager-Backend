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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GroupService } from './group.service';
import {
    CreateGroupDto,
    UpdateGroupDto,
    BulkCreateGroupDto,
    BulkUpdateGroupDto,
    BulkDeleteGroupDto,
    ChangeStatusDto,
} from './dto/group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('groups')
export class GroupController {
    constructor(private groupService: GroupService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    create(@Body() dto: CreateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    findAll(@Query() query: any) {
        return this.groupService.findAll(query, query);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.groupService.findActive(pagination);
    }

    @Get('my-groups')
    @UseGuards(JwtAuthGuard)
    findMyGroups(@GetUser('id') userId: string) {
        return this.groupService.findMyGroups(userId);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.groupService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateGroupDto,
        @GetUser('id') userId: string,
    ) {
        return this.groupService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.groupService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.groupService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkCreate(@Body() dto: BulkCreateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkUpdate(@Body() dto: BulkUpdateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    bulkDelete(@Body() dto: BulkDeleteGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkDelete(dto, userId);
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
        return this.groupService.uploadExcel(file, userId);
    }
}
