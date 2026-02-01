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
    UsePipes,
    ValidationPipe,
    Res,
} from '@nestjs/common';
import { Response } from 'express';
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


@Controller('client-groups')
export class ClientGroupController {
    constructor(private clientGroupService: ClientGroupService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    create(@Body() dto: CreateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    findAll(@Query() query: any) {
        return this.clientGroupService.findAll(query, query);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    async exportExcel(
        @Query() query: any,
        @GetUser('id') userId: string,
        @Res() res: Response,
    ) {
        return this.clientGroupService.downloadExcel(query, userId, res);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.clientGroupService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.clientGroupService.findById(id);
    }

    @Get('by-code/:groupCode')
    @UseGuards(JwtAuthGuard)
    findByGroupCode(@Param('groupCode') groupCode: string) {
        return this.clientGroupService.findByGroupCode(groupCode);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateClientGroupDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.clientGroupService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkCreate(@Body() dto: BulkCreateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkUpdate(@Body() dto: BulkUpdateClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    bulkDelete(@Body() dto: BulkDeleteClientGroupDto, @GetUser('id') userId: string) {
        return this.clientGroupService.bulkDelete(dto, userId);
    }



    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE', 'MANAGER')
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.clientGroupService.uploadExcel(file, userId);
    }
}
