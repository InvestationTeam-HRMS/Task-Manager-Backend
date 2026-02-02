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
import { ClientLocationService } from './client-location.service';
import {
    CreateClientLocationDto,
    UpdateClientLocationDto,
    BulkCreateClientLocationDto,
    BulkUpdateClientLocationDto,
    BulkDeleteClientLocationDto,
    ChangeStatusDto,
    FilterClientLocationDto,
} from './dto/client-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';


@Controller('client-locations')
export class ClientLocationController {
    constructor(private clientLocationService: ClientLocationService) { }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:create')
    create(@Body() dto: CreateClientLocationDto, @GetUser('id') userId: string) {
        return this.clientLocationService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:view')
    findAll(@Query() query: any) {
        return this.clientLocationService.findAll(query, query);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:download')
    async exportExcel(
        @Query() query: any,
        @GetUser('id') userId: string,
        @Res() res: Response,
    ) {
        return this.clientLocationService.downloadExcel(query, userId, res);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.clientLocationService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.clientLocationService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:edit')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateClientLocationDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientLocationService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:edit')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientLocationService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:delete')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.clientLocationService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:create')
    bulkCreate(@Body() dto: BulkCreateClientLocationDto, @GetUser('id') userId: string) {
        return this.clientLocationService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:edit')
    bulkUpdate(@Body() dto: BulkUpdateClientLocationDto, @GetUser('id') userId: string) {
        return this.clientLocationService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:delete')
    bulkDelete(@Body() dto: BulkDeleteClientLocationDto, @GetUser('id') userId: string) {
        return this.clientLocationService.bulkDelete(dto, userId);
    }

    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('organization:upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.clientLocationService.uploadExcel(file, userId);
    }
}
