import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { toTitleCase } from '../utils/string-helper';

/**
 * Reusable Excel/CSV Upload Service
 * Handles parsing of Excel and CSV files for all HRMS modules
 */
@Injectable()
export class ExcelUploadService {
    private readonly logger = new Logger(ExcelUploadService.name);

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

        if (!file || !file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('No file data received.');
        }

        const buffer = file.buffer;
        const fileName = file.originalname.toLowerCase();

        // Identify format: XLSX starts with 'PK' (0x50 0x4B)
        const isXlsxSignature = buffer[0] === 0x50 && buffer[1] === 0x4b;
        const isCsvExtension = fileName.endsWith('.csv');

        const workbook = new ExcelJS.Workbook();
        let formatUsed = '';

        try {
            if (isXlsxSignature) {
                formatUsed = 'XLSX';
                this.logger.log(`[PARSE_FILE] Using XLSX parser for ${fileName}`);
                await workbook.xlsx.load(buffer as any);
            } else if (isCsvExtension || fileName.endsWith('.txt')) {
                formatUsed = 'CSV';
                this.logger.log(`[PARSE_FILE] Using CSV parser for ${fileName}`);
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
            throw new BadRequestException(
                'The file is empty or missing data rows.',
            );
        }

        // Read header row (Row 1) to determine column indices dynamically
        const headerRow = worksheet.getRow(1);
        const headers: Record<string, number> = {};

        headerRow.eachCell((cell, colNumber) => {
            const val =
                cell.value
                    ?.toString()
                    .toLowerCase()
                    .trim()
                    .replace(/[\s_-]/g, '') || '';
            if (val) headers[val] = colNumber;
        });

        this.logger.log(`[PARSE_FILE_HEADERS] Found: ${JSON.stringify(headers)}`);

        // Helper to find column key
        const getColKey = (possibleKeys: string[]) =>
            possibleKeys.find((k) => headers[k] !== undefined);

        // Validate required columns
        const missingColumns: string[] = [];
        const columnKeys: Record<string, string | undefined> = {};

        for (const [key, possibleNames] of Object.entries(columnMapping)) {
            const foundKey = getColKey(possibleNames);
            columnKeys[key] = foundKey;
            if (requiredColumns.includes(key) && !foundKey) {
                missingColumns.push(possibleNames[0]); // Use first possible name for error message
            }
        }

        if (missingColumns.length > 0) {
            throw new BadRequestException(
                `Invalid format. Missing required columns: ${missingColumns.join(', ')}`,
            );
        }

        const parsedData: T[] = [];
        const parseErrors: any[] = [];

        this.logger.log(
            `[PARSE_FILE_DATA] Processing worksheet with ${worksheet.rowCount} max rows.`,
        );

        // Parse data rows
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            if (!row || !row.hasValues) continue;

            try {
                const rowData: any = {};

                // Extract values for each mapped column
                for (const [key, colKey] of Object.entries(columnKeys)) {
                    if (!colKey || !headers[colKey]) {
                        rowData[key] = '';
                        continue;
                    }

                    const colIdx = headers[colKey];
                    const cell = row.getCell(colIdx);

                    if (!cell || cell.value === null || cell.value === undefined) {
                        rowData[key] = '';
                        continue;
                    }

                    const val = cell.value;

                    // Handle Date objects explicitly
                    if (val instanceof Date) {
                        rowData[key] = val.toISOString();
                        continue;
                    }

                    // Handle complex cell values (formulas, rich text, etc.)
                    if (val && typeof val === 'object') {
                        if ('result' in (val as any)) {
                            rowData[key] = (val as any).result?.toString().trim() || '';
                        } else if ('text' in (val as any)) {
                            rowData[key] = (val as any).text?.toString().trim() || '';
                        } else if ('richText' in (val as any)) {
                            rowData[key] = (val as any).richText
                                .map((rt: any) => rt.text)
                                .join('')
                                .trim();
                        } else {
                            rowData[key] = '';
                        }
                    } else if (val !== null && val !== undefined) {
                        rowData[key] = val.toString().trim();
                    } else {
                        rowData[key] = '';
                    }
                }

                parsedData.push(rowData as T);
            } catch (e) {
                parseErrors.push({ row: i, error: e.message });
            }
        }

        this.logger.log(
            `[PARSE_FILE_COMPLETE] Parsed ${parsedData.length} valid records. Parse failures: ${parseErrors.length}`,
        );

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
            (v) => v.toLowerCase() === trimmedVal.toLowerCase(),
        );

        if (trimmedVal && !match) {
            throw new Error(
                `Invalid ${fieldName}: "${value}". Allowed: ${validValues.join(', ')}`,
            );
        }
        return match || trimmedVal; // Return the actual enum value (with correct casing) if found
    }
}
