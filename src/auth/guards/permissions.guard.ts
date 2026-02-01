import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
// Removed UserRole import from @prisma/client

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true;
        }

        const { user } = context.switchToHttp().getRequest();

        if (!user) {
            return false;
        }

        // Admin check
        if (user.role?.toUpperCase() === 'ADMIN') {
            return true;
        }

        const userPermissions = user.permissions || {};

        const hasPermission = requiredPermissions.every((permission) => {
            const [module, action] = permission.split(':');

            // Check if user has explicit 'all' permission for this action
            if (userPermissions.all?.includes(action)) {
                return true;
            }

            // Check module specific permission
            const modulePermissions = userPermissions[module];
            return Array.isArray(modulePermissions) && modulePermissions.includes(action);
        });

        if (!hasPermission) {
            throw new ForbiddenException('You do not have the required permissions to perform this action');
        }

        return true;
    }
}
