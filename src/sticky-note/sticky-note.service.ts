import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStickyNoteDto } from './dto/create-sticky-note.dto';
import { UpdateStickyNoteDto } from './dto/update-sticky-note.dto';

@Injectable()
export class StickyNoteService {
  constructor(private prisma: PrismaService) {}

  async create(createStickyNoteDto: CreateStickyNoteDto, teamId: string) {
    return this.prisma.stickyNote.create({
      data: {
        ...createStickyNoteDto,
        teamId,
      },
    });
  }

  async findAll(teamId: string) {
    return this.prisma.stickyNote.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const note = await this.prisma.stickyNote.findUnique({
      where: { id },
    });
    if (!note) throw new NotFoundException('Sticky note not found');
    return note;
  }

  async update(id: string, updateStickyNoteDto: UpdateStickyNoteDto) {
    return this.prisma.stickyNote.update({
      where: { id },
      data: updateStickyNoteDto,
    });
  }

  async remove(id: string) {
    return this.prisma.stickyNote.delete({
      where: { id },
    });
  }
}
