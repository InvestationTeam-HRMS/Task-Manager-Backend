import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';

export enum OtpChannel {
    EMAIL = 'EMAIL',
    SMS = 'SMS'
}

export class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(4)
    password: string;

    @IsString()
    firstName: string;

    @IsString()
    lastName: string;

    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @IsEnum(OtpChannel)
    @IsOptional()
    otpChannel?: OtpChannel;
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

export class VerifyOtpDto {
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
    otp: string;

    @IsString()
    @MinLength(4)
    newPassword: string;
}
