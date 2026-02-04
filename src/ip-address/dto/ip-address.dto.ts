import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsArray,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { IpAddressStatus } from '@prisma/client';

export class CreateIpAddressDto {
  @IsString()
  @IsOptional()
  ipNo?: string;

  @IsString()
  @IsNotEmpty()
  ipAddress: string;

  @IsString()
  @IsNotEmpty()
  ipAddressName: string;

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

  @IsEnum(IpAddressStatus)
  @IsNotEmpty()
  status: IpAddressStatus;

  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateIpAddressDto {
  @IsString()
  @IsOptional()
  ipNo?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  ipAddressName?: string;

  @IsUUID()
  @IsOptional()
  clientGroupId?: string;

  @IsUUID()
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  companyId?: string | null;

  @IsUUID()
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  locationId?: string | null;

  @IsUUID()
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  subLocationId?: string | null;

  @IsEnum(IpAddressStatus)
  @IsOptional()
  status?: IpAddressStatus;

  @IsString()
  @IsOptional()
  remark?: string;
}

export class BulkCreateIpAddressDto {
  @IsArray()
  @IsNotEmpty()
  ipAddresses: CreateIpAddressDto[];
}

export class BulkUpdateIpAddressDto {
  @IsArray()
  @IsNotEmpty()
  updates: Array<{ id: string } & UpdateIpAddressDto>;
}

export class BulkDeleteIpAddressDto {
  @IsArray()
  @IsNotEmpty()
  ids: string[];
}

export class ChangeStatusDto {
  @IsEnum(IpAddressStatus)
  status: IpAddressStatus;
}

export class FilterIpAddressDto {
  @IsOptional()
  @IsEnum(IpAddressStatus)
  status?: IpAddressStatus;

  @IsOptional()
  @IsUUID()
  clientGroupId?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsUUID()
  subLocationId?: string;

  @IsOptional()
  @IsString()
  subLocationName?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  ipAddressName?: string;

  @IsOptional()
  @IsString()
  ipNo?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
