import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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
    @MaxLength(6)
    @Transform(({ value }) => value?.toUpperCase())
    groupCode: string;

    @IsUUID()
    @IsNotEmpty()
    clientGroupId: string;

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
    @MaxLength(6)
    @Transform(({ value }) => value?.toUpperCase())
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
    @Transform(({ value }) => value?.toUpperCase())
    groupCode?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
