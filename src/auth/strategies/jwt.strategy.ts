import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import * as PassportJWT from 'passport-jwt';
const { ExtractJwt, Strategy } = PassportJWT;
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ADMIN_PERMISSIONS } from '../../common/constants/admin-permissions';
import { isAdminRole } from '../../common/utils/role-utils';

/**
 * 🔐 WhatsApp-Style JWT Strategy (with Incognito Support)
 *
 * Validates using (in order of priority):
 * 1. SessionId cookie -> validates session in Redis/DB, then loads user
 * 2. X-Session-Id header -> validates session (incognito/cross-origin fallback)
 * 3. Bearer token (legacy) -> validates JWT and loads user
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Extract from Authorization header (legacy API clients)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Extract from accessToken cookie (legacy)
        (request: any) => {
          return request?.cookies?.['accessToken'] || request?.query?.token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
      passReqToCallback: true, // We need request for session-based auth
    });
  }

  async validate(request: any, payload: any) {
    // 🔐 HYBRID AUTH: Check cookie first, then X-Session-Id header (for incognito)
    const sessionId =
      request?.cookies?.['sessionId'] || request?.headers?.['x-session-id'];

    if (sessionId) {
      // Session-based authentication
      const sessionData = await this.validateSession(sessionId);
      if (sessionData) {
        const user = await this.loadUser(sessionData.teamId);
        if (user) {
          return { ...user, sessionId };
        }
      }
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Fallback to JWT payload-based authentication
    const identity = await this.loadUser(payload.sub);

    if (!identity) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    return {
      ...identity,
      sessionId: payload.sid,
    };
  }

  private async validateSession(sessionId: string): Promise<any> {
    // First try Redis
    let sessionData = await this.redisService.getSession(sessionId);

    if (!sessionData) {
      // Fallback to database
      const dbSession = await this.prisma.session.findUnique({
        where: { sessionId },
        include: { team: true },
      });

      if (
        !dbSession ||
        !dbSession.isActive ||
        dbSession.expiresAt < new Date()
      ) {
        return null;
      }

      // Cache in Redis for future requests
      sessionData = {
        teamId: dbSession.teamId,
        email: dbSession.team?.email || '',
        role: dbSession.team?.role || '',
      };

      const sessionExpiry = Math.floor(
        (dbSession.expiresAt.getTime() - Date.now()) / 1000,
      );
      if (sessionExpiry > 0) {
        await this.redisService.setSession(
          sessionId,
          sessionData,
          sessionExpiry,
        );
      }
    }

    return sessionData;
  }

  private async loadUser(userId: string) {
    const identity = await this.prisma.team.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        roleId: true,
        status: true,
        isEmailVerified: true,
        phone: true,
        avatar: true,
        address: true,
        city: true,
        postcode: true,
        country: true,
        teamName: true,
        customRole: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    });

    if (!identity || identity.status !== 'Active') {
      return null;
    }

    // Get permissions from custom role if assigned, otherwise empty
    let permissions: any = {};

    if (identity.customRole?.permissions) {
      try {
        permissions =
          typeof identity.customRole.permissions === 'string'
            ? JSON.parse(identity.customRole.permissions)
            : identity.customRole.permissions;
      } catch {
        permissions = {};
      }
    }

    if (isAdminRole(identity.role)) {
      permissions = { ...ADMIN_PERMISSIONS, isSuperAdmin: true };
    } else if (Object.keys(permissions).length === 0) {
      const roleUpper = identity.role?.toUpperCase?.() || '';
      if (roleUpper === 'MANAGER' || roleUpper === 'HR') {
        permissions['organization'] = ['add', 'view', 'edit', 'delete'];
        permissions['project'] = ['add', 'view', 'edit', 'delete'];
        permissions['task'] = ['add', 'view', 'edit', 'delete'];
        permissions['users'] = ['add', 'view', 'edit', 'delete'];
        permissions['group'] = ['add', 'view', 'edit', 'delete'];
        permissions['ip_address'] = ['add', 'view', 'edit', 'delete'];
      }
    }

    return {
      ...identity,
      permissions,
      roleName: identity.customRole?.name || identity.role,
    };
  }
}
