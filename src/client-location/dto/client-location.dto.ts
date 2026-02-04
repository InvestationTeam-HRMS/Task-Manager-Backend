import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsArray,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
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
  @MaxLength(6)
  @Transform(({ value }) => value?.toUpperCase())
  locationCode: string;

  @IsUUID()
  @IsNotEmpty()
  clientGroupId: string;

  @IsUUID()
  @IsOptional()
  companyId?: string;

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
  @MaxLength(6)
  @Transform(({ value }) => value?.toUpperCase())
  locationCode?: string;

  @IsUUID()
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  companyId?: string | null;

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
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  clientGroupId?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  locationNo?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.toUpperCase())
  locationCode?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  subLocationName?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  projectNo?: string;

  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsString()
  deadline?: string;
}
