import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationStrategy } from '../interfaces/notification-strategy.interface';
import { OtpChannel } from '../../auth/dto/auth.dto';

@Injectable()
export class EmailStrategy implements NotificationStrategy {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(EmailStrategy.name);

    constructor(private configService: ConfigService) {
        const smtpUser = this.configService.get('SMTP_USER');
        const isGmail = smtpUser?.includes('gmail.com');

        const transportConfig: any = isGmail
            ? {
                service: 'gmail',
                auth: {
                    user: smtpUser,
                    pass: this.configService.get('SMTP_PASS'),
                },
            }
            : {
                host: this.configService.get('SMTP_HOST'),
                port: parseInt(this.configService.get('SMTP_PORT', '587')),
                secure: this.configService.get('SMTP_SECURE') === 'true',
                auth: {
                    user: smtpUser,
                    pass: this.configService.get('SMTP_PASS'),
                },
            };

        this.transporter = nodemailer.createTransport({
            ...transportConfig,
            pool: true, // Use connection pool
            maxConnections: 5,
            maxMessages: 100,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
            tls: {
                // Do not fail on invalid certificates (common on cloud relays)
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2'
            }
        });
    }

    getChannelName(): OtpChannel {
        return OtpChannel.EMAIL;
    }

    async sendOtp(recipient: string, otp: string): Promise<boolean> {
        try {
            await this.transporter.sendMail({
                from: this.configService.get('SMTP_FROM', '"HRMS Support" <gauravchand222@gmail.com>'),
                to: recipient,
                subject: 'Your Verification Code',
                text: `Your OTP is: ${otp}`,
                html: `<p>Your OTP is: <strong>${otp}</strong></p>`,
            });
            this.logger.log(`OTP sent to email: ${recipient}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send email OTP to ${recipient}: ${error.message}`);
            // Throwing error instead of returning false to capture the message
            throw error;
        }
    }
}
