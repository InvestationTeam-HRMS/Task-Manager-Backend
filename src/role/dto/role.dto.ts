import { IsString, IsOptional, IsNotEmpty, IsObject } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  description?: any;

  @IsOptional()
  permissions?: any;

  @IsOptional()
  accessRight?: any;
}

export class UpdateRoleDto {
  @IsOptional()
  name?: any;

  @IsOptional()
  description?: any;

  @IsOptional()
  permissions?: any;

  @IsOptional()
  accessRight?: any;
}
