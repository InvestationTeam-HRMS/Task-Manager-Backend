import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminConfig } from '../config/firebase-admin.config';
import { PrismaService } from '../prisma/prisma.service';

export interface FcmNotificationPayload {
    title: string;
    body: string;
    data?: Record<string, string>;
    imageUrl?: string;
}

@Injectable()
export class FcmService {
    private readonly logger = new Logger(FcmService.name);

    constructor(
        private firebaseAdmin: FirebaseAdminConfig,
        private prisma: PrismaService,
    ) { }

    /**
     * Send FCM notification to a specific user
     */
    async sendToUser(
        teamId: string,
        payload: FcmNotificationPayload,
    ): Promise<void> {
        const messaging = this.firebaseAdmin.getMessaging();
        if (!messaging) {
            this.logger.warn('FCM not configured, skipping notification');
            return;
        }

        try {
            // Get all FCM tokens for this user
            const tokens = await this.prisma.fcmToken.findMany({
                where: { teamId, isActive: true },
                select: { token: true, id: true },
            });

            if (tokens.length === 0) {
                this.logger.debug(`No FCM tokens found for user ${teamId}`);
                return;
            }

            const tokenStrings = tokens.map((t) => t.token);

            // Send to multiple devices
            const message = {
                notification: {
                    title: payload.title,
                    body: payload.body,
                    ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
                },
                data: payload.data || {},
                tokens: tokenStrings,
            };

            const response = await messaging.sendEachForMulticast(message);

            this.logger.log(
                `FCM sent: ${response.successCount}/${tokenStrings.length} successful`,
            );

            // Remove invalid tokens
            if (response.failureCount > 0) {
                const invalidTokenIds: string[] = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const error = resp.error;
                        // Remove tokens that are invalid or unregistered
                        if (
                            error?.code === 'messaging/invalid-registration-token' ||
                            error?.code === 'messaging/registration-token-not-registered'
                        ) {
                            invalidTokenIds.push(tokens[idx].id);
                        }
                    }
                });

                if (invalidTokenIds.length > 0) {
                    await this.prisma.fcmToken.deleteMany({
                        where: { id: { in: invalidTokenIds } },
                    });
                    this.logger.log(`Removed ${invalidTokenIds.length} invalid tokens`);
                }
            }
        } catch (error) {
            this.logger.error(`FCM send error: ${error.message}`, error.stack);
        }
    }

    /**
     * Send FCM notification to multiple users
     */
    async sendToMultipleUsers(
        teamIds: string[],
        payload: FcmNotificationPayload,
    ): Promise<void> {
        await Promise.all(
            teamIds.map((teamId) => this.sendToUser(teamId, payload)),
        );
    }

    /**
     * Register a new FCM token for a user
     */
    async registerToken(teamId: string, token: string): Promise<void> {
        try {
            await this.prisma.fcmToken.upsert({
                where: { token },
                update: { teamId, isActive: true, updatedAt: new Date() },
                create: { teamId, token, isActive: true },
            });
            this.logger.log(`FCM token registered for user ${teamId}`);
        } catch (error) {
            this.logger.error(`Failed to register FCM token: ${error.message}`);
            throw error;
        }
    }

    /**
     * Unregister an FCM token
     */
    async unregisterToken(token: string): Promise<void> {
        try {
            await this.prisma.fcmToken.deleteMany({ where: { token } });
            this.logger.log(`FCM token unregistered`);
        } catch (error) {
            this.logger.error(`Failed to unregister FCM token: ${error.message}`);
        }
    }

    /**
     * Deactivate all tokens for a user (e.g., on logout)
     */
    async deactivateUserTokens(teamId: string): Promise<void> {
        try {
            await this.prisma.fcmToken.updateMany({
                where: { teamId },
                data: { isActive: false },
            });
            this.logger.log(`Deactivated all FCM tokens for user ${teamId}`);
        } catch (error) {
            this.logger.error(`Failed to deactivate tokens: ${error.message}`);
        }
    }
}
