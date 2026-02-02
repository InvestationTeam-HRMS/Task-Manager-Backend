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
import { TeamService } from './team.service';
import {
  CreateTeamDto,
  UpdateTeamDto,
  BulkCreateTeamDto,
  BulkUpdateTeamDto,
  BulkDeleteTeamDto,
  ChangeStatusDto,
} from './dto/team.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('teams')
export class TeamController {
  constructor(private teamService: TeamService) { }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:create')
  create(@Body() dto: CreateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:view')
  findAll(@Query() query: any) {
    return this.teamService.findAll(query, query);
  }

  @Get('export/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:download')
  async exportExcel(
    @Query() query: any,
    @GetUser('id') userId: string,
    @Res() res: Response,
  ) {
    return this.teamService.downloadExcel(query, userId, res);
  }

  @Get('active')
  @UseGuards(JwtAuthGuard)
  findActive(@Query() pagination: PaginationDto) {
    return this.teamService.findActive(pagination);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findById(@Param('id') id: string) {
    return this.teamService.findById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @GetUser('id') userId: string,
  ) {
    return this.teamService.update(id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:edit')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @GetUser('id') userId: string,
  ) {
    return this.teamService.changeStatus(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:delete')
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.teamService.delete(id, userId);
  }

  @Post('bulk/create')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:create')
  bulkCreate(@Body() dto: BulkCreateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkCreate(dto, userId);
  }

  @Put('bulk/update')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:edit')
  bulkUpdate(@Body() dto: BulkUpdateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkUpdate(dto, userId);
  }

  @Post('bulk/delete-records')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:delete')
  bulkDelete(@Body() dto: BulkDeleteTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkDelete(dto, userId);
  }

  @Post(':id/resend-invitation')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:edit')
  resendInvitation(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.teamService.resendInvitation(id, userId);
  }

  @Post('upload/excel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('users:upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    return this.teamService.uploadExcel(file, userId);
  }
}
