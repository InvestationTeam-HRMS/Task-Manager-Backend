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
import { UserRole } from '@prisma/client';

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
        const existingTeam = await this.prisma.team.findUnique({
            where: { email: dto.email },
        });

        if (existingTeam) {
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

        // Create the team now
        const team = await this.prisma.team.create({
            data: {
                teamName: `${tempUser.firstName} ${tempUser.lastName}`,
                teamNo: `TM-${Date.now()}`, // Temporary or auto-generated
                email: tempUser.email,
                password: tempUser.password,
                phone: tempUser.phoneNumber,
                role: UserRole.EMPLOYEE,
                taskAssignPermission: 'EMPLOYEE',
                status: 'Active',
                isEmailVerified: true,
                allowedIps: [ipAddress],
            },
        });

        await this.redisService.deleteOTP(dto.email);
        await this.redisService.deleteTempUser(dto.email);

        await this.logActivity(team.id, 'CREATE', 'Team registered and verified', ipAddress, true);

        return { message: 'Account created and verified successfully. You can now login.' };
    }

    async login(dto: LoginDto, ipAddress: string, userAgent?: string) {
        const identity = await this.prisma.team.findUnique({
            where: { email: dto.email },
        });

        if (!identity || identity.deletedAt) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, identity.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (identity.status !== 'Active') {
            throw new UnauthorizedException('Account is not active');
        }

        const otpEnabledSetting = this.configService.get('OTP_ENABLED', 'true') === 'true';
        const isAdmin = identity.role === UserRole.ADMIN || identity.role === UserRole.SUPER_ADMIN;

        // Skip OTP if disabled in settings OR if user is an ADMIN
        if (!otpEnabledSetting || isAdmin) {
            const reason = isAdmin ? 'Admin role bypass' : 'OTP disabled in settings';
            this.logger.log(`[AUTH] Skipping OTP for ${identity.email} (${reason})`);

            // Enhanced IP Check (User-specific + Global Whitelist)
            const allowedIps = identity.allowedIps || [];
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
                this.logger.warn(`Blocked login attempt for ${identity.email} from unauthorized IP: ${ipAddress}`);
                throw new UnauthorizedException('Access denied. Unrecognized IP address.');
            }

            // Create session and generate tokens for OTP bypass
            const sessionId = uuidv4();
            const sessionExpiry = parseInt(this.configService.get('SESSION_EXPIRATION', '2592000000')) / 1000;
            const { accessToken, refreshToken } = await this.generateTokens(identity.id, identity.email as string, identity.role, sessionId);

            await this.prisma.session.create({
                data: {
                    sessionId,
                    teamId: identity.id,
                    ipAddress,
                    userAgent,
                    expiresAt: new Date(Date.now() + sessionExpiry * 1000),
                },
            });

            await this.redisService.setSession(
                sessionId,
                { teamId: identity.id, email: identity.email, role: identity.role },
                sessionExpiry,
            );

            // Store last login
            await this.prisma.team.update({
                where: { id: identity.id },
                data: {
                    lastLoginAt: new Date(),
                    lastLoginIp: ipAddress,
                },
            });

            await this.logActivity(identity.id, 'LOGIN', `Account logged in (OTP bypassed: ${reason})`, ipAddress, true);

            // Return success with flag indicating OTP was skipped AND tokens/user data
            return {
                message: `Login successful (${reason})`,
                email: identity.email,
                otpSkipped: true,
                accessToken,
                refreshToken,
                sessionId,
                user: {
                    id: identity.id,
                    email: identity.email,
                    firstName: identity.firstName,
                    lastName: identity.lastName,
                    role: identity.role,
                    isTeam: true,
                },
            };
        }

        // OTP is enabled - use existing OTP flow
        const otp = this.generateOTP();
        const ttl = 300; // 5 mins
        await this.redisService.setLoginOTP(identity.email, otp, ttl);

        this.logger.log(`Login OTP for ${identity.email}: ${otp}`);

        // Send the OTP to the team's email
        await this.notificationService.sendOtp(identity.email, otp, OtpChannel.EMAIL);

        return {
            message: 'Credentials verified. OTP has been sent to your email. Please verify to complete login.',
            email: identity.email,
            otpSkipped: false,
        };
    }

    async verifyLogin(dto: VerifyLoginDto, ipAddress: string, userAgent?: string) {
        const identity = await this.prisma.team.findUnique({
            where: { email: dto.email },
        });

        if (!identity) {
            throw new UnauthorizedException('Account not found');
        }

        // Check if OTP is enabled via environment variable (default: true)
        const otpEnabledSetting = this.configService.get('OTP_ENABLED', 'true') === 'true';
        const isAdmin = identity.role === UserRole.ADMIN || identity.role === UserRole.SUPER_ADMIN;

        if (otpEnabledSetting && !isAdmin) {
            // OTP is enabled and user is NOT an admin - validate OTP
            const storedOtp = await this.redisService.getLoginOTP(dto.email);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new UnauthorizedException('Invalid or expired OTP');
            }
            this.logger.log(`[AUTH] OTP verified for ${dto.email}`);
        } else {
            // OTP is disabled OR user is an admin - skip OTP validation
            const reason = isAdmin ? 'Admin role bypass' : 'OTP disabled in settings';
            this.logger.log(`[AUTH] Skipping OTP validation for ${dto.email} (${reason})`);
        }

        // Enhanced IP Check (User-specific + Global Whitelist)
        const allowedIps = identity.allowedIps || [];
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
            this.logger.warn(`Blocked login attempt for ${identity.email} from unauthorized IP: ${ipAddress}`);
            throw new UnauthorizedException('Access denied. Unrecognized IP address.');
        }

        // Create session
        const sessionId = uuidv4();
        const sessionExpiry = parseInt(this.configService.get('SESSION_EXPIRATION', '2592000000')) / 1000;

        // Generate tokens with sessionId
        const { accessToken, refreshToken } = await this.generateTokens(identity.id, identity.email as string, identity.role, sessionId);

        await this.prisma.session.create({
            data: {
                sessionId,
                teamId: identity.id,
                ipAddress,
                userAgent,
                expiresAt: new Date(Date.now() + sessionExpiry * 1000),
            },
        });

        await this.redisService.setSession(
            sessionId,
            { teamId: identity.id, email: identity.email, role: identity.role },
            sessionExpiry,
        );

        // Store refresh token
        const refreshExpiry = 30 * 24 * 60 * 60; // 30 days
        await this.prisma.refreshToken.create({
            data: {
                token: refreshToken,
                teamId: identity.id,
                expiresAt: new Date(Date.now() + refreshExpiry * 1000),
                ipAddress,
                userAgent,
            },
        });

        await this.redisService.setRefreshToken(refreshToken, identity.id, refreshExpiry);

        // Clean up OTP if it was used
        if (otpEnabledSetting && !isAdmin) {
            await this.redisService.deleteLoginOTP(identity.email);
        }

        // Update last login
        await this.prisma.team.update({
            where: { id: identity.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ipAddress,
            },
        });

        const loginMethod = (otpEnabledSetting && !isAdmin) ? 'OTP' : 'Direct (OTP disabled/Admin bypass)';
        await this.logActivity(identity.id, 'LOGIN', `Account logged in via ${loginMethod}`, ipAddress, true);

        return {
            accessToken,
            refreshToken,
            sessionId,
            user: {
                id: identity.id,
                email: identity.email,
                firstName: identity.firstName,
                lastName: identity.lastName,
                role: identity.role,
                isTeam: true,
            },
        };
    }

    async refreshTokens(dto: RefreshTokenDto, ipAddress: string) {
        const storedTeamId = await this.redisService.getRefreshToken(dto.refreshToken);

        if (!storedTeamId) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const tokenRecord = await this.prisma.refreshToken.findUnique({
            where: { token: dto.refreshToken },
            include: { team: true },
        });

        if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        if (!tokenRecord.team) {
            throw new UnauthorizedException('Invalid token owner');
        }

        // Revoke old token
        await this.prisma.refreshToken.update({
            where: { token: dto.refreshToken },
            data: { isRevoked: true, revokedAt: new Date() },
        });
        await this.redisService.deleteRefreshToken(dto.refreshToken);

        // Generate new tokens
        const { accessToken, refreshToken } = await this.generateTokens(
            tokenRecord.team.id,
            tokenRecord.team.email as string,
            tokenRecord.team.role,
        );

        // Store new refresh token
        const refreshExpiry = 30 * 24 * 60 * 60; // 30 days
        await this.prisma.refreshToken.create({
            data: {
                token: refreshToken,
                teamId: tokenRecord.team.id,
                expiresAt: new Date(Date.now() + refreshExpiry * 1000),
                ipAddress,
                replacedBy: dto.refreshToken,
            },
        });

        await this.redisService.setRefreshToken(refreshToken, tokenRecord.team.id, refreshExpiry);

        return { accessToken, refreshToken };
    }

    async logout(teamId: string, sessionId: string) {
        await this.prisma.session.update({
            where: { sessionId },
            data: { isActive: false },
        });

        await this.redisService.deleteSession(sessionId);
        await this.logActivity(teamId, 'LOGOUT', 'User logged out', '', true);

        return { message: 'Logged out successfully' };
    }

    async changePassword(teamId: string, dto: ChangePasswordDto, ipAddress: string) {
        const team = await this.prisma.team.findUnique({ where: { id: teamId } });
        if (!team) {
            throw new BadRequestException('Account not found');
        }

        const isOldPasswordValid = await bcrypt.compare(dto.oldPassword, team.password);
        if (!isOldPasswordValid) {
            throw new BadRequestException('Old password is incorrect');
        }

        const hashedPassword = await bcrypt.hash(
            dto.newPassword,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        await this.prisma.team.update({
            where: { id: teamId },
            data: {
                password: hashedPassword,
                passwordChangedAt: new Date(),
            },
        });

        await this.logActivity(teamId, 'PASSWORD_CHANGE', 'Password changed', ipAddress, true);

        return { message: 'Password changed successfully' };
    }

    async forgotPassword(dto: ForgotPasswordDto, ipAddress: string) {
        const team = await this.prisma.team.findUnique({
            where: { email: dto.email },
        });

        if (!team) {
            // Don't reveal if email exists
            return { message: 'If email exists, OTP has been sent' };
        }

        const otp = this.generateOTP();
        await this.redisService.setOTP(
            team.email,
            otp,
            parseInt(this.configService.get('OTP_EXPIRATION', '600')),
        );

        this.logger.log(`Password reset OTP for ${team.email}: ${otp}`);

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

        const team = await this.prisma.team.update({
            where: { email: dto.email },
            data: {
                password: hashedPassword,
                passwordChangedAt: new Date(),
            },
        });

        await this.redisService.deleteOTP(dto.email);
        await this.logActivity(team.id, 'PASSWORD_CHANGE', 'Password reset', ipAddress, true);

        return { message: 'Password reset successfully' };
    }

    private async generateTokens(userId: string, email: string, role: string, sessionId?: string) {
        const payload = { sub: userId, email, role, sid: sessionId };

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

    private async logActivity(id: string, type: string, description: string, ipAddress: string, isTeam: boolean = false) {
        await this.prisma.activityLog.create({
            data: {
                teamId: id,
                type: type as any,
                description,
                ipAddress,
            },
        });
    }

    async setPassword(dto: any, ipAddress: string) {
        const storedToken = await this.redisService.get(`invitation:${dto.token}`);
        if (!storedToken || storedToken !== dto.email) {
            throw new BadRequestException('Invalid or expired invitation token');
        }

        const hashedPassword = await bcrypt.hash(
            dto.password,
            parseInt(this.configService.get('BCRYPT_ROUNDS', '12')),
        );

        const team = await this.prisma.team.update({
            where: { email: dto.email },
            data: {
                password: hashedPassword,
                isEmailVerified: true,
                status: 'Active',
            },
        });

        await this.redisService.del(`invitation:${dto.token}`);
        await this.logActivity(team.id, 'PASSWORD_CHANGE', 'Team password set via invitation', ipAddress, true);

        return { message: 'Password set successfully. You can now login.' };
    }
}
