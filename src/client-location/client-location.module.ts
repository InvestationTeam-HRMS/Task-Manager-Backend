import { Module } from '@nestjs/common';
import { ClientLocationController } from './client-location.controller';
import { ClientLocationService } from './client-location.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ClientLocationController],
  providers: [ClientLocationService],
  exports: [ClientLocationService],
})
export class ClientLocationModule {}
