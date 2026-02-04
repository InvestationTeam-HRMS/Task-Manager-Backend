import {
  IsEnum,
  IsNotEmpty,
  IsUUID,
  IsString,
  IsOptional,
} from 'class-validator';
import { AcceptanceStatus } from '@prisma/client';

export class UpdateTaskAcceptanceDto {
  @IsEnum(AcceptanceStatus)
  @IsNotEmpty()
  status: AcceptanceStatus;

  @IsString()
  @IsOptional()
  remark?: string;
}

export class TaskAcceptanceQueryDto {
  @IsUUID()
  @IsOptional()
  taskId?: string;

  @IsEnum(AcceptanceStatus)
  @IsOptional()
  status?: AcceptanceStatus;
}
