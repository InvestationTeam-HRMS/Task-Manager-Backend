import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

@Injectable()
export class ExcelDownloadService {
    /**
     * Generate and stream an Excel file with standard HRMS formatting
     * @param res Express Response object
     * @param data Array of data objects
     * @param columns Column definitions { header: string, key: string, width?: number }
     * @param fileName Name of the file to be downloaded
     * @param sheetName Name of the worksheet
     */
    async downloadExcel(
        res: Response,
        data: any[],
        columns: { header: string; key: string; width?: number }[],
        fileName: string = 'export.xlsx',
        sheetName: string = 'Data'
    ) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        // 1. Set Columns
        worksheet.columns = columns.map((col) => ({
            header: col.header,
            key: col.key,
            width: col.width || 20,
        }));

        // 2. Add Data Rows
        worksheet.addRows(data);

        // 3. Overall Formatting
        worksheet.eachRow((row, rowNumber) => {
            // Header Row Styling
            if (rowNumber === 1) {
                row.height = 30; // Increased height for premium look
                row.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6B8B7' }, // Header Colour - #E6B8B7
                    };
                    cell.font = {
                        bold: true,
                        size: 11,
                        color: { argb: 'FF000000' },
                    };
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: 'center',
                    };
                });
            } else {
                row.height = 20; // Slightly taller data rows
            }

            // Apply borders and vertical alignment to ALL cells
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };

                // Vertical middle all cells
                if (!cell.alignment) {
                    cell.alignment = { vertical: 'middle' };
                } else {
                    cell.alignment.vertical = 'middle';
                }

                // Horizontal center for # or specific columns
                if (columns[colNumber - 1]?.header === '#' || columns[colNumber - 1]?.key === '#') {
                    cell.alignment.horizontal = 'center';
                }
            });
        });

        // 4. Add Filter on all columns
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };

        // 5. Column width autoset based on content
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

            // Padding and bounds
            column.width = Math.min(Math.max(maxLength + 4, 12), 50);
        });

        // 6. Finalize response
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${fileName}"`,
        );

        await workbook.xlsx.write(res);
        res.end();
    }
}
