import { Module } from '@nestjs/common';
import { StickyNoteService } from './sticky-note.service';
import { StickyNoteController } from './sticky-note.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StickyNoteController],
  providers: [StickyNoteService],
})
export class StickyNoteModule {}
