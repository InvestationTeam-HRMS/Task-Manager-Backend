import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  Get,
  Patch,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  VerifyLoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ResendOtpDto,
  SetPasswordDto,
  UpdateProfileDto,
  AdminSetupDto,
} from './dto/auth.dto';
import { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {}

  @Get('setup-status')
  async setupStatus() {
    return this.authService.getSetupStatus();
  }

  @Post('setup-admin')
  async setupAdmin(@Body() dto: AdminSetupDto, @Req() req: Request) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';
    return this.authService.setupAdmin(dto, ipAddress);
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'];

    const loginResult = await this.authService.login(dto, ipAddress, userAgent);

    // If OTP is disabled, session is already created in login()
    if (loginResult.otpSkipped && loginResult.sessionId) {
      // Set ONLY sessionId cookie (WhatsApp-style)
      this.setSessionCookie(res, loginResult.sessionId);

      // Return user data AND sessionId (for incognito/header fallback)
      return {
        user: loginResult.user,
        sessionId: loginResult.sessionId, // 🔐 For incognito mode
        message: 'Login successful',
      };
    }

    // OTP is enabled - return the standard response asking for OTP
    return loginResult;
  }

  @Post('verify-login')
  async verifyLogin(
    @Body() dto: VerifyLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'];
    const result = await this.authService.verifyLogin(
      dto,
      ipAddress,
      userAgent,
    );

    // Set ONLY sessionId cookie (WhatsApp-style)
    this.setSessionCookie(res, result.sessionId);

    // Return user data AND sessionId (for incognito/header fallback)
    return {
      user: result.user,
      sessionId: result.sessionId, // 🔐 For incognito mode
      message: 'Login successful',
    };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 🔐 HYBRID AUTH: Check cookie first, then X-Session-Id header (for incognito)
    const sessionId =
      req.cookies['sessionId'] || (req.headers['x-session-id'] as string);
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
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // 🔐 HYBRID AUTH: Check cookie first, then X-Session-Id header (for incognito)
    const sessionId =
      req.cookies['sessionId'] || (req.headers['x-session-id'] as string);

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
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.socket.remoteAddress || '';
    return this.authService.setPassword(dto, ipAddress);
  }

  /**
   * 🍪 Universal Cookie Configuration
   *
   * Works on ALL environments:
   * - Local Development (localhost)
   * - Same-origin Production (frontend & backend on same domain)
   * - Cross-origin Production (Vercel frontend + Render/Railway/AWS backend)
   *
   * Environment Variables:
   * - COOKIE_SAME_SITE: 'none' | 'lax' | 'strict' (default: auto-detect)
   * - COOKIE_SECURE: 'true' | 'false' (default: auto based on HTTPS)
   * - COOKIE_DOMAIN: '.example.com' for subdomain sharing (optional)
   * - CORS_ORIGIN: Frontend URL(s) for cross-origin detection
   */
  private setSessionCookie(res: Response, sessionId: string) {
    const cookieConfig = this.getCookieConfig();

    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      path: '/',
      ...(cookieConfig.domain && { domain: cookieConfig.domain }),
    });

    this.logger?.log?.(
      `[Cookie] Set: secure=${cookieConfig.secure}, sameSite=${cookieConfig.sameSite}, domain=${cookieConfig.domain || 'auto'}`,
    );
  }

  private clearSessionCookie(res: Response) {
    const cookieConfig = this.getCookieConfig();

    res.clearCookie('sessionId', {
      path: '/',
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      ...(cookieConfig.domain && { domain: cookieConfig.domain }),
    });

    this.logger?.log?.(`[Cookie] Cleared sessionId`);
  }

  /**
   * Auto-detect cookie configuration based on environment
   */
  private getCookieConfig(): {
    secure: boolean;
    sameSite: 'none' | 'lax' | 'strict';
    domain?: string;
  } {
    const isProduction = process.env.NODE_ENV === 'production';
    const corsOrigin = process.env.CORS_ORIGIN || '';
    const backendUrl = process.env.APP_URL || process.env.BACKEND_URL || '';

    // Manual overrides from environment
    const manualSameSite = process.env.COOKIE_SAME_SITE as
      | 'none'
      | 'lax'
      | 'strict'
      | undefined;
    const manualSecure = process.env.COOKIE_SECURE;
    const cookieDomain = process.env.COOKIE_DOMAIN || '';

    // Detect if cross-origin (frontend and backend on different domains)
    const isCrossOrigin = this.detectCrossOrigin(corsOrigin, backendUrl);

    // Determine SameSite
    let sameSite: 'none' | 'lax' | 'strict';
    if (manualSameSite && ['none', 'lax', 'strict'].includes(manualSameSite)) {
      sameSite = manualSameSite;
    } else if (!isProduction) {
      sameSite = 'lax'; // Local development
    } else if (isCrossOrigin) {
      sameSite = 'none'; // Cross-origin production (Vercel + Render)
    } else {
      sameSite = 'lax'; // Same-origin production
    }

    // Determine Secure
    let secure: boolean;
    if (manualSecure !== undefined) {
      secure = manualSecure === 'true';
    } else if (!isProduction) {
      secure = false; // Local development (HTTP)
    } else {
      // Production: always true (HTTPS required)
      // Note: SameSite=None REQUIRES Secure=true
      secure = true;
    }

    // Validate: SameSite=None requires Secure=true
    if (sameSite === 'none' && !secure) {
      this.logger?.warn?.(
        '[Cookie] WARNING: SameSite=None requires Secure=true. Forcing Secure=true.',
      );
      secure = true;
    }

    // Domain (for subdomain sharing like .example.com)
    const domain =
      cookieDomain && cookieDomain !== 'localhost' ? cookieDomain : undefined;

    return { secure, sameSite, domain };
  }

  /**
   * Detect if frontend and backend are on different origins
   */
  private detectCrossOrigin(corsOrigin: string, backendUrl: string): boolean {
    if (!corsOrigin || !backendUrl) return false;

    try {
      const frontendOrigins = corsOrigin.split(',').map((o) => o.trim());
      const backendHost = new URL(backendUrl).hostname;

      // Check if any frontend origin has a different hostname than backend
      for (const origin of frontendOrigins) {
        if (!origin) continue;
        const frontendHost = new URL(origin).hostname;

        // Different hosts = cross-origin
        if (frontendHost !== backendHost) {
          // Check if they share a parent domain (e.g., app.example.com and api.example.com)
          const frontendParts = frontendHost.split('.');
          const backendParts = backendHost.split('.');

          // Get root domains (last 2 parts)
          const frontendRoot = frontendParts.slice(-2).join('.');
          const backendRoot = backendParts.slice(-2).join('.');

          // If root domains are different, it's cross-origin
          if (frontendRoot !== backendRoot) {
            return true;
          }
        }
      }
    } catch (e) {
      // URL parsing failed, assume cross-origin for safety
      return true;
    }

    return false;
  }

  @Get('me')
  async getProfile(@Req() req: Request) {
    // 🔐 HYBRID AUTH: Check cookie first, then X-Session-Id header (for incognito)
    const sessionId =
      req.cookies['sessionId'] || (req.headers['x-session-id'] as string);

    if (!sessionId) {
      throw new UnauthorizedException('No active session');
    }

    const result = await this.authService.validateSessionAndGetUser(sessionId);

    if (!result) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return {
      user: result.user,
      sessionId: result.sessionId, // 🔐 Return sessionId for frontend memory storage
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
