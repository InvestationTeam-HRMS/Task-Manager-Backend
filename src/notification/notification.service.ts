import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';
import { NotificationStrategy } from './interfaces/notification-strategy.interface';
import { EmailStrategy } from './strategies/email.strategy';
import { OtpChannel } from '../auth/dto/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, Subject, interval } from 'rxjs';
import { map, takeUntil, startWith } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private strategies: Map<OtpChannel, NotificationStrategy> = new Map();
    private notificationStreams = new Map<string, Subject<any>>();

    constructor(
        private prisma: PrismaService,
        private emailStrategy: EmailStrategy,
        private eventEmitter: EventEmitter2,
        private configService: ConfigService,
    ) {
        this.strategies.set(OtpChannel.EMAIL, emailStrategy);

        // Setup web-push
        webpush.setVapidDetails(
            `mailto:${this.configService.get('VAPID_EMAIL', 'noreply@yourapp.com')}`,
            this.configService.get('VAPID_PUBLIC_KEY'),
            this.configService.get('VAPID_PRIVATE_KEY')
        );
    }

    async createNotification(teamId: string, data: { title: string; description: string; type?: string; metadata?: any }) {
        console.log('🔔 [NOTIFICATION-START] Creating notification for teamId:', teamId, 'Title:', data.title);

        const notification = await this.prisma.notification.create({
            data: {
                teamId,
                title: data.title,
                description: data.description,
                type: data.type || 'SYSTEM',
                metadata: data.metadata || {},
                isRead: false,
            },
        });

        console.log('✅ [NOTIFICATION-SAVED] DB saved:', notification.id);

        // Emit event for real-time notification - IMMEDIATELY after DB save
        this.eventEmitter.emit('notification.created', { teamId, notification });
        console.log('📡 [EVENT-EMITTED] Event emitted for teamId:', teamId);

        // Send push notification for background (async, don't wait)
        setImmediate(() => {
            this.sendPushNotification(teamId, {
                title: data.title,
                body: data.description,
                data: { id: notification.id, ...data.metadata }
            }).catch(err => this.logger.error(`Push fail: ${err.message}`));
        });

        return notification;
    }

    async broadcastToGroup(groupId: string, data: { title: string; description: string; type?: string; metadata?: any }) {
        const members = await this.prisma.groupMember.findMany({
            where: { groupId },
            select: { userId: true }, // Note: userId in GroupMember still refers to the member (Team) ID
        });

        if (members.length === 0) return { count: 0 };

        const notificationsData = members.map(member => ({
            teamId: member.userId,
            title: data.title,
            description: data.description,
            type: data.type || 'SYSTEM',
            metadata: data.metadata || {},
        }));

        return this.prisma.notification.createMany({
            data: notificationsData,
        });
    }

    async findAllForUser(teamId: string) {
        return this.prisma.notification.findMany({
            where: { teamId },
            orderBy: { createdAt: 'desc' },
            take: 50, // Limit to recent 50
        });
    }

    async markAsRead(id: string, teamId: string) {
        return this.prisma.notification.update({
            where: { id, teamId }, // Ensure we only update if it belongs to the team
            data: { isRead: true },
        });
    }

    async markAllAsRead(teamId: string) {
        return this.prisma.notification.updateMany({
            where: { teamId, isRead: false },
            data: { isRead: true },
        });
    }

    async getUnreadCount(teamId: string) {
        return this.prisma.notification.count({
            where: { teamId, isRead: false },
        });
    }

    getNotificationStream(teamId: string): Observable<MessageEvent> {
        console.log('📺 SSE Stream opened for teamId:', teamId);
        return new Observable((observer) => {
            // Send initial unread count
            this.getUnreadCount(teamId).then(count => {
                console.log('📊 Initial unread count for', teamId, ':', count);
                observer.next({
                    data: JSON.stringify({ type: 'unread-count', count })
                } as MessageEvent);
            });

            // Listen for new notifications for this user
            const listener = async (payload: any) => {
                console.log('🎯 Event received - Target teamId:', payload.teamId, 'Listening teamId:', teamId);
                if (payload.teamId === teamId) {
                    console.log('✅ TeamId MATCH! Sending notification and updated count to client');

                    try {
                        // Fetch fresh count with explicit error handling
                        console.log('📊 Fetching unread count for teamId:', teamId);
                        const count = await this.getUnreadCount(teamId);
                        console.log('📊 Fetched count:', count, 'Type:', typeof count);

                        // Ensure count is a number
                        const finalCount = typeof count === 'number' ? count : 0;
                        console.log('📊 Final count to send:', finalCount);

                        const eventData = {
                            type: 'new-notification',
                            notification: payload.notification,
                            count: finalCount // Send updated count
                        };
                        console.log('📤 Sending SSE event:', JSON.stringify(eventData));

                        observer.next({
                            data: JSON.stringify(eventData)
                        } as MessageEvent);
                    } catch (error) {
                        console.error('❌ Error fetching count, sending notification without count:', error);
                        // Send notification without count as fallback
                        observer.next({
                            data: JSON.stringify({
                                type: 'new-notification',
                                notification: payload.notification
                            })
                        } as MessageEvent);
                    }
                } else {
                    console.log('❌ TeamId MISMATCH! Not sending to this client');
                }
            };

            this.eventEmitter.on('notification.created', listener);

            // Heartbeat to keep connection alive (every 30 seconds)
            const heartbeat = setInterval(() => {
                observer.next({
                    data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })
                } as MessageEvent);
            }, 30000);

            // Cleanup on disconnect
            return () => {
                this.eventEmitter.off('notification.created', listener);
                clearInterval(heartbeat);
                this.logger.log(`SSE connection closed for user ${teamId}`);
            };
        });
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

    async sendInvitation(recipient: string, teamName: string, token: string): Promise<void> {
        try {
            await this.emailStrategy.sendInvitation(recipient, teamName, token);
        } catch (error: any) {
            this.logger.error(`[INVITATION_ERROR] ${error.message}`);
            throw new BadRequestException(`Failed to send invitation: ${error.message}`);
        }
    }
    async createPushSubscription(teamId: string, dto: any) {
        return this.prisma.pushSubscription.upsert({
            where: { endpoint: dto.endpoint },
            update: { teamId },
            create: {
                teamId,
                endpoint: dto.endpoint,
                p256dh: dto.keys.p256dh,
                auth: dto.keys.auth,
            },
        });
    }

    async deletePushSubscription(teamId: string, endpoint: string) {
        return this.prisma.pushSubscription.deleteMany({
            where: { teamId, endpoint },
        });
    }

    async sendPushNotification(teamId: string, payload: any) {
        const subscriptions = await this.prisma.pushSubscription.findMany({
            where: { teamId },
        });

        const results = await Promise.all(
            subscriptions.map(async (sub) => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth,
                    },
                };

                try {
                    await webpush.sendNotification(
                        pushSubscription,
                        JSON.stringify(payload)
                    );
                } catch (error: any) {
                    this.logger.error(`Push notification failed for endpoint ${sub.endpoint}: ${error.message}`);
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        this.logger.warn(`Subscription expired or invalid, deleting: ${sub.id}`);
                        await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
                    }
                }
            })
        );

        return results;
    }
}
