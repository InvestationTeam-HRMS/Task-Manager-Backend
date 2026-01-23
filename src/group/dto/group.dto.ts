import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID } from 'class-validator';
import { GroupStatus } from '@prisma/client';

export class CreateGroupDto {
    @IsString()
    @IsOptional()
    groupNo?: string;

    @IsString()
    @IsNotEmpty()
    groupName: string;

    @IsString()
    @IsNotEmpty()
    groupCode: string;

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

    @IsEnum(GroupStatus)
    @IsNotEmpty()
    status: GroupStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateGroupDto {
    @IsString()
    @IsOptional()
    groupNo?: string;

    @IsString()
    @IsOptional()
    groupName?: string;

    @IsString()
    @IsOptional()
    groupCode?: string;

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

    @IsEnum(GroupStatus)
    @IsOptional()
    status?: GroupStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateGroupDto {
    @IsArray()
    @IsNotEmpty()
    groups: CreateGroupDto[];
}

export class BulkUpdateGroupDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateGroupDto>;
}

export class BulkDeleteGroupDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(GroupStatus)
    status: GroupStatus;
}

export class FilterGroupDto {
    @IsOptional()
    @IsEnum(GroupStatus)
    status?: GroupStatus;

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
    groupName?: string;

    @IsOptional()
    @IsString()
    groupNo?: string;

    @IsOptional()
    @IsString()
    groupCode?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
