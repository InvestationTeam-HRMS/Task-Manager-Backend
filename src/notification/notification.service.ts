import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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
    ) {
        this.strategies.set(OtpChannel.EMAIL, emailStrategy);
    }

    async createNotification(teamId: string, data: { title: string; description: string; type?: string; metadata?: any }) {
        const notification = await this.prisma.notification.create({
            data: {
                teamId,
                title: data.title,
                description: data.description,
                type: data.type || 'SYSTEM',
                metadata: data.metadata || {},
            },
        });

        // Emit event for real-time notification
        this.eventEmitter.emit('notification.created', { teamId, notification });

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
        return new Observable((observer) => {
            // Send initial unread count
            this.getUnreadCount(teamId).then(count => {
                observer.next({
                    data: JSON.stringify({ type: 'unread-count', count })
                } as MessageEvent);
            });

            // Listen for new notifications for this user
            const listener = (payload: any) => {
                if (payload.teamId === teamId) {
                    observer.next({
                        data: JSON.stringify({
                            type: 'new-notification',
                            notification: payload.notification
                        })
                    } as MessageEvent);
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
}
