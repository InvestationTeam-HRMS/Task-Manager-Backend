import { Controller, Get, Patch, Param, UseGuards, Sse, MessageEvent } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Observable } from 'rxjs';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get()
    findAll(@GetUser('id') userId: string) {
        return this.notificationService.findAllForUser(userId);
    }

    @Get('unread-count')
    getUnreadCount(@GetUser('id') userId: string) {
        return this.notificationService.getUnreadCount(userId);
    }

    @Sse('stream')
    streamNotifications(@GetUser('id') userId: string): Observable<MessageEvent> {
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
}
