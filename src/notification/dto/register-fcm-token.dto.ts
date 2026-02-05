import { IsString, IsNotEmpty } from 'class-validator';

export class RegisterFcmTokenDto {
    @IsString()
    @IsNotEmpty()
    token: string;
}
