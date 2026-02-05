import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationStrategy } from './interfaces/notification-strategy.interface';
import { EmailStrategy } from './strategies/email.strategy';
import { OtpChannel } from '../auth/dto/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject, interval } from 'rxjs';
import { map, takeUntil, startWith } from 'rxjs/operators';
import { MessageEvent } from '@nestjs/common';
import { FcmService } from './fcm.service';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private strategies: Map<OtpChannel, NotificationStrategy> = new Map();

  constructor(
    private prisma: PrismaService,
    private emailStrategy: EmailStrategy,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
    private fcmService: FcmService,
  ) {
    this.strategies.set(OtpChannel.EMAIL, emailStrategy);
  }

  onModuleInit() {
    this.logger.log('🚀 Notification Service Initialized');
  }

  @OnEvent('notification.created', { async: true })
  async handleNotificationCreated(payload: { teamId: string; notification: any }) {
    const { teamId, notification } = payload;

    // Send Background Push Notifications
    try {
      // FCM Push (Mobile/Enhanced Web)
      await this.fcmService.sendToUser(teamId, {
        title: notification.title,
        body: notification.description,
        data: {
          id: String(notification.id || ''),
          type: notification.type || 'SYSTEM',
          ...(notification.metadata ? Object.fromEntries(
            Object.entries(notification.metadata).map(([k, v]) => [k, String(v)])
          ) : {}),
        },
      });
    } catch (err) {
      this.logger.error(`Push notification failed for user ${teamId}: ${err.message}`);
    }
  }

  async createNotification(
    teamId: string,
    data: { title: string; description: string; type?: string; metadata?: any },
  ) {
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

    // Emit event for real-time notification (this triggers SSE and Push)
    this.eventEmitter.emit('notification.created', { teamId, notification });

    return notification;
  }

  async broadcastToGroup(
    groupId: string,
    data: { title: string; description: string; type?: string; metadata?: any },
  ) {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });

    if (members.length === 0) return { count: 0 };

    const notificationsData = members.map((member) => ({
      teamId: member.userId,
      title: data.title,
      description: data.description,
      type: data.type || 'SYSTEM',
      metadata: data.metadata || {},
    }));

    // We use a loop instead of createMany if we want individual notification objects to emit
    // but createMany is faster. To handle both, we'll create individual notifications for the event.
    const result = await this.prisma.notification.createMany({
      data: notificationsData,
    });

    // Fetch created notifications to get IDs (or just emit with data if IDs aren't critical for initial push)
    // For performance, we'll emit with the data we have.
    for (const member of members) {
      this.eventEmitter.emit('notification.created', {
        teamId: member.userId,
        notification: {
          ...data,
          createdAt: new Date(),
        },
      });
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
    const updated = await this.prisma.notification.update({
      where: { id, teamId },
      data: { isRead: true },
    });

    // Emit event to update unread count in real-time
    const newCount = await this.getUnreadCount(teamId);
    this.eventEmitter.emit('notification.read', { teamId, count: newCount });

    return updated;
  }

  async markAllAsRead(teamId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { teamId, isRead: false },
      data: { isRead: true },
    });

    // Emit event to update unread count to 0 in real-time
    this.eventEmitter.emit('notification.read', { teamId, count: 0 });

    return result;
  }

  async getUnreadCount(teamId: string) {
    return this.prisma.notification.count({
      where: { teamId, isRead: false },
    });
  }

  getNotificationStream(teamId: string): Observable<MessageEvent> {
    return new Observable((observer) => {
      // Send initial unread count
      this.getUnreadCount(teamId).then((count) => {
        observer.next({
          data: JSON.stringify({ type: 'unread-count', count }),
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
              count: finalCount,
            };

            observer.next({
              data: JSON.stringify(eventData),
            } as MessageEvent);
          } catch (error) {
            this.logger.error('Error fetching unread count for SSE:', error);
            observer.next({
              data: JSON.stringify({
                type: 'new-notification',
                notification: payload.notification,
              }),
            } as MessageEvent);
          }
        }
      };

      this.eventEmitter.on('notification.created', listener);

      // Listen for notification read events to update count
      const readListener = async (payload: any) => {
        if (payload.teamId === teamId) {
          observer.next({
            data: JSON.stringify({
              type: 'unread-count',
              count: payload.count,
            }),
          } as MessageEvent);
        }
      };

      this.eventEmitter.on('notification.read', readListener);

      const heartbeat = setInterval(() => {
        observer.next({
          data: JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      }, 30000);

      return () => {
        this.eventEmitter.off('notification.created', listener);
        this.eventEmitter.off('notification.read', readListener);
        clearInterval(heartbeat);
        this.logger.log(`SSE connection closed for user ${teamId}`);
      };
    });
  }

  async sendOtp(
    recipient: string,
    otp: string,
    channel: OtpChannel,
  ): Promise<void> {
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
        `Failed to send OTP via ${channel}: ${error.message}`,
      );
    }
  }

  async sendForgotPasswordOtp(recipient: string, otp: string): Promise<void> {
    await this.emailStrategy.sendForgotPasswordOtp(recipient, otp);
  }

  async sendInvitation(
    recipient: string,
    teamName: string,
    token: string,
  ): Promise<void> {
    try {
      await this.emailStrategy.sendInvitation(recipient, teamName, token);
    } catch (error: any) {
      this.logger.error(`[INVITATION_ERROR] ${error.message}`);
      throw new BadRequestException(
        `Failed to send invitation: ${error.message}`,
      );
    }
  }

}
