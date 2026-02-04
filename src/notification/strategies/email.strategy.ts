import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationStrategy } from '../interfaces/notification-strategy.interface';
import { OtpChannel } from '../../auth/dto/auth.dto';

@Injectable()
export class EmailStrategy implements NotificationStrategy, OnModuleInit {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(EmailStrategy.name);

  constructor(private configService: ConfigService) {
    this.initializeEmailProvider();
  }

  async onModuleInit() {
    if (this.transporter) {
      try {
        // Verify connection on startup to catch config issues early
        await Promise.race([
          this.transporter.verify(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('SMTP Verification Timeout')),
              30000,
            ),
          ),
        ]);
        this.logger.log(
          `✅ SMTP delivery channel verified (${this.configService.get('SMTP_HOST')})`,
        );
      } catch (error) {
        this.logger.error(`❌ SMTP connection failed: ${error.message}`);
        this.logger.warn(
          '⚠️  System starting without verified email delivery. Check SMTP credentials in production.',
        );
      }
    } else {
      this.logger.warn(
        '⚠️  No SMTP provider configured. Transactional emails (OTP/Invitations) will fail.',
      );
    }
  }

  private initializeEmailProvider() {
    const host = this.configService.get('SMTP_HOST');
    const user = this.configService.get('SMTP_USER');
    const pass = this.configService.get('SMTP_PASS');
    const port = parseInt(this.configService.get('SMTP_PORT', '587'));

    // Use secure connection for port 465 (SSL), else use STARTTLS (port 587)
    const secure =
      this.configService.get('SMTP_SECURE') === 'true' || port === 465;

    if (!host || !user || !pass) {
      return;
    }

    this.logger.log(
      `📧 Configured SMTP channel: ${host}:${port} (SSL/TLS: ${secure})`,
    );

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5, // Limit 5 emails per second for stability
      tls: {
        // Do not fail on invalid certificates (useful for some enterprise SMTPs)
        rejectUnauthorized: this.configService.get('NODE_ENV') === 'production',
        minVersion: 'TLSv1.2',
      },
    });
  }

  getChannelName(): OtpChannel {
    return OtpChannel.EMAIL;
  }

  async sendOtp(recipient: string, otp: string): Promise<boolean> {
    const from =
      this.configService.get('SMTP_FROM') || 'HRMS <no-reply@missionhrms.com>';
    const subject = '🔐 Verification Code - Task Manager';

    try {
      if (!this.transporter)
        throw new Error('SMTP transporter not initialized');

      const info = await this.transporter.sendMail({
        from,
        to: recipient,
        subject,
        html: this.getEmailHtml(otp),
      });

      this.logger.debug(
        `[SMTP] OTP sent to ${recipient}. MessageId: ${info.messageId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[SMTP_ERROR] Failed to send OTP to ${recipient}: ${error.message}`,
      );
      throw new Error(`Email delivery blocked. Please contact system admin.`);
    }
  }

  async sendForgotPasswordOtp(
    recipient: string,
    otp: string,
  ): Promise<boolean> {
    const from =
      this.configService.get('SMTP_FROM') || 'HRMS <no-reply@missionhrms.com>';
    const subject = '🔐 Password Reset Code - Task Manager';

    try {
      if (!this.transporter)
        throw new Error('SMTP transporter not initialized');

      const info = await this.transporter.sendMail({
        from,
        to: recipient,
        subject,
        html: this.getForgotPasswordHtml(otp),
      });

      this.logger.debug(
        `[SMTP] Forgot Password OTP sent to ${recipient}. MessageId: ${info.messageId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[SMTP_ERROR] Failed to send forgot password OTP to ${recipient}: ${error.message}`,
      );
      throw new Error(`Email delivery blocked. Please contact system admin.`);
    }
  }

  async sendInvitation(
    recipient: string,
    teamName: string,
    token: string,
  ): Promise<boolean> {
    const from =
      this.configService.get('SMTP_FROM') || 'HRMS <no-reply@missionhrms.com>';
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:5173';
    const invitationLink = `${frontendUrl}/set-password?token=${token}&email=${recipient}`;
    const subject = '🤝 Create Your Account - Task Manager';

    try {
      if (!this.transporter)
        throw new Error('SMTP transporter not initialized');

      await this.transporter.sendMail({
        from,
        to: recipient,
        subject,
        html: this.getInvitationHtml(teamName, invitationLink),
      });

      this.logger.log(`[SMTP] Invitation delivered to ${recipient}`);
      return true;
    } catch (error) {
      this.logger.error(
        `[SMTP_ERROR] Invitation failed for ${recipient}: ${error.message}`,
      );
      throw new Error(`Critical: Could not deliver invitation email.`);
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
                    <p style="font-size: 16px; margin-bottom: 20px;">Welcome to <strong>Task Manager</strong>! Your account has been created. For security reasons, you must set an initial password before you can log in.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${link}" style="background-color: #FF3D71; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Set My Password</a>
                    </div>
                    <p style="font-size: 14px; color: #666;">If the button above does not work, copy and paste the following link into your browser:</p>
                    <p style="font-size: 12px; color: #FF3D71; word-break: break-all;">${link}</p>
                    <p style="font-size: 14px; color: #666; margin-top: 20px;">This link is valid for <strong>24 hours</strong>. If you did not expect this invitation, please contact your HR administrator.</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                    <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Task Manager. All rights reserved.</p>
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

  private getForgotPasswordHtml(otp: string): string {
    return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #FF9966 0%, #FF5E62 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">🔑 Password Reset</h1>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                    <p style="font-size: 16px; margin-bottom: 20px;">Hello,</p>
                    <p style="font-size: 16px; margin-bottom: 20px;">We received a request to reset your password. Use the following code to proceed:</p>
                    <div style="background: white; border: 2px dashed #FF5E62; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                        <span style="font-size: 32px; font-weight: bold; color: #FF5E62; letter-spacing: 8px;">${otp}</span>
                    </div>
                    <p style="font-size: 14px; color: #666; margin-top: 20px;">⏱️ This code is valid for <strong>10 minutes</strong>.</p>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;">If you didn't request a password reset, you can safely ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                    <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} HRMS. All rights reserved.</p>
                </div>
            </body>
            </html>
        `;
  }
}
