import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const url = request.url;
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const identity = request.user;
    if (!identity) {
      this.logger.warn(
        `[RolesGuard] No user identity found for ${request.method} ${url}`,
      );
      return false;
    }

    const userRoleUpper = identity.role?.toUpperCase();
    const requiredRolesUpper = requiredRoles.map((r) => r.toUpperCase());
    const hasPermission = requiredRolesUpper.includes(userRoleUpper);

    if (!hasPermission) {
      this.logger.warn(
        `[RolesGuard] ACCESS DENIED: User "${identity.email}" with role "${identity.role}" tried to access ${request.method} ${url}. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return hasPermission;
  }
}
