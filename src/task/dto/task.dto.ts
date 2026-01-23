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

    @IsDateString()
    @IsNotEmpty()
    deadline: string;

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
    createdBy?: string;

    @IsOptional()
    @IsUUID()
    workingBy?: string;
}
