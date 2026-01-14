import { Controller, Post, Body, Req, UseGuards, Get, Patch } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
    RegisterDto,
    LoginDto,
    VerifyOtpDto,
    RefreshTokenDto,
    ChangePasswordDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    ResendOtpDto,
} from './dto/auth.dto';
import { Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';

@Controller('api/v1/auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('register')
    async register(@Body() dto: RegisterDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.register(dto, ipAddress);
    }

    @Post('verify-otp')
    async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.verifyOtp(dto, ipAddress);
    }

    @Post('login')
    async login(@Body() dto: LoginDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const userAgent = req.headers['user-agent'];
        return this.authService.login(dto, ipAddress, userAgent);
    }

    @Post('refresh')
    async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.refreshTokens(dto, ipAddress);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    async logout(@GetUser('id') userId: string, @Body('sessionId') sessionId: string) {
        return this.authService.logout(userId, sessionId);
    }

    @Patch('change-password')
    @UseGuards(JwtAuthGuard)
    async changePassword(
        @GetUser('id') userId: string,
        @Body() dto: ChangePasswordDto,
        @Req() req: Request,
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.changePassword(userId, dto, ipAddress);
    }

    @Post('forgot-password')
    async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.forgotPassword(dto, ipAddress);
    }

    @Post('reset-password')
    async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.resetPassword(dto, ipAddress);
    }

    @Get('profile')
    @UseGuards(JwtAuthGuard)
    getProfile(@GetUser() user: any) {
        return { user };
    }
}
