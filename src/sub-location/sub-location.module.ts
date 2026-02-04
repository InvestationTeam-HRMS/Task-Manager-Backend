import { Module } from '@nestjs/common';
import { SubLocationController } from './sub-location.controller';
import { SubLocationService } from './sub-location.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [SubLocationController],
  providers: [SubLocationService],
  exports: [SubLocationService],
})
export class SubLocationModule {}
