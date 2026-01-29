import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { SubLocationStatus } from '@prisma/client';

export class CreateSubLocationDto {
    @IsString()
    @IsOptional()
    subLocationNo?: string;

    @IsString()
    @IsNotEmpty()
    subLocationName: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(6)
    @Transform(({ value }) => value?.toUpperCase())
    subLocationCode: string;

    @IsUUID()
    @IsNotEmpty()
    clientGroupId: string;

    @IsUUID()
    @IsOptional()
    companyId?: string;

    @IsUUID()
    @IsOptional()
    locationId?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(SubLocationStatus)
    @IsNotEmpty()
    status: SubLocationStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateSubLocationDto {
    @IsString()
    @IsOptional()
    subLocationNo?: string;

    @IsString()
    @IsOptional()
    subLocationName?: string;

    @IsString()
    @IsOptional()
    @MaxLength(6)
    @Transform(({ value }) => value?.toUpperCase())
    subLocationCode?: string;

    @IsUUID()
    @IsOptional()
    companyId?: string;

    @IsUUID()
    @IsOptional()
    locationId?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(SubLocationStatus)
    @IsOptional()
    status?: SubLocationStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateSubLocationDto {
    @IsArray()
    @IsNotEmpty()
    subLocations: CreateSubLocationDto[];
}

export class BulkUpdateSubLocationDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateSubLocationDto>;
}

export class BulkDeleteSubLocationDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(SubLocationStatus)
    status: SubLocationStatus;
}

export class FilterSubLocationDto {
    @IsOptional()
    @IsEnum(SubLocationStatus)
    status?: SubLocationStatus;

    @IsOptional()
    @IsString()
    companyId?: string;

    @IsOptional()
    @IsString()
    clientGroupId?: string;

    @IsOptional()
    @IsString()
    locationId?: string;

    @IsOptional()
    @IsString()
    subLocationName?: string;

    @IsOptional()
    @IsString()
    subLocationNo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.toUpperCase())
    subLocationCode?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
