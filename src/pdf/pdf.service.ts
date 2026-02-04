import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

export interface ApiEndpoint {
  name: string;
  endpoint: string;
  method: string;
  description: string;
  authRequired: boolean;
  roles?: string[];
  requestExample?: any;
  responseExample?: any;
}

export interface ApiSection {
  title: string;
  apis: ApiEndpoint[];
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generateReport(
    title: string,
    sections: ApiSection[],
    filename: string = 'api-documentation.pdf',
  ): Promise<string> {
    const outputPath = path.join(process.cwd(), filename);
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // =====================
    // Title Page
    // =====================
    this.addTitle(doc, title);
    this.addSubtitle(doc, 'Production-Grade API Documentation');
    this.addText(doc, `Generated: ${new Date().toLocaleString()}`);
    doc.moveDown(2);

    // =====================
    // Table of Contents
    // =====================
    this.addSectionHeader(doc, 'Table of Contents');
    sections.forEach((section, index) => {
      this.addText(doc, `${index + 1}. ${section.title}`);
    });
    doc.addPage();

    // =====================
    // API Sections
    // =====================
    sections.forEach((section, index) => {
      this.addSectionHeader(doc, `${index + 1}. ${section.title}`);
      section.apis.forEach((api) => this.addApiEndpoint(doc, api));
      doc.addPage();
    });

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => {
        this.logger.log(`✅ PDF generated: ${outputPath}`);
        resolve(outputPath);
      });
      stream.on('error', reject);
    });
  }

  // =====================
  // Helper Methods
  // =====================

  private addTitle(doc: any, text: string) {
    doc.fontSize(24).font('Helvetica-Bold').text(text, { align: 'center' });
    doc.moveDown();
  }

  private addSubtitle(doc: any, text: string) {
    doc.fontSize(16).font('Helvetica').text(text, { align: 'center' });
    doc.moveDown();
  }

  private addSectionHeader(doc: any, text: string) {
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2563eb').text(text);
    doc.moveDown(0.5);
    doc
      .strokeColor('#2563eb')
      .lineWidth(2)
      .moveTo(50, doc.y)
      .lineTo(550, doc.y)
      .stroke();
    doc.moveDown();
    doc.fillColor('#000000');
  }

  private addText(doc: any, text: string) {
    doc.fontSize(10).font('Helvetica').text(text);
    doc.moveDown(0.3);
  }

  private addCode(doc: any, code: string) {
    doc
      .fontSize(9)
      .font('Courier')
      .fillColor('#1e293b')
      .text(code, { indent: 20 });
    doc.moveDown(0.5);
    doc.fillColor('#000000');
  }

  private addApiEndpoint(doc: any, api: ApiEndpoint) {
    // API Name
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a').text(api.name);
    doc.moveDown(0.3);

    // Method + Endpoint
    const methodColor = this.getMethodColor(api.method);
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(methodColor)
      .text(api.method, { continued: true });
    doc.font('Courier').fillColor('#000000').text(` ${api.endpoint}`);
    doc.moveDown(0.3);

    // Description
    doc.fontSize(10).font('Helvetica').text(api.description);
    doc.moveDown(0.3);

    // Auth
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Authentication: ', { continued: true });
    doc
      .font('Helvetica')
      .text(api.authRequired ? 'Required (Bearer Token)' : 'Not Required');

    if (api.roles && api.roles.length > 0) {
      doc.font('Helvetica-Bold').text('Roles: ', { continued: true });
      doc.font('Helvetica').text(api.roles.join(', '));
    }

    doc.moveDown(0.3);

    // Request Example
    if (api.requestExample) {
      doc.fontSize(9).font('Helvetica-Bold').text('Request Payload:');
      this.addCode(doc, JSON.stringify(api.requestExample, null, 2));
    }

    // Response Example
    if (api.responseExample) {
      doc.fontSize(9).font('Helvetica-Bold').text('Response Example:');
      this.addCode(doc, JSON.stringify(api.responseExample, null, 2));
    }

    doc.moveDown(1);
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(1)
      .moveTo(50, doc.y)
      .lineTo(550, doc.y)
      .stroke();
    doc.moveDown(1);
  }

  private getMethodColor(method: string): string {
    const colors: Record<string, string> = {
      GET: '#10b981',
      POST: '#3b82f6',
      PUT: '#f59e0b',
      PATCH: '#8b5cf6',
      DELETE: '#ef4444',
    };
    return colors[method] || '#000000';
  }
}
