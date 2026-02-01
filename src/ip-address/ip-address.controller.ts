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
import { IpAddressService } from './ip-address.service';
import {
    CreateIpAddressDto,
    UpdateIpAddressDto,
    BulkCreateIpAddressDto,
    BulkUpdateIpAddressDto,
    BulkDeleteIpAddressDto,
    ChangeStatusDto,
} from './dto/ip-address.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';


@Controller('ip-addresses')
export class IpAddressController {
    constructor(private ipAddressService: IpAddressService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    create(@Body() dto: CreateIpAddressDto, @GetUser('id') userId: string) {
        return this.ipAddressService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR', 'EMPLOYEE')
    findAll(@Query() query: any) {
        return this.ipAddressService.findAll(query, query);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.ipAddressService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.ipAddressService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateIpAddressDto,
        @GetUser('id') userId: string,
    ) {
        return this.ipAddressService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.ipAddressService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.ipAddressService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkCreate(@Body() dto: BulkCreateIpAddressDto, @GetUser('id') userId: string) {
        return this.ipAddressService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN', 'HR')
    bulkUpdate(@Body() dto: BulkUpdateIpAddressDto, @GetUser('id') userId: string) {
        return this.ipAddressService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles('ADMIN')
    bulkDelete(@Body() dto: BulkDeleteIpAddressDto, @GetUser('id') userId: string) {
        return this.ipAddressService.bulkDelete(dto, userId);
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
        return this.ipAddressService.uploadExcel(file, userId);
    }
}
