import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as https from 'https';
import { NotificationStrategy } from '../interfaces/notification-strategy.interface';
import { OtpChannel } from '../../auth/dto/auth.dto';

@Injectable()
export class EmailStrategy implements NotificationStrategy, OnModuleInit {
    private transporter: nodemailer.Transporter | null = null;
    private readonly logger = new Logger(EmailStrategy.name);

    constructor(private configService: ConfigService) {
        this.initializeTransporter();
    }

    async onModuleInit() {
        if (this.transporter) {
            try {
                await this.transporter.verify();
                this.logger.log(`✅ SMTP connection verified successfully`);
            } catch (error) {
                this.logger.error(`❌ SMTP connection failed: ${error.message}`);
                this.logger.warn('⚠️  Email OTP delivery may fail. Please check your SMTP credentials.');
            }
        } else {
            this.logger.warn('⚠️  No SMTP provider configured. Email delivery will fail.');
        }
    }

    private initializeTransporter() {
        const smtpHost = this.configService.get('SMTP_HOST');
        const smtpUser = this.configService.get('SMTP_USER');
        const smtpPass = this.configService.get('SMTP_PASS');
        const smtpPort = parseInt(this.configService.get('SMTP_PORT', '587'));
        // Correctly handle boolean from env string
        const smtpSecure = this.configService.get('SMTP_SECURE') === 'true' || smtpPort === 465;

        if (!smtpHost || !smtpUser || !smtpPass) {
            this.logger.warn('⚠️  SMTP configuration incomplete (missing SMTP_HOST, SMTP_USER, or SMTP_PASS).');
            return;
        }

        this.logger.log(`📧 Initializing SMTP: ${smtpHost}:${smtpPort} (Secure: ${smtpSecure}, User: ${smtpUser})`);

        this.transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpSecure,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
            pool: true,
            maxConnections: 5,
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2',
            },
        });
    }

    getChannelName(): OtpChannel {
        return OtpChannel.EMAIL;
    }

    async sendOtp(recipient: string, otp: string): Promise<boolean> {
        if (!this.transporter) {
            this.logger.error('❌ Cannot send email: SMTP not configured.');
            throw new Error('SMTP provider not configured. Please set SMTP settings.');
        }

        const startTime = Date.now();
        try {
            const fromEmail = this.configService.get('SMTP_FROM', '"HRMS Support" <noreply@yourapp.com>');
            const info = await this.transporter.sendMail({
                from: fromEmail,
                to: recipient,
                subject: '🔐 Your HRMS Verification Code',
                html: this.getEmailHtml(otp),
            });

            this.logger.log(`✅ OTP sent via SMTP to ${recipient} in ${Date.now() - startTime}ms`);
            return true;
        } catch (error) {
            this.logger.error(`❌ SMTP failed for ${recipient}: ${error.message}`);
            throw new Error(`Email delivery failed: ${error.message}`);
        }
    }

    async sendInvitation(recipient: string, teamName: string, token: string): Promise<boolean> {
        if (!this.transporter) {
            this.logger.error('❌ Cannot send email: SMTP not configured.');
            throw new Error('SMTP provider not configured.');
        }

        const startTime = Date.now();
        try {
            const fromEmail = this.configService.get('SMTP_FROM', '"HRMS Support" <noreply@yourapp.com>');
            const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
            const invitationLink = `${frontendUrl}/set-password?token=${token}&email=${recipient}`;

            await this.transporter.sendMail({
                from: fromEmail,
                to: recipient,
                subject: '🤝 Welcome to Mission HRMS - Set Your Password',
                html: this.getInvitationHtml(teamName, invitationLink),
            });

            this.logger.log(`✅ Invitation sent to ${recipient} in ${Date.now() - startTime}ms`);
            return true;
        } catch (error) {
            this.logger.error(`❌ SMTP Failed for invitation to ${recipient}: ${error.message}`);
            throw new Error(`Invitation delivery failed: ${error.message}`);
        }
    }

    private getInvitationHtml(teamName: string, link: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #FF3D71 0%, #FF8A9B 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Secure Your Account</h1>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>${teamName}</strong>,</p>
                    <p style="font-size: 16px; margin-bottom: 20px;">Welcome to <strong>Mission HRMS</strong>! Your account has been created. For security reasons, you must set an initial password before you can log in.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${link}" style="background-color: #FF3D71; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Set My Password</a>
                    </div>
                    <p style="font-size: 14px; color: #666;">If the button above does not work, copy and paste the following link into your browser:</p>
                    <p style="font-size: 12px; color: #FF3D71; word-break: break-all;">${link}</p>
                    <p style="font-size: 14px; color: #666; margin-top: 20px;">This link is valid for <strong>24 hours</strong>. If you did not expect this invitation, please contact your HR administrator.</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                    <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Mission HRMS. All rights reserved.</p>
                </div>
            </body>
            </html>
        `;
    }

    private getEmailHtml(otp: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Verification Code</h1>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p style="font-size: 16px; margin-bottom: 20px;">Hello,</p>
                    <p style="font-size: 16px; margin-bottom: 20px;">Your OTP verification code is:</p>
                    <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                        <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${otp}</span>
                    </div>
                    <p style="font-size: 14px; color: #666; margin-top: 20px;">⏱️ This code will expire in <strong>10 minutes</strong>.</p>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;">If you didn't request this code, please ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                    <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} HRMS. All rights reserved.</p>
                </div>
            </body>
            </html>
        `;
    }
}
