import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { ClientGroupModule } from './client-group/client-group.module';
import { ClientCompanyModule } from './client-company/client-company.module';
import { ClientLocationModule } from './client-location/client-location.module';
import { SubLocationModule } from './sub-location/sub-location.module';
import { ProjectModule } from './project/project.module';
import { TeamModule } from './team/team.module';
import { GroupModule } from './group/group.module';
import { IpAddressModule } from './ip-address/ip-address.module';
import { PdfModule } from './pdf/pdf.module';

import { NotificationModule } from './notification/notification.module';
import { TaskModule } from './task/task.module';
import { RoleModule } from './role/role.module';
import { StickyNoteModule } from './sticky-note/sticky-note.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestTransformInterceptor } from './common/interceptors/request-transform.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Multer for file uploads
    MulterModule.register({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 50000,
      },
    ]),

    // Core Modules
    PrismaModule,
    RedisModule,
    CommonModule,
    AuthModule,

    // HRMS Modules
    ClientGroupModule,
    ClientCompanyModule,
    ClientLocationModule,
    SubLocationModule,
    ProjectModule,
    TeamModule,
    GroupModule,
    IpAddressModule,

    // Other Modules
    PdfModule,
    NotificationModule,
    TaskModule,
    RoleModule,
    StickyNoteModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global Rate Limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Global Request Transformer (Title Case & Codes)
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestTransformInterceptor,
    },
    // Global Response Transformer
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Global Validation Pipe
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    },
  ],
})
export class AppModule {}
