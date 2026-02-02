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
    Res,
    UseGuards,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { GroupService } from './group.service';
import {
    CreateGroupDto,
    UpdateGroupDto,
    BulkCreateGroupDto,
    BulkUpdateGroupDto,
    BulkDeleteGroupDto,
    ChangeStatusDto,
    FilterGroupDto,
} from './dto/group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';


@Controller('groups')
export class GroupController {
    constructor(private groupService: GroupService) { }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:create')
    create(@Body() dto: CreateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:view')
    findAll(@Query() query: any) {
        return this.groupService.findAll(query, query);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:download')
    async exportExcel(
        @Query() query: any,
        @GetUser('id') userId: string,
        @Res() res: Response,
    ) {
        return this.groupService.downloadExcel(query, userId, res);
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
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:edit')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateGroupDto,
        @GetUser('id') userId: string,
    ) {
        return this.groupService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:edit')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.groupService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:delete')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.groupService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:create')
    bulkCreate(@Body() dto: BulkCreateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:edit')
    bulkUpdate(@Body() dto: BulkUpdateGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:delete')
    bulkDelete(@Body() dto: BulkDeleteGroupDto, @GetUser('id') userId: string) {
        return this.groupService.bulkDelete(dto, userId);
    }

    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('group:upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.groupService.uploadExcel(file, userId);
    }
}
