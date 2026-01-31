import { Controller, Get, Patch, Param, UseGuards, Sse, MessageEvent, Post, Body, Delete, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Observable } from 'rxjs';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    private readonly logger = new Logger(NotificationController.name);
    constructor(private readonly notificationService: NotificationService) { }

    @Get()
    findAll(@GetUser('id') userId: string) {
        return this.notificationService.findAllForUser(userId);
    }

    @Get('unread-count')
    async getUnreadCount(@GetUser('id') userId: string) {
        const count = await this.notificationService.getUnreadCount(userId);
        return { count };
    }

    @Sse('stream')
    streamNotifications(
        @GetUser('id') userId: string,
    ): Observable<MessageEvent> {
        this.logger.log(`🌊 SSE Connected! UserId: ${userId}`);
        return this.notificationService.getNotificationStream(userId);
    }

    @Patch(':id/read')
    markAsRead(@Param('id') id: string, @GetUser('id') userId: string) {
        return this.notificationService.markAsRead(id, userId);
    }

    @Patch('mark-all-read')
    markAllAsRead(@GetUser('id') userId: string) {
        return this.notificationService.markAllAsRead(userId);
    }

    @Post('subscribe')
    subscribe(@GetUser('id') userId: string, @Body() dto: CreatePushSubscriptionDto) {
        return this.notificationService.createPushSubscription(userId, dto);
    }

    @Delete('unsubscribe')
    unsubscribe(@GetUser('id') userId: string, @Body('endpoint') endpoint: string) {
        return this.notificationService.deletePushSubscription(userId, endpoint);
    }
}
