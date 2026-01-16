import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { NotificationStrategy } from './interfaces/notification-strategy.interface';
import { EmailStrategy } from './strategies/email.strategy';
import { SmsStrategy } from './strategies/sms.strategy';
import { OtpChannel } from '../auth/dto/auth.dto';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private strategies: Map<OtpChannel, NotificationStrategy> = new Map();

    constructor(
        private emailStrategy: EmailStrategy,
        private smsStrategy: SmsStrategy,
    ) {
        this.strategies.set(OtpChannel.EMAIL, emailStrategy);
        this.strategies.set(OtpChannel.SMS, smsStrategy);
    }

    async sendOtp(recipient: string, otp: string, channel: OtpChannel): Promise<void> {
        const strategy = this.strategies.get(channel);
        if (!strategy) {
            throw new BadRequestException('Invalid OTP channel');
        }

        // Secure: Only log to server console for testing
        this.logger.log(`[AUTH] Generating OTP for ${recipient} via ${channel}`);

        try {
            const success = await strategy.sendOtp(recipient, otp);
            if (!success) {
                throw new Error('Notification strategy failed to deliver');
            }
        } catch (error: any) {
            this.logger.error(`[NOTIFICATION_ERROR] ${error.message}`);
            throw new BadRequestException(
                `Failed to send OTP via ${channel}: ${error.message}`
            );
        }
    }
}
