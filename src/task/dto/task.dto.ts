import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNotEmpty,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TaskStatus, AcceptanceStatus } from '@prisma/client';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  taskTitle: string;

  @IsString()
  @IsNotEmpty()
  priority: string;

  @IsOptional()
  @IsString()
  additionalNote?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  reminderTime?: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  document?: string;

  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  assignedTo?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetGroupId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetTeamId?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  taskTitle?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  taskStatus?: TaskStatus;

  @IsOptional()
  @IsString()
  additionalNote?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsDateString()
  completeTime?: string;

  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  reviewedTime?: string[];

  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  reminderTime?: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  document?: string;

  @IsOptional()
  @IsString()
  remarkChat?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  projectId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  assignedTo?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetGroupId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetTeamId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  workingBy?: string;
}

import { PaginationDto } from '../../common/dto/pagination.dto';

export class FilterTaskDto extends PaginationDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  taskStatus?: TaskStatus;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  projectId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  assignedTo?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetGroupId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  targetTeamId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  createdBy?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === 'null' || value === '' ? null : value))
  workingBy?: string;

  @IsOptional()
  @IsString()
  taskNo?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsString()
  remarkChat?: string;

  @IsOptional()
  @IsDateString()
  createdTime?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsDateString()
  completeTime?: string;

  @IsOptional()
  @IsString()
  viewMode?: TaskViewMode;
}

export enum TaskViewMode {
  ALL = 'ALL',
  MY_PENDING = 'MY_PENDING',
  MY_COMPLETED = 'MY_COMPLETED',
  TEAM_PENDING = 'TEAM_PENDING',
  TEAM_COMPLETED = 'TEAM_COMPLETED',
  REVIEW_PENDING_BY_ME = 'REVIEW_PENDING_BY_ME',
  REVIEW_PENDING_BY_TEAM = 'REVIEW_PENDING_BY_TEAM',
}
export class UpdateTaskAcceptanceDto {
  @IsEnum(AcceptanceStatus)
  @IsNotEmpty()
  status: AcceptanceStatus;
}
