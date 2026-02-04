import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsArray,
  IsUUID,
  IsBoolean,
  IsEmail,
  MinLength,
  Length,
  ValidateIf,
} from 'class-validator';
import { TeamStatus, LoginMethod } from '@prisma/client';

export class CreateTeamDto {
  @IsString()
  @IsOptional()
  teamNo?: string;

  @IsString()
  @IsNotEmpty()
  teamName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Length(10, 10, { message: 'Phone number must be exactly 10 characters' })
  phone: string;

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

  @IsEnum(TeamStatus)
  @IsNotEmpty()
  status: TeamStatus;

  @IsEnum(LoginMethod)
  @IsNotEmpty()
  loginMethod: LoginMethod;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsUUID()
  @IsOptional()
  roleId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedIps?: string[];
}

export class UpdateTeamDto {
  @IsString()
  @IsOptional()
  teamNo?: string;

  @IsString()
  @IsOptional()
  teamName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'Phone number must be exactly 10 characters' })
  phone?: string;

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

  @IsEnum(TeamStatus)
  @IsOptional()
  status?: TeamStatus;

  @IsEnum(LoginMethod)
  @IsOptional()
  loginMethod?: LoginMethod;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsUUID()
  @IsOptional()
  roleId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedIps?: string[];
}

export class BulkCreateTeamDto {
  @IsArray()
  @IsNotEmpty()
  teams: CreateTeamDto[];
}

export class BulkUpdateTeamDto {
  @IsArray()
  @IsNotEmpty()
  updates: Array<{ id: string } & UpdateTeamDto>;
}

export class BulkDeleteTeamDto {
  @IsArray()
  @IsNotEmpty()
  ids: string[];
}

export class ChangeStatusDto {
  @IsEnum(TeamStatus)
  status: TeamStatus;
}

export class FilterTeamDto {
  @IsOptional()
  @IsEnum(TeamStatus)
  status?: TeamStatus;

  @IsOptional()
  @IsString()
  clientGroupId?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  subLocationId?: string;

  @IsOptional()
  @IsString()
  subLocationName?: string;

  @IsOptional()
  @IsString()
  teamName?: string;

  @IsOptional()
  @IsString()
  teamNo?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(LoginMethod)
  loginMethod?: LoginMethod;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  role?: string;
}
