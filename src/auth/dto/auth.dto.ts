import { IsEmail, IsString, MinLength, IsOptional, IsEnum, Length } from 'class-validator';

export enum OtpChannel {
    EMAIL = 'EMAIL'
}

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}

export class VerifyLoginDto {
    @IsEmail()
    email: string;

    @IsString()
    otp: string;
}



export class ResendOtpDto {
    @IsEmail()
    email: string;
}

export class RefreshTokenDto {
    @IsString()
    refreshToken: string;
}

export class ChangePasswordDto {
    @IsString()
    oldPassword: string;

    @IsString()
    @MinLength(4)
    newPassword: string;
}

export class ForgotPasswordDto {
    @IsEmail()
    email: string;
}

export class ResetPasswordDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsOptional()
    otp?: string;

    @IsString()
    @MinLength(4)
    newPassword: string;
}

export class SetPasswordDto {
    @IsEmail()
    email: string;

    @IsString()
    token: string;

    @IsString()
    @MinLength(6)
    password: string;
}

export class UpdateProfileDto {
    @IsString()
    @IsOptional()
    teamName?: string;

    @IsString()
    @IsOptional()
    @Length(10, 10, { message: 'Phone number must be exactly 10 characters' })
    phone?: string;

    @IsString()
    @IsOptional()
    avatar?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    city?: string;

    @IsString()
    @IsOptional()
    postcode?: string;

    @IsString()
    @IsOptional()
    country?: string;
}
