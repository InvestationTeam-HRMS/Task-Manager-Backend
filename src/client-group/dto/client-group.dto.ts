import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray } from 'class-validator';
import { ClientGroupStatus } from '@prisma/client';

export class CreateClientGroupDto {
    @IsString()
    @IsNotEmpty()
    groupNo: string;

    @IsString()
    @IsNotEmpty()
    groupName: string;

    @IsString()
    @IsNotEmpty()
    groupCode: string;

    @IsString()
    @IsNotEmpty()
    country: string;

    @IsEnum(ClientGroupStatus)
    @IsOptional()
    status?: ClientGroupStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateClientGroupDto {
    @IsString()
    @IsOptional()
    groupNo?: string;

    @IsString()
    @IsOptional()
    groupName?: string;

    @IsString()
    @IsOptional()
    groupCode?: string;

    @IsString()
    @IsOptional()
    country?: string;

    @IsEnum(ClientGroupStatus)
    @IsOptional()
    status?: ClientGroupStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateClientGroupDto {
    @IsArray()
    @IsNotEmpty()
    clientGroups: CreateClientGroupDto[];
}

export class BulkUpdateClientGroupDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateClientGroupDto>;
}

export class BulkDeleteClientGroupDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(ClientGroupStatus)
    status: ClientGroupStatus;
}

export class FilterClientGroupDto {
    @IsOptional()
    @IsEnum(ClientGroupStatus)
    status?: ClientGroupStatus;

    @IsOptional()
    @IsString()
    country?: string;

    @IsOptional()
    @IsString()
    groupCode?: string;
}
