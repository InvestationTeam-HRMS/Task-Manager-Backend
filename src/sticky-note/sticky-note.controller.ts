import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { StickyNoteService } from './sticky-note.service';
import { CreateStickyNoteDto } from './dto/create-sticky-note.dto';
import { UpdateStickyNoteDto } from './dto/update-sticky-note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('sticky-note')
@UseGuards(JwtAuthGuard)
export class StickyNoteController {
  constructor(private readonly stickyNoteService: StickyNoteService) {}

  @Post()
  create(@Body() createStickyNoteDto: CreateStickyNoteDto, @Req() req) {
    return this.stickyNoteService.create(createStickyNoteDto, req.user.id);
  }

  @Get()
  findAll(@Req() req) {
    return this.stickyNoteService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stickyNoteService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateStickyNoteDto: UpdateStickyNoteDto,
  ) {
    return this.stickyNoteService.update(id, updateStickyNoteDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stickyNoteService.remove(id);
  }
}
