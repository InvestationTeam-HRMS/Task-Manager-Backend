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
import { Response } from 'express';
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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('ip-addresses')
export class IpAddressController {
  constructor(private ipAddressService: IpAddressService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:create')
  create(@Body() dto: CreateIpAddressDto, @GetUser('id') userId: string) {
    return this.ipAddressService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:view')
  findAll(@Query() query: any) {
    return this.ipAddressService.findAll(query, query);
  }

  @Get('export/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:download')
  async exportExcel(
    @Query() query: any,
    @GetUser('id') userId: string,
    @Res() res: Response,
  ) {
    return this.ipAddressService.downloadExcel(query, userId, res);
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIpAddressDto,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.update(id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:edit')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.changeStatus(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:delete')
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.ipAddressService.delete(id, userId);
  }

  @Post('bulk/create')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:create')
  bulkCreate(
    @Body() dto: BulkCreateIpAddressDto,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.bulkCreate(dto, userId);
  }

  @Put('bulk/update')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:edit')
  bulkUpdate(
    @Body() dto: BulkUpdateIpAddressDto,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.bulkUpdate(dto, userId);
  }

  @Post('bulk/delete-records')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:delete')
  bulkDelete(
    @Body() dto: BulkDeleteIpAddressDto,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.bulkDelete(dto, userId);
  }

  @Post('upload/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ip_address:upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    return this.ipAddressService.uploadExcel(file, userId);
  }
}
