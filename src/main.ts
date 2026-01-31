import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:", "http://localhost:*", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Trust Proxy for secure cookies behind load balancers (Vercel/Render/Heroku/Nginx)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);



  // Compression for faster API responses
  app.use(compression());

  // Cookie Parser
  app.use(cookieParser(configService.get('COOKIE_SECRET', 'task-manager-secret')));

  // CORS Configuration
  const corsOrigins = configService.get('CORS_ORIGIN')?.split(',').map(origin => origin.trim()) || ['http://localhost:5173'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Client-Host',
      'X-User-Agent',
      'Accept',
    ],
  });

  // Global API Prefix
  app.setGlobalPrefix('api/v1', {
    exclude: ['/'],
  });

  // Port
  const port = configService.get('PORT', 3000);

  const server = await app.listen(port);
  server.setTimeout(600000); // 10 Minutes timeout for large uploads

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 API Version: v1 (Manual Prefix)`);
  logger.log(`🔒 Environment: ${configService.get('NODE_ENV', 'development')}`);
  logger.log(`✅ Task Manager Backend is ready!`);
}

bootstrap();
