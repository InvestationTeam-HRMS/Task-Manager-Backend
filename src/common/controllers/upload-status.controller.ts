import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { UploadJobService } from '../services/upload-job.service';

@Controller('uploads')
export class UploadStatusController {
  constructor(private uploadJobService: UploadJobService) {}

  @Get('status/:jobId')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Param('jobId') jobId: string, @GetUser('id') userId: string) {
    const job = await this.uploadJobService.getJob(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Upload job not found');
    }
    return job;
  }
}
