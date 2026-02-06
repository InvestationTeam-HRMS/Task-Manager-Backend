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
    const safeString = (value: any) => {
      if (value === null || value === undefined) return '-';
      if (value instanceof Date) return value.toLocaleDateString();
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object') return JSON.stringify(value);
      const str = value.toString();
      return str.trim() === '' ? '-' : str;
    };

    // 1. Set Columns
    worksheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 20,
    }));

    // 2. Add Data
    const normalizedData = data.map((row) => {
      const normalizedRow: Record<string, any> = {};
      columns.forEach((col) => {
        normalizedRow[col.key] = safeString(row?.[col.key]);
      });
      return normalizedRow;
    });
    worksheet.addRows(normalizedData);

    // 3. Always apply consistent header styling (cheap, even for large datasets)
    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6B8B7' },
      };
      cell.font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'left',
        indent: 1,
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // 4. Auto Filter (always, to match template)
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };

    // 5. Data formatting (always) - align and keep values under correct columns
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'left',
          indent: 1,
        };
      });
    });

    // 6. Auto Column Width (based on actual data)
    const maxLengths = columns.map((col) => (col.header || '').toString().length);
    normalizedData.forEach((row) => {
      columns.forEach((col, idx) => {
        const value = safeString(row[col.key]);
        const len = value.length;
        if (len > maxLengths[idx]) {
          maxLengths[idx] = len;
        }
      });
    });
    worksheet.columns.forEach((column: any, idx: number) => {
      column.width = Math.min(Math.max(maxLengths[idx] + 4, 12), 50);
    });

    // 7. Response
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }
}
