import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import * as PassportJWT from 'passport-jwt';
const { ExtractJwt, Strategy } = PassportJWT;
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                ExtractJwt.fromAuthHeaderAsBearerToken(),
                (request: any) => {
                    return request?.cookies?.['accessToken'] || request?.query?.token;
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
        })
    }

    async validate(payload: any) {
        const identity = await this.prisma.team.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
                roleId: true,
                status: true,
                isEmailVerified: true,
                firstName: true,
                lastName: true,
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
            throw new UnauthorizedException('Account not found or inactive');
        }

        // Get permissions from custom role if assigned, otherwise empty
        const permissions: any = identity.customRole?.permissions || {};

        // Fallback: If no custom role permissions, assign default based on ENUM role
        if (Object.keys(permissions).length === 0) {
            if (identity.role === 'ADMIN' || identity.role === 'MANAGER' || identity.role === 'HR') {
                permissions['organization'] = ['add', 'view', 'edit', 'delete']
                permissions['project'] = ['add', 'view', 'edit', 'delete']
                permissions['task'] = ['add', 'view', 'edit', 'delete']
                permissions['users'] = ['add', 'view', 'edit', 'delete']
                permissions['group'] = ['add', 'view', 'edit', 'delete']
                permissions['ip_address'] = ['add', 'view', 'edit', 'delete']
            }
        }

        if (identity.role === 'ADMIN') {
            permissions.isSuperAdmin = true;
        }

        return {
            ...identity,
            sessionId: payload.sid,
            permissions,
            roleName: identity.customRole?.name || identity.role,
        };
    }
}
