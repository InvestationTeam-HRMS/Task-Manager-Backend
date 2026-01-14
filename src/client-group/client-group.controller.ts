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
import { ClientGroupService } from './client-group.service';
import {
    CreateClientGroupDto,
    UpdateClientGroupDto,
    BulkCreateClientGroupDto,
    BulkUpdateClientGroupDto,
    BulkDeleteClientGroupDto,
    ChangeStatusDto,
    FilterClientGroupDto,
} from './dto/client-group.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('api/v1/client-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientGroupController {
    constructor(private clientGroupService: ClientGroupService) { }

    @Post()
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    create(@Body() dto: CreateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.create(dto, userId);
    }

    @Get()
    findAll(@Query() pagination: PaginationDto, @Query() filter: FilterClientGroupDto) {
        return this.clientGroupService.findAll(pagination, filter);
    }

    @Get('active')
    findActive(@Query() pagination: PaginationDto) {
        return this.clientGroupService.findActive(pagination);
    }

    @Get(':id')
    findById(@Param('id') id: string) {
        return this.clientGroupService.findById(id);
    }

    @Get('by-code/:groupCode')
    findByGroupCode(@Param('groupCode') groupCode: string) {
        return this.clientGroupService.findByGroupCode(groupCode);
    }

    @Put(':id')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateClientGroupDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.clientGroupService.delete(id, userId);
    }

    @Post('bulk/create')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    bulkCreate(@Body() dto: BulkCreateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    bulkUpdate(@Body() dto: BulkUpdateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkUpdate(dto, userId);
    }

    @Delete('bulk/delete')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    bulkDelete(@Body() dto: BulkDeleteClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkDelete(dto, userId);
    }

    @Patch(':id/restore')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    restore(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.clientGroupService.restore(id, userId);
    }

    @Post('upload/excel')
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.HR)
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.uploadExcel(file, userId);
    }
}
