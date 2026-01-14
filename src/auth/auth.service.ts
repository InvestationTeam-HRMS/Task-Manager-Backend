import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import {
    RegisterDto,
    LoginDto,
    VerifyOtpDto,
    RefreshTokenDto,
    ChangePasswordDto,
    ForgotPasswordDto,
    ResetPasswordDto,
} from './dto/auth.dto';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private redisService: RedisService,
    ) { }

    async register(dto: RegisterDto, ipAddress: string) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        const hashedPassword = await bcrypt.hash(
            dto.password,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                password: hashedPassword,
                firstName: dto.firstName,
                lastName: dto.lastName,
                role: UserRole.EMPLOYEE,
                status: UserStatus.PENDING_VERIFICATION,
            },
        });

        // Generate and send OTP
        const otp = this.generateOTP();
        await this.redisService.setOTP(
            user.email,
            otp,
            parseInt(this.configService.get('OTP_EXPIRATION', '600')),
        );

        // Log activity
        await this.logActivity(user.id, 'CREATE', 'User registered', ipAddress);

        this.logger.log(`OTP for ${user.email}: ${otp}`); // In production, send via email

        return {
            message: 'Registration successful. Please verify your email with OTP.',
            userId: user.id,
            email: user.email,
        };
    }

    async verifyOtp(dto: VerifyOtpDto, ipAddress: string) {
        const storedOtp = await this.redisService.getOTP(dto.email);

        if (!storedOtp || storedOtp !== dto.otp) {
            throw new BadRequestException('Invalid or expired OTP');
        }

        const user = await this.prisma.user.update({
            where: { email: dto.email },
            data: {
                isEmailVerified: true,
                status: UserStatus.ACTIVE,
            },
        });

        await this.redisService.deleteOTP(dto.email);
        await this.logActivity(user.id, 'OTP_VERIFICATION', 'Email verified', ipAddress);

        return { message: 'Email verified successfully' };
    }

    async login(dto: LoginDto, ipAddress: string, userAgent?: string) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user || user.deletedAt) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException('Account is not active');
        }

        if (!user.isEmailVerified) {
            throw new UnauthorizedException('Email not verified');
        }

        // Generate tokens
        const { accessToken, refreshToken } = await this.generateTokens(user.id, user.email, user.role);

        // Create session
        const sessionId = uuidv4();
        const sessionExpiry = parseInt(this.configService.get('SESSION_EXPIRATION', '2592000000')) / 1000;

        await this.prisma.session.create({
            data: {
                sessionId,
                userId: user.id,
                ipAddress,
                userAgent,
                expiresAt: new Date(Date.now() + sessionExpiry * 1000),
            },
        });

        await this.redisService.setSession(
            sessionId,
            { userId: user.id, email: user.email, role: user.role },
            sessionExpiry,
        );

        // Store refresh token
        const refreshExpiry = 7 * 24 * 60 * 60; // 7 days
        await this.prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt: new Date(Date.now() + refreshExpiry * 1000),
                ipAddress,
                userAgent,
            },
        });

        await this.redisService.setRefreshToken(refreshToken, user.id, refreshExpiry);

        // Update last login
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ipAddress,
            },
        });

        await this.logActivity(user.id, 'LOGIN', 'User logged in', ipAddress);

        return {
            accessToken,
            refreshToken,
            sessionId,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
        };
    }

    async refreshTokens(dto: RefreshTokenDto, ipAddress: string) {
        const storedUserId = await this.redisService.getRefreshToken(dto.refreshToken);

        if (!storedUserId) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const tokenRecord = await this.prisma.refreshToken.findUnique({
            where: { token: dto.refreshToken },
            include: { user: true },
        });

        if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        // Revoke old token
        await this.prisma.refreshToken.update({
            where: { token: dto.refreshToken },
            data: { isRevoked: true, revokedAt: new Date() },
        });
        await this.redisService.deleteRefreshToken(dto.refreshToken);

        // Generate new tokens
        const { accessToken, refreshToken } = await this.generateTokens(
            tokenRecord.user.id,
            tokenRecord.user.email,
            tokenRecord.user.role,
        );

        // Store new refresh token
        const refreshExpiry = 7 * 24 * 60 * 60;
        await this.prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: tokenRecord.user.id,
                expiresAt: new Date(Date.now() + refreshExpiry * 1000),
                ipAddress,
                replacedBy: dto.refreshToken,
            },
        });

        await this.redisService.setRefreshToken(refreshToken, tokenRecord.user.id, refreshExpiry);

        return { accessToken, refreshToken };
    }

    async logout(userId: string, sessionId: string) {
        await this.prisma.session.update({
            where: { sessionId },
            data: { isActive: false },
        });

        await this.redisService.deleteSession(sessionId);
        await this.logActivity(userId, 'LOGOUT', 'User logged out', '');

        return { message: 'Logged out successfully' };
    }

    async changePassword(userId: string, dto: ChangePasswordDto, ipAddress: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new BadRequestException('User not found');
        }

        const isOldPasswordValid = await bcrypt.compare(dto.oldPassword, user.password);
        if (!isOldPasswordValid) {
            throw new BadRequestException('Old password is incorrect');
        }

        const hashedPassword = await bcrypt.hash(
            dto.newPassword,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                password: hashedPassword,
                passwordChangedAt: new Date(),
            },
        });

        await this.logActivity(userId, 'PASSWORD_CHANGE', 'Password changed', ipAddress);

        return { message: 'Password changed successfully' };
    }

    async forgotPassword(dto: ForgotPasswordDto, ipAddress: string) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            // Don't reveal if email exists
            return { message: 'If email exists, OTP has been sent' };
        }

        const otp = this.generateOTP();
        await this.redisService.setOTP(
            user.email,
            otp,
            parseInt(this.configService.get('OTP_EXPIRATION', '600')),
        );

        this.logger.log(`Password reset OTP for ${user.email}: ${otp}`);

        return { message: 'If email exists, OTP has been sent' };
    }

    async resetPassword(dto: ResetPasswordDto, ipAddress: string) {
        const storedOtp = await this.redisService.getOTP(dto.email);

        if (!storedOtp || storedOtp !== dto.otp) {
            throw new BadRequestException('Invalid or expired OTP');
        }

        const hashedPassword = await bcrypt.hash(
            dto.newPassword,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        const user = await this.prisma.user.update({
            where: { email: dto.email },
            data: {
                password: hashedPassword,
                passwordChangedAt: new Date(),
            },
        });

        await this.redisService.deleteOTP(dto.email);
        await this.logActivity(user.id, 'PASSWORD_CHANGE', 'Password reset', ipAddress);

        return { message: 'Password reset successfully' };
    }

    private async generateTokens(userId: string, email: string, role: UserRole) {
        const payload = { sub: userId, email, role };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get('JWT_ACCESS_SECRET'),
            expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', '15m'),
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get('JWT_REFRESH_SECRET'),
            expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', '7d'),
        });

        return { accessToken, refreshToken };
    }

    private generateOTP(): string {
        const length = parseInt(this.configService.get('OTP_LENGTH', '6'));
        return Math.floor(Math.random() * Math.pow(10, length))
            .toString()
            .padStart(length, '0');
    }

    private async logActivity(userId: string, type: string, description: string, ipAddress: string) {
        await this.prisma.activityLog.create({
            data: {
                userId,
                type: type as any,
                description,
                ipAddress,
            },
        });
    }
}
