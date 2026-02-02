import { Controller, Post, Body, Req, Res, UseGuards, Get, Patch, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
    RegisterDto,
    LoginDto,
    VerifyLoginDto,
    VerifyOtpDto,
    RefreshTokenDto,
    ChangePasswordDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    ResendOtpDto,
    SetPasswordDto,
    UpdateProfileDto,
} from './dto/auth.dto';
import { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';

@Controller('auth')
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
    async login(
        @Body() dto: LoginDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const userAgent = req.headers['user-agent'];

        const loginResult = await this.authService.login(dto, ipAddress, userAgent);

        // If OTP is disabled, automatically complete the login flow
        if (loginResult.otpSkipped) {
            // OTP was skipped - proceed directly to session creation
            const verifyDto: VerifyLoginDto = {
                email: dto.email,
                otp: '', // Not needed when OTP is disabled
            };

            const result = await this.authService.verifyLogin(verifyDto, ipAddress, userAgent);

            // Set ONLY sessionId cookie (WhatsApp-style)
            this.setSessionCookie(res, result.sessionId);

            // Return user data ONLY (no tokens)
            return {
                user: result.user,
                message: 'Login successful'
            };
        }

        // OTP is enabled - return the standard response asking for OTP
        return loginResult;
    }

    @Post('verify-login')
    async verifyLogin(
        @Body() dto: VerifyLoginDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const userAgent = req.headers['user-agent'];
        const result = await this.authService.verifyLogin(dto, ipAddress, userAgent);

        // Set ONLY sessionId cookie (WhatsApp-style)
        this.setSessionCookie(res, result.sessionId);

        // Return user data ONLY (no tokens)
        return {
            user: result.user,
            message: 'Login successful'
        };
    }

    @Post('refresh')
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const sessionId = req.cookies['sessionId'];
        if (!sessionId) {
            throw new Error('Session not found');
        }

        const session = await this.authService.validateSession(sessionId);
        if (!session) {
            throw new Error('Invalid session');
        }

        return { message: 'Session is valid' };
    }

    @Post('logout')
    async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const sessionId = req.cookies['sessionId'];

        if (sessionId) {
            await this.authService.logoutBySession(sessionId);
        }

        this.clearSessionCookie(res);

        return { message: 'Logged out successfully' };
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

    @Post('set-password')
    async setPassword(
        @Body() dto: SetPasswordDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.setPassword(dto, ipAddress);
    }

    private setSessionCookie(res: Response, sessionId: string) {
        const isProduction = process.env.NODE_ENV === 'production';
        const domain = process.env.COOKIE_DOMAIN || 'localhost';

        const cookieOptions: any = {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: 365 * 24 * 60 * 60 * 1000,
            path: '/',
        };

        if (domain !== 'localhost') {
            cookieOptions.domain = domain;
        }

        res.cookie('sessionId', sessionId, cookieOptions);
    }

    private clearSessionCookie(res: Response) {
        const isProduction = process.env.NODE_ENV === 'production';
        const domain = process.env.COOKIE_DOMAIN || 'localhost';

        const cookieOptions: any = {
            path: '/',
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
        };

        if (domain !== 'localhost') {
            cookieOptions.domain = domain;
        }

        res.clearCookie('sessionId', cookieOptions);
    }

    @Get('me')
    async getProfile(
        @Req() req: Request
    ) {
        const sessionId = req.cookies['sessionId'];

        if (!sessionId) {
            throw new UnauthorizedException('No active session');
        }

        const result = await this.authService.validateSessionAndGetUser(sessionId);

        if (!result) {
            throw new UnauthorizedException('Invalid or expired session');
        }

        return {
            user: result.user,
            sessionId: result.sessionId
        };
    }

    @Patch('profile')
    @UseGuards(JwtAuthGuard)
    async updateProfile(
        @GetUser('id') userId: string,
        @Body() dto: UpdateProfileDto,
        @Req() req: Request,
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        return this.authService.updateProfile(userId, dto, ipAddress);
    }

    @Get('refresh-permissions')
    @UseGuards(JwtAuthGuard)
    async refreshPermissions(@GetUser('id') userId: string) {
        return this.authService.getUserWithPermissions(userId);
    }
}
