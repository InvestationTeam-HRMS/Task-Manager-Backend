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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('teams')
export class TeamController {
  constructor(private teamService: TeamService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
  create(@Body() dto: CreateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.create(dto, userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR, UserRole.EMPLOYEE)
  findAll(@Query() query: any) {
    return this.teamService.findAll(query, query);
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
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @GetUser('id') userId: string,
  ) {
    return this.teamService.update(id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @GetUser('id') userId: string,
  ) {
    return this.teamService.changeStatus(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN)
  delete(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.teamService.delete(id, userId);
  }

  @Post('bulk/create')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  bulkCreate(@Body() dto: BulkCreateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkCreate(dto, userId);
  }

  @Put('bulk/update')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  bulkUpdate(@Body() dto: BulkUpdateTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkUpdate(dto, userId);
  }

  @Post('bulk/delete-records')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN)
  bulkDelete(@Body() dto: BulkDeleteTeamDto, @GetUser('id') userId: string) {
    return this.teamService.bulkDelete(dto, userId);
  }

  @Post(':id/resend-invitation')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.HR)
  resendInvitation(@Param('id') id: string, @GetUser('id') userId: string) {
    return this.teamService.resendInvitation(id, userId);
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
    return this.teamService.uploadExcel(file, userId);
  }
}
