import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * 🔐 Hybrid Auth Guard
 * 
 * Checks for authentication in this order:
 * 1. SessionId cookie (WhatsApp-style, preferred)
 * 2. JWT Bearer token (legacy/API clients)
 * 
 * For session-based auth, the SessionAuthGuard should be used instead.
 * This guard maintains backward compatibility with JWT tokens.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        
        // Check for sessionId cookie first (WhatsApp-style)
        const sessionId = request.cookies?.['sessionId'];
        if (sessionId) {
            // If sessionId exists, delegate to parent JWT guard
            // The JWT strategy will handle validation
            return super.canActivate(context);
        }

        // Fallback to JWT token
        return super.canActivate(context);
    }

    handleRequest(err: any, user: any, info: any) {
        if (err || !user) {
            throw err || new UnauthorizedException('Authentication required');
        }
        return user;
    }
}
