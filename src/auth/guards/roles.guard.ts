import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';


@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

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
            return false;
        }

        const userRoleUpper = identity.role?.toUpperCase();
        const hasPermission = requiredRoles.map(r => r.toUpperCase()).includes(userRoleUpper);

        return hasPermission;
    }
}
