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
    UpdateProfileDto,
    OtpChannel,
} from './dto/auth.dto';
import { NotificationService } from '../notification/notification.service';
import { CloudinaryService } from '../common/services/cloudinary.service';
// Removed UserRole import from @prisma/client

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private redisService: RedisService,
        private notificationService: NotificationService,
        private cloudinaryService: CloudinaryService,
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
                teamName: tempUser.teamName,
                teamNo: `TM-${Date.now()}`, // Auto-generated team identifier
                email: tempUser.email,
                password: tempUser.password,
                phone: tempUser.phoneNumber,
                role: 'EMPLOYEE',
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

        const loginMethod = identity.loginMethod;
        const isAdmin = identity.role === 'ADMIN';
        const isSuperAdmin = identity.role === 'ADMIN';

        // 1. IP Check for methods requiring it (Ip_address, Ip_Otp)
        const requiresIpCheck = loginMethod === 'Ip_address' || loginMethod === 'Ip_Otp';
        if (requiresIpCheck && !isSuperAdmin) {
            const allowedIps = identity.allowedIps || [];
            const isUserAllowed = allowedIps.includes(ipAddress) || allowedIps.includes('*');

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
                this.logger.warn(`Blocked login attempt for ${identity.email} from unauthorized IP: ${ipAddress} (Method: ${loginMethod})`);
                throw new UnauthorizedException(`Access denied. Unrecognized IP address (${ipAddress}).`);
            }
        }

        // 2. Decide if OTP is needed
        // Skip OTP if loginMethod is General/Ip_address OR if user is an ADMIN
        const needsOtp = (loginMethod === 'Otp' || loginMethod === 'Ip_Otp') && !isAdmin;

        if (!needsOtp) {
            const reason = isAdmin ? 'Admin role bypass' : `Login Method: ${loginMethod}`;
            this.logger.log(`[AUTH] Skipping OTP for ${identity.email} (${reason})`);

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

            await this.logActivity(identity.id, 'LOGIN', `Account logged in (Mode: ${loginMethod}, OTP bypassed: ${reason})`, ipAddress, true);

            // Fetch user with permissions
            const userWithPermissions = await this.getUserWithPermissions(identity.id);

            // WhatsApp-style: Only return sessionId (for cookie), no tokens exposed to JS
            return {
                message: `Login successful (${reason})`,
                email: identity.email,
                otpSkipped: true,
                sessionId, // This goes into httpOnly cookie
                user: userWithPermissions,
            };
        }

        // OTP is required
        const otp = this.generateOTP();
        const ttl = 300; // 5 mins
        await this.redisService.setLoginOTP(identity.email, otp, ttl);

        this.logger.log(`Login OTP for ${identity.email}: ${otp}`);

        // Send the OTP to the team's email
        await this.notificationService.sendOtp(identity.email, otp, OtpChannel.EMAIL);

        return {
            message: `Credentials verified. OTP has been sent via email (Method: ${loginMethod}).`,
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

        const loginMethod = identity.loginMethod;
        const isAdmin = identity.role === 'ADMIN';
        const isSuperAdmin = identity.role === 'ADMIN';

        // 1. Double check IP for methods requiring it (Ip_address, Ip_Otp)
        const requiresIpCheck = loginMethod === 'Ip_address' || loginMethod === 'Ip_Otp';
        if (requiresIpCheck && !isSuperAdmin) {
            const allowedIps = identity.allowedIps || [];
            const isUserAllowed = allowedIps.includes(ipAddress) || allowedIps.includes('*');

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
                throw new UnauthorizedException(`Access denied. Unrecognized IP address (${ipAddress}).`);
            }
        }

        // 2. OTP Validation Logic
        const needsOtp = (loginMethod === 'Otp' || loginMethod === 'Ip_Otp') && !isAdmin;
        if (needsOtp) {
            const storedOtp = await this.redisService.getLoginOTP(dto.email);
            if (!storedOtp || storedOtp !== dto.otp) {
                throw new UnauthorizedException('Invalid or expired OTP');
            }
            this.logger.log(`[AUTH] OTP verified for ${dto.email}`);
        } else {
            const reason = isAdmin ? 'Admin role bypass' : `Login Method: ${loginMethod}`;
            this.logger.log(`[AUTH] Skipping OTP validation for ${dto.email} (${reason})`);
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
        if (needsOtp) {
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

        await this.logActivity(identity.id, 'LOGIN', `Account logged in via ${loginMethod}`, ipAddress, true);

        // Fetch user with permissions
        const userWithPermissions = await this.getUserWithPermissions(identity.id);

        // WhatsApp-style: Only return sessionId (for cookie), no tokens exposed to JS
        return {
            sessionId,
            user: userWithPermissions,
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

        // Send Email
        try {
            await this.notificationService.sendForgotPasswordOtp(team.email, otp);
            this.logger.log(`[FORGOT_PASSWORD] OTP sent to ${team.email}`);
        } catch (error) {
            this.logger.error(`[FORGOT_PASSWORD_ERROR] Failed to send email to ${team.email}: ${error.message}`);
            // We still return success-like message to prevent user enumeration
        }

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

    async getUserWithPermissions(userId: string) {
        const user = await this.prisma.team.findUnique({
            where: { id: userId },
            include: {
                customRole: {
                    select: {
                        id: true,
                        name: true,
                        permissions: true,
                    },
                },
            },
        });

        if (!user) {
            return null;
        }

        const permissions: any = user.customRole?.permissions || {};

        // Fallback: If no custom role permissions, assign default based on role name
        if (Object.keys(permissions).length === 0) {
            const roleUpper = user.role.toUpperCase();
            if (roleUpper === 'ADMIN' || roleUpper === 'MANAGER' || roleUpper === 'HR') {
                permissions['organization'] = ['add', 'view', 'edit', 'delete']
                permissions['project'] = ['add', 'view', 'edit', 'delete']
                permissions['task'] = ['add', 'view', 'edit', 'delete']
                permissions['users'] = ['add', 'view', 'edit', 'delete']
                permissions['group'] = ['add', 'view', 'edit', 'delete']
                permissions['ip_address'] = ['add', 'view', 'edit', 'delete']
            }
        }

        // Add isSuperAdmin flag if user has ADMIN role
        if (user.role.toUpperCase() === 'ADMIN') {
            permissions.isSuperAdmin = true;
        }

        const roleName = user.customRole?.name || user.role;

        return {
            id: user.id,
            email: user.email,
            teamName: user.teamName,
            role: user.role,
            roleId: user.roleId,
            roleName,
            permissions,
            avatar: user.avatar,
            phone: user.phone,
            address: user.address,
            city: user.city,
            postcode: user.postcode,
            country: user.country,
            isTeam: true,
        };
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

    async updateProfile(userId: string, dto: UpdateProfileDto, ipAddress: string) {
        const team = await this.prisma.team.findUnique({ where: { id: userId } });
        if (!team) {
            throw new BadRequestException('Account not found');
        }

        let avatarUrl = dto.avatar;

        // If avatar is base64, upload to Cloudinary
        if (dto.avatar && (dto.avatar.startsWith('data:image') || dto.avatar.length > 500)) {
            try {
                this.logger.log(`Uploading new avatar for user ${userId}`);
                avatarUrl = await this.cloudinaryService.uploadAvatar(dto.avatar, userId);
            } catch (error) {
                this.logger.error(`Failed to upload avatar: ${error.message}`);
                // Don't fail the whole update, but maybe log it
            }
        }

        const updateData: any = { ...dto, avatar: avatarUrl };

        const updated = await this.prisma.team.update({
            where: { id: userId },
            data: updateData,
        });

        await this.logActivity(userId, 'UPDATE', 'Profile updated', ipAddress, true);

        return {
            message: 'Profile updated successfully',
            user: {
                id: updated.id,
                email: updated.email,
                teamName: updated.teamName,
                avatar: updated.avatar,
                phone: updated.phone,
                address: updated.address,
                city: updated.city,
                postcode: updated.postcode,
                country: updated.country,
            }
        };
    }

    async validateSession(sessionId: string): Promise<boolean> {
        const redisSession = await this.redisService.getSession(sessionId);
        if (redisSession) {
            return true;
        }

        const dbSession = await this.prisma.session.findUnique({
            where: { sessionId },
        });

        if (!dbSession || !dbSession.isActive || dbSession.expiresAt < new Date()) {
            return false;
        }

        const sessionExpiry = Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000);
        await this.redisService.setSession(
            sessionId,
            { teamId: dbSession.teamId, email: '', role: '' },
            sessionExpiry,
        );

        return true;
    }

    async validateSessionAndGetUser(sessionId: string): Promise<{ user: any; sessionId: string } | null> {
        let sessionData = await this.redisService.getSession(sessionId);

        if (!sessionData) {
            const dbSession = await this.prisma.session.findUnique({
                where: { sessionId },
                include: { team: true },
            });

            if (!dbSession || !dbSession.isActive || dbSession.expiresAt < new Date()) {
                return null;
            }

            sessionData = {
                teamId: dbSession.teamId,
                email: dbSession.team?.email || '',
                role: dbSession.team?.role || '',
            };

            const sessionExpiry = Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000);
            await this.redisService.setSession(sessionId, sessionData, sessionExpiry);
        }

        const user = await this.getUserWithPermissions(sessionData.teamId);
        if (!user) {
            return null;
        }

        return { user, sessionId };
    }

    async logoutBySession(sessionId: string) {
        await this.prisma.session.updateMany({
            where: { sessionId },
            data: { isActive: false },
        });

        await this.redisService.deleteSession(sessionId);

        return { message: 'Logged out successfully' };
    }
}
