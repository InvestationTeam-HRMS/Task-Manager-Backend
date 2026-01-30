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

        if (identity.role === 'SUPER_ADMIN') {
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
