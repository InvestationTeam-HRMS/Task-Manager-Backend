import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { isAdminRole } from '../../common/utils/role-utils';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return false;
    }

    // Admin check - full access
    if (isAdminRole(user.role)) {
      return true;
    }

    const userPermissions = user.permissions || {};

    const getModulePermissions = (module: string) => {
      let modulePermissions = userPermissions[module];
      if (!modulePermissions) {
        const key = Object.keys(userPermissions).find(
          (k) => k.toLowerCase() === module.toLowerCase(),
        );
        if (key) {
          modulePermissions = userPermissions[key];
        }
      }
      return modulePermissions;
    };

    const hasTeamAccess = () => {
      const teamPermissions = getModulePermissions('team');
      if (!teamPermissions) return false;
      if (teamPermissions === true) return true;
      if (Array.isArray(teamPermissions)) {
        const lower = teamPermissions.map((p) => p.toLowerCase());
        return (
          lower.includes('create') ||
          lower.includes('add') ||
          lower.includes('edit') ||
          lower.includes('update') ||
          lower.includes('view') ||
          lower.includes('read') ||
          lower.includes('write')
        );
      }
      if (typeof teamPermissions === 'object') {
        return (
          teamPermissions.read === true ||
          teamPermissions.write === true ||
          teamPermissions.create === true ||
          teamPermissions.add === true ||
          teamPermissions.view === true
        );
      }
      return false;
    };

    const hasPermission = requiredPermissions.every((permission) => {
      const [module, action] = permission.split(':');

      // Check if user has global permissions
      if (userPermissions.all === true) {
        return true;
      }

      // Allow role list for team creators/viewers (needed for team assignment)
      if (permission === 'rbac:view' && hasTeamAccess()) {
        return true;
      }

      // Get module permissions - handle both old array format and new object format
      const modulePermissions = getModulePermissions(module);

      // If no permissions for this module
      if (!modulePermissions) {
        return false;
      }

      // Handle old array format (backward compatibility)
      if (Array.isArray(modulePermissions)) {
        // Direct match
        if (modulePermissions.includes(action)) {
          return true;
        }
        // Synonym check
        if (
          (action === 'create' && modulePermissions.includes('add')) ||
          (action === 'add' && modulePermissions.includes('create'))
        ) {
          return true;
        }
        // View permission when user has any action
        if (action === 'view' && modulePermissions.length > 0) {
          return true;
        }
        return false;
      }

      // Handle new object format: { read: true, write: false, delete: true }
      if (typeof modulePermissions === 'object') {
        switch (action) {
          case 'view':
          case 'read':
            return modulePermissions.read === true;
          case 'add':
          case 'create':
          case 'edit':
          case 'update':
          case 'write':
            return modulePermissions.write === true;
          case 'delete':
            return modulePermissions.delete === true;
          default:
            // For any other actions, check if property exists and is true
            return modulePermissions[action] === true;
        }
      }

      return false;
    });

    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have the required permissions to perform this action',
      );
    }

    return true;
  }
}
