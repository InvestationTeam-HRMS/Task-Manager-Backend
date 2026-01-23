import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsNotEmpty } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class CreateTaskDto {
    @IsString()
    @IsNotEmpty()
    taskTitle: string;

    @IsString()
    @IsNotEmpty()
    priority: string;

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
    reminderTime?: string;

    @IsOptional()
    @IsString()
    attachment?: string;

    @IsUUID()
    @IsNotEmpty()
    projectId: string;

    @IsOptional()
    @IsUUID()
    assignedTo?: string;

    @IsOptional()
    @IsUUID()
    targetGroupId?: string;

    @IsOptional()
    @IsUUID()
    targetTeamId?: string;
}

export class UpdateTaskDto {
    @IsOptional()
    @IsString()
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
    @IsDateString()
    reviewedTime?: string;

    @IsOptional()
    @IsDateString()
    reminderTime?: string;

    @IsOptional()
    @IsString()
    attachment?: string;

    @IsOptional()
    @IsString()
    remarkChat?: string;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @IsUUID()
    assignedTo?: string;

    @IsOptional()
    @IsUUID()
    targetGroupId?: string;

    @IsOptional()
    @IsUUID()
    targetTeamId?: string;

    @IsOptional()
    @IsUUID()
    workingBy?: string;
}

export class FilterTaskDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsEnum(TaskStatus)
    taskStatus?: TaskStatus;

    @IsOptional()
    @IsString()
    priority?: string;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @IsUUID()
    assignedTo?: string;

    @IsOptional()
    @IsUUID()
    targetGroupId?: string;

    @IsOptional()
    @IsUUID()
    targetTeamId?: string;

    @IsOptional()
    @IsUUID()
    createdBy?: string;

    @IsOptional()
    @IsUUID()
    workingBy?: string;

    @IsOptional()
    @IsString()
    viewMode?: TaskViewMode;

    @IsOptional()
    page?: any;

    @IsOptional()
    limit?: any;
}

export enum TaskViewMode {
    MY_PENDING = 'MY_PENDING',
    MY_COMPLETED = 'MY_COMPLETED',
    TEAM_PENDING = 'TEAM_PENDING',
    TEAM_COMPLETED = 'TEAM_COMPLETED',
    REVIEW_PENDING_BY_ME = 'REVIEW_PENDING_BY_ME',
    REVIEW_PENDING_BY_TEAM = 'REVIEW_PENDING_BY_TEAM',
}
