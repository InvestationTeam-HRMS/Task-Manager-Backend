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
import { ClientCompanyService } from './client-company.service';
import {
    CreateClientCompanyDto,
    UpdateClientCompanyDto,
    BulkCreateClientCompanyDto,
    BulkUpdateClientCompanyDto,
    BulkDeleteClientCompanyDto,
    ChangeStatusDto,
    FilterClientCompanyDto,
} from './dto/client-company.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('client-companies')
export class ClientCompanyController {
    constructor(private clientCompanyService: ClientCompanyService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    create(@Body() dto: CreateClientCompanyDto, @GetUser('id') userId: string) {
        return this.clientCompanyService.create(dto, userId);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
    findAll(@Query() query: any) {
        return this.clientCompanyService.findAll(query, query);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    findActive(@Query() pagination: PaginationDto) {
        return this.clientCompanyService.findActive(pagination);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findById(@Param('id') id: string) {
        return this.clientCompanyService.findById(id);
    }

    @Get('by-code/:companyCode')
    @UseGuards(JwtAuthGuard)
    findByCompanyCode(@Param('companyCode') companyCode: string) {
        return this.clientCompanyService.findByCompanyCode(companyCode);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateClientCompanyDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientCompanyService.update(id, dto, userId);
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    changeStatus(
        @Param('id') id: string,
        @Body() dto: ChangeStatusDto,
        @GetUser('id') userId: string,
    ) {
        return this.clientCompanyService.changeStatus(id, dto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    delete(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.clientCompanyService.delete(id, userId);
    }

    @Post('bulk/create')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkCreate(@Body() dto: BulkCreateClientCompanyDto, @GetUser('id') userId: string) {
        return this.clientCompanyService.bulkCreate(dto, userId);
    }

    @Put('bulk/update')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN, UserRole.HR)
    bulkUpdate(@Body() dto: BulkUpdateClientCompanyDto, @GetUser('id') userId: string) {
        return this.clientCompanyService.bulkUpdate(dto, userId);
    }

    @Post('bulk/delete-records')
    @UseGuards(JwtAuthGuard)
    @Roles(UserRole.ADMIN)
    bulkDelete(@Body() dto: BulkDeleteClientCompanyDto, @GetUser('id') userId: string) {
        return this.clientCompanyService.bulkDelete(dto, userId);
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
        return this.clientCompanyService.uploadExcel(file, userId);
    }
}
