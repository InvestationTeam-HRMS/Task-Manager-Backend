import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID, IsDateString } from 'class-validator';
import { ProjectStatus, ProjectPriority } from '@prisma/client';

export class CreateProjectDto {
    @IsString()
    @IsOptional()
    projectNo?: string;

    @IsString()
    @IsNotEmpty()
    projectName: string;

    @IsUUID()
    @IsNotEmpty()
    subLocationId: string;

    @IsDateString()
    @IsNotEmpty()
    deadline: string;

    @IsEnum(ProjectPriority)
    @IsNotEmpty()
    priority: ProjectPriority;

    @IsEnum(ProjectStatus)
    @IsNotEmpty()
    status: ProjectStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateProjectDto {
    @IsString()
    @IsOptional()
    projectNo?: string;

    @IsString()
    @IsOptional()
    projectName?: string;

    @IsUUID()
    @IsOptional()
    subLocationId?: string;

    @IsDateString()
    @IsOptional()
    deadline?: string;

    @IsEnum(ProjectPriority)
    @IsOptional()
    priority?: ProjectPriority;

    @IsEnum(ProjectStatus)
    @IsOptional()
    status?: ProjectStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateProjectDto {
    @IsArray()
    @IsNotEmpty()
    projects: CreateProjectDto[];
}

export class BulkUpdateProjectDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateProjectDto>;
}

export class BulkDeleteProjectDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(ProjectStatus)
    status: ProjectStatus;
}

export class FilterProjectDto {
    @IsOptional()
    @IsEnum(ProjectStatus)
    status?: ProjectStatus;

    @IsOptional()
    @IsEnum(ProjectPriority)
    priority?: ProjectPriority;

    @IsOptional()
    @IsUUID()
    subLocationId?: string;

    @IsOptional()
    @IsUUID()
    locationId?: string;

    @IsOptional()
    @IsUUID()
    companyId?: string;

    @IsOptional()
    @IsUUID()
    clientGroupId?: string;

    @IsOptional()
    @IsString()
    projectName?: string;

    @IsOptional()
    @IsString()
    projectNo?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
