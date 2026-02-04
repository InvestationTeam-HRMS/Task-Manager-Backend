import { Module } from '@nestjs/common';
import { ClientCompanyController } from './client-company.controller';
import { ClientCompanyService } from './client-company.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ClientCompanyController],
  providers: [ClientCompanyService],
  exports: [ClientCompanyService],
})
export class ClientCompanyModule {}
