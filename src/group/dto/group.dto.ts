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



    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    clientGroupIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    companyIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    locationIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    subLocationIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    teamMemberIds?: string[];

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



    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    clientGroupIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    companyIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    locationIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    subLocationIds?: string[];

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    teamMemberIds?: string[];

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
    @IsArray()
    @IsString({ each: true })
    clientGroupIds?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    companyIds?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    locationIds?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    subLocationIds?: string[];

    @IsOptional()
    @IsString()
    groupName?: string;

    @IsOptional()
    @IsString()
    groupNo?: string;

    @IsOptional()
    @IsEnum(GroupStatus)
    status?: GroupStatus;

    @IsOptional()
    @IsString()
    remark?: string;

    @IsOptional()
    @IsString()
    companyName?: string;

    @IsOptional()
    @IsString()
    locationName?: string;

    @IsOptional()
    @IsString()
    subLocationName?: string;

    @IsOptional()
    @IsString()
    teamMember?: string;
}
