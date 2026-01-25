import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID } from 'class-validator';
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
    companyId?: string;

    @IsUUID()
    @IsOptional()
    locationId?: string;

    @IsUUID()
    @IsOptional()
    subLocationId?: string;

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
