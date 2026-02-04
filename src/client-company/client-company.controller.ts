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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
// Removed UserRole import from @prisma/client

@Controller('client-companies')
export class ClientCompanyController {
  constructor(private clientCompanyService: ClientCompanyService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:create')
  create(@Body() dto: CreateClientCompanyDto, @GetUser('id') userId: string) {
    return this.clientCompanyService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:view')
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

  @Get('export/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:download')
  async exportExcel(
    @Query() query: any,
    @GetUser('id') userId: string,
    @Res() res: Response,
  ) {
    return this.clientCompanyService.downloadExcel(query, userId, res);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClientCompanyDto,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.update(id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.changeStatus(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:delete')
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.clientCompanyService.delete(id, userId);
  }

  @Post('bulk/create')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:create')
  bulkCreate(
    @Body() dto: BulkCreateClientCompanyDto,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.bulkCreate(dto, userId);
  }

  @Put('bulk/update')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  bulkUpdate(
    @Body() dto: BulkUpdateClientCompanyDto,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.bulkUpdate(dto, userId);
  }

  @Post('bulk/delete-records')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:delete')
  bulkDelete(
    @Body() dto: BulkDeleteClientCompanyDto,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.bulkDelete(dto, userId);
  }

  @Post('upload/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    return this.clientCompanyService.uploadExcel(file, userId);
  }
}
