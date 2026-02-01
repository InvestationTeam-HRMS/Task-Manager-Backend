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
import { SubLocationService } from './sub-location.service';
import {
    CreateSubLocationDto,
    UpdateSubLocationDto,
    BulkCreateSubLocationDto,
    BulkUpdateSubLocationDto,
    BulkDeleteSubLocationDto,
    ChangeStatusDto,
} from './dto/sub-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';


@Controller('sub-locations')
export class SubLocationController {
    constructor(private subLocationService: SubLocationService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    create(@Body() dto: CreateSubLocationDto, @GetUser('id') userId: string) {
        return this.subLocationService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    findAll(@Query() query: any) {
        return this.subLocationService.findAll(query, query);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.subLocationService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.subLocationService.findById(id);
    }

    @Get('export/excel')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    async exportExcel(
        @Query() query: any,
        @GetUser('id') userId: string,
        @Res() res: Response
    ) {
        return this.subLocationService.downloadExcel(query, userId, res);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateSubLocationDto,
        @GetUser('id') userId: string,
    ) {
        return this.subLocationService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.subLocationService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.subLocationService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkCreate(@Body() dto: BulkCreateSubLocationDto, @GetUser('id') userId: string) {
        return this.subLocationService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkUpdate(@Body() dto: BulkUpdateSubLocationDto, @GetUser('id') userId: string) {
        return this.subLocationService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    bulkDelete(@Body() dto: BulkDeleteSubLocationDto, @GetUser('id') userId: string) {
        return this.subLocationService.bulkDelete(dto, userId);
    }



    @Post('upload/excel')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(
        'ADMIN',
        'HR',
        'EMPLOYEE',
        'MANAGER',
    )
    @UseInterceptors(FileInterceptor('file'))
    uploadExcel(
        @UploadedFile() file: Express.Multer.File,
        @GetUser('id') userId: string,
    ) {
        return this.subLocationService.uploadExcel(file, userId);
    }
}
