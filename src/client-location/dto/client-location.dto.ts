import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID } from 'class-validator';
import { LocationStatus } from '@prisma/client';

export class CreateClientLocationDto {
    @IsString()
    @IsOptional()
    locationNo?: string;

    @IsString()
    @IsNotEmpty()
    locationName: string;

    @IsString()
    @IsNotEmpty()
    locationCode: string;

    @IsUUID()
    @IsNotEmpty()
    companyId: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(LocationStatus)
    @IsNotEmpty()
    status: LocationStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateClientLocationDto {
    @IsString()
    @IsOptional()
    locationNo?: string;

    @IsString()
    @IsOptional()
    locationName?: string;

    @IsString()
    @IsOptional()
    locationCode?: string;

    @IsUUID()
    @IsOptional()
    companyId?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(LocationStatus)
    @IsOptional()
    status?: LocationStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateClientLocationDto {
    @IsArray()
    @IsNotEmpty()
    locations: CreateClientLocationDto[];
}

export class BulkUpdateClientLocationDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateClientLocationDto>;
}

export class BulkDeleteClientLocationDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(LocationStatus)
    status: LocationStatus;
}

export class FilterClientLocationDto {
    @IsOptional()
    @IsEnum(LocationStatus)
    status?: LocationStatus;

    @IsOptional()
    @IsUUID()
    companyId?: string;

    @IsOptional()
    @IsString()
    locationName?: string;

    @IsOptional()
    @IsString()
    locationNo?: string;

    @IsOptional()
    @IsString()
    locationCode?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
