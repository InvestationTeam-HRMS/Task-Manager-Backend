import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import csvParser from 'csv-parser';
import { toTitleCase } from '../utils/string-helper';

/**
 * Reusable Excel/CSV Upload Service
 * Handles parsing of Excel and CSV files for all HRMS modules
 */
@Injectable()
export class ExcelUploadService {
  private readonly logger = new Logger(ExcelUploadService.name);

  private normalizeHeader(value: string): string {
    return value.toLowerCase().trim().replace(/[\s_-]/g, '');
  }

  private normalizeMapping(
    columnMapping: Record<string, string[]>,
  ): Record<string, string[]> {
    const normalized: Record<string, string[]> = {};
    for (const [key, names] of Object.entries(columnMapping)) {
      normalized[key] = names.map((n) => this.normalizeHeader(n));
    }
    return normalized;
  }

  private buildColumnKeys(
    headers: Record<string, any>,
    columnMapping: Record<string, string[]>,
    requiredColumns: string[],
  ) {
    const getColKey = (possibleKeys: string[]) =>
      possibleKeys.find((k) => headers[k] !== undefined);

    const missingColumns: string[] = [];
    const columnKeys: Record<string, string | undefined> = {};

    for (const [key, possibleNames] of Object.entries(columnMapping)) {
      const foundKey = getColKey(possibleNames);
      columnKeys[key] = foundKey;
      if (requiredColumns.includes(key) && !foundKey) {
        missingColumns.push(possibleNames[0]);
      }
    }

    return { columnKeys, missingColumns };
  }

  private extractCellValue(val: any): string {
    if (val === null || val === undefined) {
      return '';
    }

    if (val instanceof Date) {
      return val.toISOString();
    }

    if (typeof val === 'object') {
      if ('result' in val) {
        return (val as any).result?.toString().trim() || '';
      }
      if ('text' in val) {
        return (val as any).text?.toString().trim() || '';
      }
      if ('richText' in val) {
        return (val as any).richText
          .map((rt: any) => rt.text)
          .join('')
          .trim();
      }
      return '';
    }

    return val.toString().trim();
  }

  private transformValue(key: string, value: string): string {
    if (value === '') return '';

    if (key.toLowerCase().includes('code')) {
      return value.toUpperCase();
    }

    const excluded = ['email', 'password', 'id', 'swrkey', 'status', 'token'];
    if (
      !excluded.some((ex) => key.toLowerCase().includes(ex)) &&
      !key.endsWith('Id')
    ) {
      return toTitleCase(value);
    }

    return value;
  }

  /**
   * Parse Excel or CSV file and extract data
   * @param file - Uploaded file buffer
   * @param columnMapping - Mapping of expected columns to their possible names
   * @param requiredColumns - List of required column keys
   * @returns Parsed rows as array of objects
   */
  async parseFile<T>(
    file: Express.Multer.File,
    columnMapping: Record<string, string[]>,
    requiredColumns: string[],
  ): Promise<{ data: T[]; errors: any[] }> {
    this.logger.log(
      `[PARSE_FILE] File: ${file?.originalname} | Size: ${file?.size}`,
    );

    if (!file || (!file.buffer && !file.path)) {
      throw new BadRequestException('No file data received.');
    }

    const fileName = (file.originalname || file.path || '').toLowerCase();
    const normalizedMapping = this.normalizeMapping(columnMapping);
    const filePath = file.path;

    try {
      if (filePath) {
        if (fileName.endsWith('.xlsx')) {
          return await this.parseXlsxFromFile<T>(
            filePath,
            fileName,
            normalizedMapping,
            requiredColumns,
          );
        }

        if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
          return await this.parseCsvFromFile<T>(
            filePath,
            fileName,
            normalizedMapping,
            requiredColumns,
          );
        }

        throw new BadRequestException(
          'Unsupported file format. Please upload a valid .xlsx or .csv file.',
        );
      }

      return await this.parseFromBuffer<T>(
        file.buffer,
        fileName,
        normalizedMapping,
        requiredColumns,
      );
    } finally {
      if (filePath) {
        await fs.promises.unlink(filePath).catch(() => undefined);
      }
    }
  }

  private async parseXlsxFromFile<T>(
    filePath: string,
    fileName: string,
    columnMapping: Record<string, string[]>,
    requiredColumns: string[],
  ): Promise<{ data: T[]; errors: any[] }> {
    this.logger.log(`[PARSE_FILE] Using XLSX streaming parser for ${fileName}`);

    const parsedData: T[] = [];
    const parseErrors: any[] = [];
    const headers: Record<string, number> = {};
    let columnKeys: Record<string, string | undefined> = {};
    let headerParsed = false;

    const workbookReader = new (ExcelJS as any).stream.xlsx.WorkbookReader(
      filePath,
      {
        entries: 'emit',
        sharedStrings: 'cache',
        worksheets: 'emit',
      },
    );

    for await (const worksheetReader of workbookReader) {
      if (worksheetReader.id && worksheetReader.id !== 1) continue;
      for await (const row of worksheetReader) {
        if (!row || !row.hasValues) continue;

        if (!headerParsed) {
          const values: any[] = row.values || [];
          values.forEach((val, idx) => {
            if (idx === 0) return;
            const headerVal = this.extractCellValue(val);
            const normalized = this.normalizeHeader(headerVal);
            if (normalized) headers[normalized] = idx;
          });

          const built = this.buildColumnKeys(
            headers,
            columnMapping,
            requiredColumns,
          );
          columnKeys = built.columnKeys;
          if (built.missingColumns.length > 0) {
            throw new BadRequestException(
              `Invalid format. Missing required columns: ${built.missingColumns.join(', ')}`,
            );
          }

          headerParsed = true;
          continue;
        }

        try {
          const rowData: any = {};
          for (const [key, colKey] of Object.entries(columnKeys)) {
            if (!colKey || headers[colKey] === undefined) {
              rowData[key] = '';
              continue;
            }

            const colIdx = headers[colKey];
            const cellValue =
              typeof row.getCell === 'function'
                ? row.getCell(colIdx)?.value
                : (row.values || [])[colIdx];

            if (cellValue === null || cellValue === undefined) {
              rowData[key] = '';
              continue;
            }

            const rawValue = this.extractCellValue(cellValue);
            rowData[key] = this.transformValue(key, rawValue);
          }

          parsedData.push(rowData as T);
        } catch (e) {
          parseErrors.push({ row: row.number, error: e.message });
        }
      }
      break;
    }

    if (!headerParsed) {
      throw new BadRequestException('The file is empty or missing data rows.');
    }

    this.logger.log(
      `[PARSE_FILE_COMPLETE] Parsed ${parsedData.length} valid records. Parse failures: ${parseErrors.length}`,
    );

    return { data: parsedData, errors: parseErrors };
  }

  private async parseCsvFromFile<T>(
    filePath: string,
    fileName: string,
    columnMapping: Record<string, string[]>,
    requiredColumns: string[],
  ): Promise<{ data: T[]; errors: any[] }> {
    this.logger.log(`[PARSE_FILE] Using CSV streaming parser for ${fileName}`);

    const parsedData: T[] = [];
    const parseErrors: any[] = [];
    let headers: Record<string, string> = {};
    let columnKeys: Record<string, string | undefined> = {};
    let headerReady = false;
    let rowNumber = 1;

    return await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('headers', (rawHeaders: string[]) => {
          headers = {};
          rawHeaders.forEach((h) => {
            const normalized = this.normalizeHeader(h);
            if (normalized) headers[normalized] = h;
          });

          const built = this.buildColumnKeys(
            headers,
            columnMapping,
            requiredColumns,
          );
          columnKeys = built.columnKeys;
          if (built.missingColumns.length > 0) {
            reject(
              new BadRequestException(
                `Invalid format. Missing required columns: ${built.missingColumns.join(', ')}`,
              ),
            );
            return;
          }

          headerReady = true;
        })
        .on('data', (row: any) => {
          rowNumber += 1;
          if (!headerReady) return;

          try {
            const rowData: any = {};
            for (const [key, colKey] of Object.entries(columnKeys)) {
              if (!colKey || !headers[colKey]) {
                rowData[key] = '';
                continue;
              }

              const headerName = headers[colKey];
              const rawValue =
                row[headerName] !== undefined && row[headerName] !== null
                  ? String(row[headerName]).trim()
                  : '';

              rowData[key] = this.transformValue(key, rawValue);
            }

            parsedData.push(rowData as T);
          } catch (e) {
            parseErrors.push({ row: rowNumber, error: e.message });
          }
        })
        .on('end', () => {
          if (!headerReady) {
            reject(
              new BadRequestException(
                'The file is empty or missing data rows.',
              ),
            );
            return;
          }

          this.logger.log(
            `[PARSE_FILE_COMPLETE] Parsed ${parsedData.length} valid records. Parse failures: ${parseErrors.length}`,
          );
          resolve({ data: parsedData, errors: parseErrors });
        })
        .on('error', (error) => {
          reject(
            new BadRequestException(
              `Failed to parse CSV file. ${error.message}`,
            ),
          );
        });
    });
  }

  private async parseFromBuffer<T>(
    buffer: Buffer,
    fileName: string,
    columnMapping: Record<string, string[]>,
    requiredColumns: string[],
  ): Promise<{ data: T[]; errors: any[] }> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No file data received.');
    }

    const workbook = new ExcelJS.Workbook();
    let formatUsed = '';

    try {
      if (fileName.endsWith('.xlsx')) {
        formatUsed = 'XLSX';
        await workbook.xlsx.load(buffer as any);
      } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
        formatUsed = 'CSV';
        const bufferStream = new PassThrough();
        bufferStream.end(buffer as any);
        await workbook.csv.read(bufferStream);
      } else {
        throw new BadRequestException(
          'Unsupported file format. Please upload a valid .xlsx or .csv file.',
        );
      }
    } catch (error) {
      this.logger.error(
        `[PARSE_FILE_FAILED] Format: ${formatUsed}, File: ${fileName}, Error: ${error.message}`,
      );
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `Failed to parse ${formatUsed} file. Please ensure the file is not corrupted.`,
      );
    }

    const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('The file is empty or missing data rows.');
    }

    const headerRow = worksheet.getRow(1);
    const headers: Record<string, number> = {};

    headerRow.eachCell((cell, colNumber) => {
      const val = this.normalizeHeader(this.extractCellValue(cell.value));
      if (val) headers[val] = colNumber;
    });

    const built = this.buildColumnKeys(headers, columnMapping, requiredColumns);
    const columnKeys = built.columnKeys;
    if (built.missingColumns.length > 0) {
      throw new BadRequestException(
        `Invalid format. Missing required columns: ${built.missingColumns.join(', ')}`,
      );
    }

    const parsedData: T[] = [];
    const parseErrors: any[] = [];

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      if (!row || !row.hasValues) continue;

      try {
        const rowData: any = {};
        for (const [key, colKey] of Object.entries(columnKeys)) {
          if (!colKey || headers[colKey] === undefined) {
            rowData[key] = '';
            continue;
          }

          const colIdx = headers[colKey];
          const cell = row.getCell(colIdx);
          const rawValue = this.extractCellValue(cell?.value);
          rowData[key] = this.transformValue(key, rawValue);
        }
        parsedData.push(rowData as T);
      } catch (e) {
        parseErrors.push({ row: i, error: e.message });
      }
    }

    return { data: parsedData, errors: parseErrors };
  }

  /**
   * Chunk an array into smaller pieces for batch processing
   */
  chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  validateEnum(value: string, enumObj: any, fieldName: string): string {
    const validValues = Object.values(enumObj) as string[];
    const trimmedVal = value.trim();

    // Case-insensitive find
    const match = validValues.find(
      (v) => String(v).toLowerCase() === trimmedVal.toLowerCase(),
    );

    if (trimmedVal && !match) {
      throw new Error(
        `Invalid ${fieldName}: "${value}". Allowed: ${validValues.join(', ')}`,
      );
    }
    return (match as string) || trimmedVal; // Return the actual enum value (with correct casing) if found
  }
}
