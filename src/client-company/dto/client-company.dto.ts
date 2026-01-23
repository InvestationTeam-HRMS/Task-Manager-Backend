import { IsString, IsEnum, IsOptional, IsNotEmpty, IsArray, IsUUID } from 'class-validator';
import { CompanyStatus } from '@prisma/client';

export class CreateClientCompanyDto {
    @IsString()
    @IsOptional()
    companyNo?: string;

    @IsString()
    @IsNotEmpty()
    companyName: string;

    @IsString()
    @IsNotEmpty()
    companyCode: string;

    @IsUUID()
    @IsNotEmpty()
    groupId: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(CompanyStatus)
    @IsNotEmpty()
    status: CompanyStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class UpdateClientCompanyDto {
    @IsString()
    @IsOptional()
    companyNo?: string;

    @IsString()
    @IsOptional()
    companyName?: string;

    @IsString()
    @IsOptional()
    companyCode?: string;

    @IsUUID()
    @IsOptional()
    groupId?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsEnum(CompanyStatus)
    @IsOptional()
    status?: CompanyStatus;

    @IsString()
    @IsOptional()
    remark?: string;
}

export class BulkCreateClientCompanyDto {
    @IsArray()
    @IsNotEmpty()
    companies: CreateClientCompanyDto[];
}

export class BulkUpdateClientCompanyDto {
    @IsArray()
    @IsNotEmpty()
    updates: Array<{ id: string } & UpdateClientCompanyDto>;
}

export class BulkDeleteClientCompanyDto {
    @IsArray()
    @IsNotEmpty()
    ids: string[];
}

export class ChangeStatusDto {
    @IsEnum(CompanyStatus)
    status: CompanyStatus;
}

export class FilterClientCompanyDto {
    @IsOptional()
    @IsEnum(CompanyStatus)
    status?: CompanyStatus;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsString()
    companyName?: string;

    @IsOptional()
    @IsString()
    companyNo?: string;

    @IsOptional()
    @IsString()
    companyCode?: string;

    @IsOptional()
    @IsString()
    remark?: string;
}
