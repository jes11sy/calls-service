import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export enum UserRole {
  ADMIN = 'admin',
  CALLCENTRE_ADMIN = 'callcentre_admin',
  OPERATOR = 'operator',
  DIRECTOR = 'director',
  MASTER = 'master',
}

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    return requiredRoles.some((role) => user?.role === role);
  }
}





