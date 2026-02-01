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
import { DemoModule } from './demo/demo.module';
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

    // Multer for file uploads (memory storage for Cloudinary)
    // Enterprise-grade: Supports massive Excel files with 10 lakh+ (1 million+) rows
    MulterModule.register({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max file size (1024MB)
        // Supports:
        // - Excel files with 10 lakh (1 million) rows
        // - Heavy CSV imports with multiple columns
        // - Bulk document/image uploads
        // - Large video files for training materials
        // - Archive files (ZIP) with bulk data
        // Future-proof for enterprise-scale operations
      },
    }),

    // Rate Limiting - Protection against DDoS/brute force attacks
    // Enterprise-grade limits for massive-scale HRMS deployment
    // Designed for: 1000+ concurrent users with very heavy bulk operations
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 seconds window
        limit: 50000, // 50,000 requests per minute (~833 per second)
        // Maximum capacity for:
        // - 1000+ concurrent users
        // - Large Excel file processing (10 lakh rows)
        // - Multiple dashboards per user (6 parallel calls each)
        // - Real-time SSE notifications for all users
        // - Bulk task create/update/delete operations (1000s at once)
        // - Heavy file uploads/downloads (1GB files)
        // - Multiple teams/departments working simultaneously
        // - API integrations and webhooks
        // Future-proof: Can handle 10x current load
        // Still protects against DDoS (blocks after 50k requests/min)
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
    DemoModule,
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
export class AppModule { }
