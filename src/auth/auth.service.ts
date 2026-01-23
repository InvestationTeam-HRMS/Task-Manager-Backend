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
    VerifyLoginDto,
    VerifyOtpDto,
    RefreshTokenDto,
    ChangePasswordDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    OtpChannel,
} from './dto/auth.dto';
import { NotificationService } from '../notification/notification.service';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private redisService: RedisService,
        private notificationService: NotificationService,
    ) { }

    async register(dto: RegisterDto, ipAddress: string) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        // Default to EMAIL
        const channel = OtpChannel.EMAIL;

        // Store registration data locally (Redis) instead of creating user
        const hashedPassword = await bcrypt.hash(
            dto.password,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        const tempUserData = {
            ...dto,
            password: hashedPassword,
            ipAddress,
            otpChannel: channel,
        };

        const ttl = parseInt(this.configService.get('OTP_EXPIRATION', '600'));
        await this.redisService.setTempUser(dto.email, tempUserData, ttl);

        // Generate and send OTP
        const otp = this.generateOTP();
        await this.redisService.setOTP(dto.email, otp, ttl);

        const recipient = dto.email;
        await this.notificationService.sendOtp(recipient, otp, channel);

        return {
            message: `OTP sent to email. Please verify to complete registration.`,
            email: dto.email,
            channel,
        };
    }

    async verifyOtp(dto: VerifyOtpDto, ipAddress: string) {
        const storedOtp = await this.redisService.getOTP(dto.email);
        const tempUser = await this.redisService.getTempUser(dto.email);

        if (!storedOtp || storedOtp !== dto.otp) {
            throw new BadRequestException('Invalid or expired OTP');
        }

        if (!tempUser) {
            throw new BadRequestException('Registration session expired. Please register again.');
        }

        // Create the user now
        const user = await this.prisma.user.create({
            data: {
                email: tempUser.email,
                password: tempUser.password,
                firstName: tempUser.firstName,
                lastName: tempUser.lastName,
                phoneNumber: tempUser.phoneNumber,
                role: UserRole.EMPLOYEE,
                status: UserStatus.Active,
                isEmailVerified: true,
                allowedIps: [ipAddress], // Add verification IP to allowed list (Strict Security)
            } as any,
        });

        await this.redisService.deleteOTP(dto.email);
        await this.redisService.deleteTempUser(dto.email);

        await this.logActivity(user.id, 'CREATE', 'User registered and verified', ipAddress);

        return { message: 'Account created and verified successfully. You can now login.' };
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

        if (user.status !== UserStatus.Active) {
            throw new UnauthorizedException('Account is not active');
        }

        // Check if OTP is enabled via environment variable (default: true)
        const rawOtpConfig = this.configService.get('OTP_ENABLED');
        const otpEnabled = this.configService.get('OTP_ENABLED', 'true') === 'true';

        this.logger.log(`DEBUG: OTP Configuration - Raw: "${rawOtpConfig}", Enabled: ${otpEnabled}`);

        if (!otpEnabled) {
            // OTP is disabled - skip OTP flow and proceed directly to login
            this.logger.log(`OTP disabled - Direct login for ${user.email}`);

            // Enhanced IP Check (User-specific + Global Whitelist)
            const allowedIps = user.allowedIps || [];
            const isUserAllowed = allowedIps.includes(ipAddress);

            let isGloballyAllowed = false;
            if (!isUserAllowed) {
                const globalIp = await this.prisma.ipAddress.findFirst({
                    where: {
                        ipAddress: ipAddress,
                        status: 'Active',
                    },
                });
                isGloballyAllowed = !!globalIp;
            }

            if (!isUserAllowed && !isGloballyAllowed) {
                this.logger.warn(`Blocked login attempt for ${user.email} from unauthorized IP: ${ipAddress}`);
                throw new UnauthorizedException('Access denied. Unrecognized IP address.');
            }

            // Return success with flag indicating OTP was skipped
            return {
                message: 'Login successful (OTP disabled)',
                email: user.email,
                otpSkipped: true,
            };
        }

        // OTP is enabled - use existing OTP flow
        const otp = this.generateOTP();
        const ttl = 300; // 5 mins
        await this.redisService.setLoginOTP(user.email, otp, ttl);

        this.logger.log(`Login OTP for ${user.email}: ${otp}`);

        // Send the OTP to the user's email
        await this.notificationService.sendOtp(user.email, otp, OtpChannel.EMAIL);

        return {
            message: 'Credentials verified. OTP has been sent to your email. Please verify to complete login.',
            email: user.email,
            otpSkipped: false,
        };
    }

    async verifyLogin(dto: VerifyLoginDto, ipAddress: string, userAgent?: string) {
        // Check if OTP is enabled via environment variable (default: true)
        const otpEnabled = this.configService.get('OTP_ENABLED', 'true') === 'true';

        if (otpEnabled) {
            // OTP is enabled - validate OTP
            const storedOtp = await this.redisService.getLoginOTP(dto.email);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new UnauthorizedException('Invalid or expired OTP');
            }
        } else {
            // OTP is disabled - skip OTP validation
            this.logger.log(`OTP disabled - Skipping OTP validation for ${dto.email}`);
        }

        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        // Enhanced IP Check (User-specific + Global Whitelist)
        const allowedIps = user.allowedIps || [];
        const isUserAllowed = allowedIps.includes(ipAddress);

        let isGloballyAllowed = false;
        if (!isUserAllowed) {
            const globalIp = await this.prisma.ipAddress.findFirst({
                where: {
                    ipAddress: ipAddress,
                    status: 'Active',
                },
            });
            isGloballyAllowed = !!globalIp;
        }

        if (!isUserAllowed && !isGloballyAllowed) {
            this.logger.warn(`Blocked login attempt for ${user.email} from unauthorized IP: ${ipAddress}`);
            throw new UnauthorizedException('Access denied. Unrecognized IP address.');
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
        const refreshExpiry = 30 * 24 * 60 * 60; // 30 days
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

        // Clean up OTP if it was used
        if (otpEnabled) {
            await this.redisService.deleteLoginOTP(user.email);
        }

        // Update last login
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ipAddress,
            },
        });

        const loginMethod = otpEnabled ? 'OTP' : 'Direct (OTP disabled)';
        await this.logActivity(user.id, 'LOGIN', `User logged in via ${loginMethod}`, ipAddress);

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
        const refreshExpiry = 30 * 24 * 60 * 60; // 30 days
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
