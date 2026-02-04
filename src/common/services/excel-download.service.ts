import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

@Injectable()
export class ExcelDownloadService {
  async downloadExcel(
    res: Response,
    data: any[],
    columns: { header: string; key: string; width?: number }[],
    fileName: string = 'export.xlsx',
    sheetName: string = 'Data',
  ) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);
    const isLargeDataset = data.length > 5000;

    // 1. Set Columns
    worksheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 20,
    }));

    // 2. Add Data
    worksheet.addRows(data);

    // 3. Formatting - SKIP expensive formatting for very large datasets
    if (!isLargeDataset) {
      worksheet.eachRow((row, rowNumber) => {
        // ===== HEADER ROW =====
        if (rowNumber === 1) {
          row.height = 30;
          row.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE6B8B7' },
            };
            cell.font = { bold: true, size: 11, color: { argb: 'FF000000' } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' },
            };
          });
        }
        // ===== DATA ROWS =====
        else {
          row.height = 20;
          row.eachCell({ includeEmpty: true }, (cell) => {
            if (cell.value === undefined || cell.value === null || cell.value === '') {
              cell.value = '-';
            }
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          });
        }
      });

      // 4. Auto Filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };

      // 5. Auto Column Width
      worksheet.columns.forEach((column: any) => {
        let maxLength = 0;
        const headerText = column.header ? column.header.toString() : '';
        maxLength = headerText.length;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(Math.max(maxLength + 4, 12), 50);
      });
    } else {
      // Basic minimal formatting for large files to keep them readable but fast
      worksheet.getRow(1).font = { bold: true };
    }

    // 6. Response
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }
}
