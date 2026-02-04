import { IsString, IsOptional } from 'class-validator';

export class UpdateStickyNoteDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  color?: string;
}
