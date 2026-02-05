import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { EmailStrategy } from './strategies/email.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { FcmService } from './fcm.service';
import { FirebaseAdminConfig } from '../config/firebase-admin.config';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, EventEmitterModule.forRoot()],
  controllers: [NotificationController],
  providers: [NotificationService, EmailStrategy, FcmService, FirebaseAdminConfig],
  exports: [NotificationService, FcmService],
})
export class NotificationModule { }
