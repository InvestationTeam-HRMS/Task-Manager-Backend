import { Module } from '@nestjs/common';
import { ClientGroupController } from './client-group.controller';
import { ClientGroupService } from './client-group.service';

@Module({
    controllers: [ClientGroupController],
    providers: [ClientGroupService],
    exports: [ClientGroupService],
})
export class ClientGroupModule { }
