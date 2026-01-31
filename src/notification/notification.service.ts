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
        this.logger.log(`🔔 Notification Created: ${data.title} for user ${teamId}`);

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

        // Emit event for real-time notification
        this.eventEmitter.emit('notification.created', { teamId, notification });

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
            select: { userId: true },
        });

        if (members.length === 0) return { count: 0 };

        const notificationsData = members.map(member => ({
            teamId: member.userId,
            title: data.title,
            description: data.description,
            type: data.type || 'SYSTEM',
            metadata: data.metadata || {},
        }));

        const result = await this.prisma.notification.createMany({
            data: notificationsData,
        });

        // Emit events for each member
        for (const member of members) {
            this.eventEmitter.emit('notification.created', { teamId: member.userId, notification: data });
        }

        return result;
    }

    async findAllForUser(teamId: string) {
        return this.prisma.notification.findMany({
            where: { teamId },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
    }

    async markAsRead(id: string, teamId: string) {
        return this.prisma.notification.update({
            where: { id, teamId },
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
        return new Observable((observer) => {
            // Send initial unread count
            this.getUnreadCount(teamId).then(count => {
                observer.next({
                    data: JSON.stringify({ type: 'unread-count', count })
                } as MessageEvent);
            });

            // Listen for new notifications for this user
            const listener = async (payload: any) => {
                if (payload.teamId === teamId) {
                    try {
                        const count = await this.getUnreadCount(teamId);
                        const finalCount = typeof count === 'number' ? count : 0;

                        const eventData = {
                            type: 'new-notification',
                            notification: payload.notification,
                            count: finalCount
                        };

                        observer.next({
                            data: JSON.stringify(eventData)
                        } as MessageEvent);
                    } catch (error) {
                        this.logger.error('Error fetching unread count for SSE:', error);
                        observer.next({
                            data: JSON.stringify({
                                type: 'new-notification',
                                notification: payload.notification
                            })
                        } as MessageEvent);
                    }
                }
            };

            this.eventEmitter.on('notification.created', listener);

            const heartbeat = setInterval(() => {
                observer.next({
                    data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })
                } as MessageEvent);
            }, 30000);

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

    async sendForgotPasswordOtp(recipient: string, otp: string): Promise<void> {
        await this.emailStrategy.sendForgotPasswordOtp(recipient, otp);
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

        await Promise.all(
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
                    if (error.statusCode === 404 || error.statusCode === 410) {
                        await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
                    }
                }
            })
        );
    }
}
