import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Sse,
  MessageEvent,
  Post,
  Body,
  Delete,
  Logger,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Observable } from 'rxjs';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { FcmService } from './fcm.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);
  constructor(
    private readonly notificationService: NotificationService,
    private readonly fcmService: FcmService,
  ) {}

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
  streamNotifications(@GetUser('id') userId: string): Observable<MessageEvent> {
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

  // FCM Endpoints
  @Post('fcm/register')
  async registerFcmToken(
    @GetUser('id') userId: string,
    @Body() dto: RegisterFcmTokenDto,
  ) {
    await this.fcmService.registerToken(userId, dto.token);
    return { success: true, message: 'FCM token registered successfully' };
  }

  @Delete('fcm/unregister')
  async unregisterFcmToken(@Body('token') token: string) {
    await this.fcmService.unregisterToken(token);
    return { success: true, message: 'FCM token unregistered successfully' };
  }
}
