import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_PERMISSIONS } from '../../common/constants/admin-permissions';
import { isAdminRole } from '../../common/utils/role-utils';

/**
 * 🔐 Hybrid Auth Guard (Session + JWT + Header Fallback)
 *
 * Supports THREE authentication methods:
 * 1. Session Cookie (Primary) - httpOnly sessionId cookie
 * 2. X-Session-Id Header (Incognito Fallback) - for browsers blocking third-party cookies
 * 3. JWT Bearer Token (API Fallback) - for API clients/mobile apps
 *
 * Priority:
 * - If sessionId cookie exists → validate session
 * - Else if X-Session-Id header exists → validate session (incognito mode support)
 * - Else if Authorization header exists → validate JWT
 * - Else → throw Unauthorized
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    @Inject(RedisService) private redisService: RedisService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1️⃣ Check for sessionId cookie first (preferred method)
    let sessionId = request.cookies?.['sessionId'];

    // 2️⃣ Fallback to X-Session-Id header (for incognito/cross-origin when cookies are blocked)
    if (!sessionId) {
      sessionId = request.headers?.['x-session-id'];
    }

    if (sessionId) {
      try {
        const user = await this.validateSessionAndGetUser(sessionId);
        if (user) {
          request.user = user;
          request.sessionId = sessionId;
          return true;
        }
      } catch (error) {
        // Session invalid, try JWT fallback
      }
    }

    // 3️⃣ Fallback to JWT Bearer token (for mobile apps/API clients)
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const result = await super.canActivate(context);
        return result as boolean;
      } catch (error) {
        throw new UnauthorizedException('Invalid or expired token');
      }
    }

    // 4️⃣ No valid authentication found
    throw new UnauthorizedException('Authentication required');
  }

  /**
   * Validate session and get user (inline to avoid circular dependency)
   */
  private async validateSessionAndGetUser(sessionId: string): Promise<any> {
    // Check Redis first
    const redisSession = await this.redisService.getSession(sessionId);
    if (redisSession && redisSession.teamId) {
      const user = await this.getUserWithPermissions(redisSession.teamId);
      return user;
    }

    // Fallback to database
    const dbSession = await this.prisma.session.findUnique({
      where: { sessionId },
      include: { team: true },
    });

    if (!dbSession || !dbSession.teamId || dbSession.expiresAt < new Date()) {
      return null;
    }

    const user = await this.getUserWithPermissions(dbSession.teamId);
    return user;
  }

  /**
   * Get user with role permissions
   */
  private async getUserWithPermissions(teamId: string): Promise<any> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        customRole: true,
      },
    });

    if (!team) return null;

    // Parse permissions from role
    let permissions: any = {};
    if (team.customRole?.permissions) {
      try {
        permissions =
          typeof team.customRole.permissions === 'string'
            ? JSON.parse(team.customRole.permissions)
            : team.customRole.permissions;
      } catch (e) {
        permissions = {};
      }
    }

    if (isAdminRole(team.role)) {
      permissions = { ...ADMIN_PERMISSIONS, isSuperAdmin: true };
    }

    return {
      id: team.id,
      odooId: team.teamNo,
      email: team.email,
      userName: team.teamName,
      teamName: team.teamName,
      phone: team.phone,
      avatar: team.avatar,
      role: team.role,
      roleId: team.roleId,
      roleName: team.customRole?.name || null,
      permissions,
      status: team.status,
    };
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
