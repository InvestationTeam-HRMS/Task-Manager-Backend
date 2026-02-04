import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateStickyNoteDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  color?: string;
}
