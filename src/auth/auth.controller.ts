import { Controller, Post, Body, Req, Res, UseGuards, Get, Patch } from '@nestjs/common';
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
            // OTP was skipped - proceed directly to token generation
            const verifyDto: VerifyLoginDto = {
                email: dto.email,
                otp: '', // Not needed when OTP is disabled
            };

            const result = await this.authService.verifyLogin(verifyDto, ipAddress, userAgent);
            this.setCookies(res, result.accessToken, result.refreshToken);

            // Ensure otpSkipped is sent back so FE knows to bypass OTP Screen
            const { accessToken, refreshToken, ...userPart } = result;
            return {
                ...userPart,
                accessToken, // Return for FE persistence
                refreshToken, // Return for FE persistence
                otpSkipped: true
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

        this.setCookies(res, result.accessToken, result.refreshToken);

        const { ...userPart } = result;
        // Return tokens in body too (Hybrid approach for localStorage support)
        return {
            ...userPart,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
        };
    }

    @Post('refresh')
    async refresh(
        @Body() dto: RefreshTokenDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        // Fallback for dto.refreshToken if not provided in body (get from cookie)
        const rfToken = dto.refreshToken || req.cookies['refreshToken'];
        if (!rfToken) {
            throw new Error('Refresh token missing');
        }

        const ipAddress = req.ip || req.socket.remoteAddress || '';
        const result = await this.authService.refreshTokens({ refreshToken: rfToken }, ipAddress);

        this.setCookies(res, result.accessToken, result.refreshToken);

        return { message: 'Token refreshed' };
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    async logout(
        @GetUser('id') userId: string,
        @Body('sessionId') sessionId: string,
        @Res({ passthrough: true }) res: Response
    ) {
        this.clearCookies(res);
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

    @Post('set-password')
    async setPassword(
        @Body() dto: SetPasswordDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ) {
        const ipAddress = req.ip || req.socket.remoteAddress || '';
        // Note: setPassword in auth.service doesn't return tokens yet,
        // but it could. For now we just let them log in manually after setting password.
        return this.authService.setPassword(dto, ipAddress);
    }

    private setCookies(res: Response, accessToken: string, refreshToken: string) {
        const isProduction = process.env.NODE_ENV === 'production';
        const domain = process.env.COOKIE_DOMAIN || 'localhost';

        const cookieOptions: any = {
            httpOnly: true,
            secure: isProduction, // Strict true in production
            sameSite: isProduction ? 'none' : 'lax', // Must be 'none' for cross-site
            maxAge: 30 * 24 * 60 * 60 * 1000,
            path: '/',
        };
        console.log(`[AUTH] Setting cookies. Prod: ${isProduction}, Secure: ${cookieOptions.secure}, SameSite: ${cookieOptions.sameSite}, Domain: ${domain}`);

        // Only set domain if it's NOT localhost to avoid issues on subdomains
        if (domain !== 'localhost') {
            cookieOptions.domain = domain;
        }

        res.cookie('accessToken', accessToken, cookieOptions);
        res.cookie('refreshToken', refreshToken, cookieOptions);
    }

    private clearCookies(res: Response) {
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

        res.clearCookie('accessToken', cookieOptions);
        res.clearCookie('refreshToken', cookieOptions);
    }

    @Get('profile')
    @UseGuards(JwtAuthGuard)
    getProfile(@GetUser() user: any) {
        return {
            user,
            sessionId: user.sessionId
        };
    }
}
