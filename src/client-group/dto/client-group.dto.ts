import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ClientGroupStatus } from '@prisma/client';

export class CreateClientGroupDto {
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

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsEnum(ClientGroupStatus)
  @IsNotEmpty()
  status: ClientGroupStatus;

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
  @MaxLength(6)
  @Transform(({ value }) => value?.toUpperCase())
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
