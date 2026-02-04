import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

/**
 * 🔐 WhatsApp-Style Session Auth Guard (with Incognito Support)
 *
 * Validates requests using:
 * 1. httpOnly sessionId cookie (primary - most secure)
 * 2. X-Session-Id header (fallback for incognito/cross-origin when cookies are blocked)
 *
 * Backend is the single source of truth - no JWT tokens exposed to JavaScript.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 🔐 HYBRID AUTH: Check cookie first, then X-Session-Id header
    const sessionId =
      request.cookies?.['sessionId'] || request.headers?.['x-session-id'];

    if (!sessionId) {
      throw new UnauthorizedException('No active session');
    }

    const result = await this.authService.validateSessionAndGetUser(sessionId);

    if (!result) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach user to request (similar to how JWT guard works)
    request.user = result.user;
    request.sessionId = sessionId;

    return true;
  }
}
