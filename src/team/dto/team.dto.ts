import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID, IsBoolean, IsEmail } from 'class-validator';
import { TeamStatus, LoginMethod } from '@prisma/client';

export class CreateTeamDto {
    @IsString()
    @IsOptional()
    teamNo?: string;

    @IsString()
    @IsNotEmpty()
    teamName: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    phone: string;

    @IsBoolean()
    @IsOptional()
    taskAssignPermission?: boolean;

    @IsUUID()
    @IsNotEmpty()
    clientGroupId: string;

    @IsUUID()
    @IsNotEmpty()
    companyId: string;

    @IsUUID()
    @IsNotEmpty()
    locationId: string;

    @IsUUID()
    @IsNotEmpty()
    subLocationId: string;

    @IsEnum(TeamStatus)
    @IsNotEmpty()
    status: TeamStatus;

    @IsEnum(LoginMethod)
    @IsNotEmpty()
    loginMethod: LoginMethod;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateTeamDto {
    @IsString()
    @IsOptional()
    teamNo?: string;

    @IsString()
    @IsOptional()
    teamName?: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsBoolean()
    @IsOptional()
    taskAssignPermission?: boolean;

    @IsUUID()
    @IsOptional()
    clientGroupId?: string;

    @IsUUID()
    @IsOptional()
    companyId?: string;

    @IsUUID()
    @IsOptional()
    locationId?: string;

    @IsUUID()
    @IsOptional()
    subLocationId?: string;

    @IsEnum(TeamStatus)
    @IsOptional()
    status?: TeamStatus;

    @IsEnum(LoginMethod)
    @IsOptional()
    loginMethod?: LoginMethod;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateTeamDto {
    @IsArray()
    @IsNotEmpty()
    teams: CreateTeamDto[];
}

export class BulkUpdateTeamDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateTeamDto>;
}

export class BulkDeleteTeamDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(TeamStatus)
    status: TeamStatus;
}

export class FilterTeamDto {
    @IsOptional()
    @IsEnum(TeamStatus)
    status?: TeamStatus;

    @IsOptional()
    @IsUUID()
    clientGroupId?: string;

    @IsOptional()
    @IsUUID()
    companyId?: string;

    @IsOptional()
    @IsUUID()
    locationId?: string;

    @IsOptional()
    @IsUUID()
    subLocationId?: string;

    @IsOptional()
    @IsString()
    teamName?: string;

    @IsOptional()
    @IsString()
    teamNo?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
