import { Controller, Post, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import * as fs from 'fs';

@Controller('pdf')
export class PdfController {
  constructor(private pdfService: PdfService) {}

  @Post('generate-docs')
  async generateDocumentation() {
    const filePath = await this.pdfService.generateReport(
      'API Documentation',
      [],
    );
    return {
      message: 'API documentation generated successfully',
      filePath,
    };
  }

  @Get('download-docs')
  async downloadDocumentation(@Res() res: Response) {
    const filePath = await this.pdfService.generateReport(
      'API Documentation',
      [],
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=api-documentation.pdf',
    );

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  }
}
