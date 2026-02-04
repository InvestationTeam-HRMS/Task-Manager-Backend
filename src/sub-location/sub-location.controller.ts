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
  FilterSubLocationDto,
} from './dto/sub-location.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('sub-locations')
export class SubLocationController {
  constructor(private subLocationService: SubLocationService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:create')
  create(@Body() dto: CreateSubLocationDto, @GetUser('id') userId: string) {
    return this.subLocationService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:view')
  findAll(@Query() query: any) {
    return this.subLocationService.findAll(query, query);
  }

  @Get('export/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:download')
  async exportExcel(
    @Query() query: any,
    @GetUser('id') userId: string,
    @Res() res: Response,
  ) {
    return this.subLocationService.downloadExcel(query, userId, res);
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

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubLocationDto,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.update(id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.changeStatus(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:delete')
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.subLocationService.delete(id, userId);
  }

  @Post('bulk/create')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:create')
  bulkCreate(
    @Body() dto: BulkCreateSubLocationDto,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.bulkCreate(dto, userId);
  }

  @Put('bulk/update')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:edit')
  bulkUpdate(
    @Body() dto: BulkUpdateSubLocationDto,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.bulkUpdate(dto, userId);
  }

  @Post('bulk/delete-records')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:delete')
  bulkDelete(
    @Body() dto: BulkDeleteSubLocationDto,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.bulkDelete(dto, userId);
  }

  @Post('upload/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('organization:upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    return this.subLocationService.uploadExcel(file, userId);
  }
}
