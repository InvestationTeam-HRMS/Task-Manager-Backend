import { Module, Global } from '@nestjs/common';
import { AutoNumberService } from './services/auto-number.service';
import { ExcelUploadService } from './services/excel-upload.service';
import { CloudinaryService } from './services/cloudinary.service';
import { ExcelDownloadService } from './services/excel-download.service';
import { UploadJobService } from './services/upload-job.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadStatusController } from './controllers/upload-status.controller';

/**
 * Global Common Module
 * Provides reusable services across all HRMS modules
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [UploadStatusController],
  providers: [
    AutoNumberService,
    ExcelUploadService,
    CloudinaryService,
    ExcelDownloadService,
    UploadJobService,
  ],
  exports: [
    AutoNumberService,
    ExcelUploadService,
    CloudinaryService,
    ExcelDownloadService,
    UploadJobService,
  ],
})
export class CommonModule {}
