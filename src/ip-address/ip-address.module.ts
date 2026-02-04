import { Module } from '@nestjs/common';
import { IpAddressController } from './ip-address.controller';
import { IpAddressService } from './ip-address.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [IpAddressController],
  providers: [IpAddressService],
  exports: [IpAddressService],
})
export class IpAddressModule {}
