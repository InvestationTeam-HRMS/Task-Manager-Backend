import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { NotificationModule } from '../notification/notification.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        NotificationModule,
        forwardRef(() => RedisModule), // For session validation in JwtStrategy
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get('JWT_ACCESS_SECRET'),
                signOptions: {
                    expiresIn: configService.get('JWT_ACCESS_EXPIRATION', '15m'),
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, RolesGuard, SessionAuthGuard],
    exports: [AuthService, JwtStrategy, PassportModule, RolesGuard, SessionAuthGuard],
})
export class AuthModule { }
