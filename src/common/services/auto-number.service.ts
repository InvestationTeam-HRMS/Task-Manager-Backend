import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reusable Auto-Number Generator Service
 * Generates sequential numbers for all Task Manager modules
 * Pattern: PREFIX + NUMBER (e.g., CG-11001, CC-11002, etc.)
 */
@Injectable()
export class AutoNumberService {
  private readonly modelTableMap: Record<string, string> = {
    clientGroup: 'client_groups',
    clientCompany: 'client_companies',
    clientLocation: 'client_locations',
    subLocation: 'sub_locations',
    project: 'projects',
    team: 'teams',
    group: 'groups',
    ipAddress: 'ip_addresses',
    pendingTask: 'pending_tasks',
    completedTask: 'completed_tasks',
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  /**
   * Generate next number for Client Group (CG-11001, CG-11002, etc.)
   */
  async generateClientGroupNo(): Promise<string> {
    return this.generateNumber(
      'clientGroup',
      'groupNo',
      'CG_NUMBER_PREFIX',
      'CG_NUMBER_START',
      'CG-',
      '11001',
    );
  }

  /**
   * Generate next number for Client Company (CC-11001, CC-11002, etc.)
   */
  async generateCompanyNo(): Promise<string> {
    return this.generateNumber(
      'clientCompany',
      'companyNo',
      'CC_NUMBER_PREFIX',
      'CC_NUMBER_START',
      'CC-',
      '11001',
    );
  }

  /**
   * Generate next number for Client Location (CL-11001, CL-11002, etc.)
   */
  async generateLocationNo(): Promise<string> {
    return this.generateNumber(
      'clientLocation',
      'locationNo',
      'CL_NUMBER_PREFIX',
      'CL_NUMBER_START',
      'CL-',
      '11001',
    );
  }

  /**
   * Generate next number for Sub Location (CS-11001, CS-11002, etc.)
   */
  async generateSubLocationNo(): Promise<string> {
    return this.generateNumber(
      'subLocation',
      'subLocationNo',
      'CS_NUMBER_PREFIX',
      'CS_NUMBER_START',
      'CS-',
      '11001',
    );
  }

  /**
   * Generate next number for Project (P-11001, P-11002, etc.)
   */
  async generateProjectNo(): Promise<string> {
    return this.generateNumber(
      'project',
      'projectNo',
      'P_NUMBER_PREFIX',
      'P_NUMBER_START',
      'P-',
      '11001',
    );
  }

  /**
   * Generate next number for Team (U-11001, U-11002, etc.)
   */
  async generateTeamNo(): Promise<string> {
    return this.generateNumber(
      'team',
      'teamNo',
      'TEAM_NUMBER_PREFIX',
      'TEAM_NUMBER_START',
      'T-',
      '11001',
    );
  }

  /**
   * Generate next number for Group (G-11001, G-11002, etc.)
   */
  async generateGroupNo(): Promise<string> {
    return this.generateNumber(
      'group',
      'groupNo',
      'G_NUMBER_PREFIX',
      'G_NUMBER_START',
      'G-',
      '11001',
    );
  }

  /**
   * Generate next number for IP Address (I-11001, I-11002, etc.)
   */
  async generateIpNo(): Promise<string> {
    return this.generateNumber(
      'ipAddress',
      'ipNo',
      'I_NUMBER_PREFIX',
      'I_NUMBER_START',
      'I-',
      '11001',
    );
  }

  /**
   * Generate next number for Task (T-11001, T-11002, etc.)
   * Checks BOTH Pending and Completed tables to prevent reuse
   */
  async generateTaskNo(): Promise<string> {
    return this.generateNumber(
      ['pendingTask', 'completedTask'], // Check both tables
      'taskNo',
      'TASK_NUMBER_PREFIX',
      'TASK_NUMBER_START',
      'T-',
      '11101',
    );
  }

  /**
   * Generic number generator
   * @param modelNames - Prisma model name(s) (e.g., 'clientGroup' or ['pendingTask', 'completedTask'])
   * @param fieldName - Field name for the number (e.g., 'groupNo')
   * @param prefixEnvKey - Environment variable key for prefix
   * @param startEnvKey - Environment variable key for start number
   * @param defaultPrefix - Default prefix if env not set
   * @param defaultStart - Default start number if env not set
   */
  private async generateNumber(
    modelNames: string | string[],
    fieldName: string,
    prefixEnvKey: string,
    startEnvKey: string,
    defaultPrefix: string,
    defaultStart: string,
  ): Promise<string> {
    const prefix = this.configService.get(prefixEnvKey, defaultPrefix);
    const startNumber = parseInt(
      this.configService.get(startEnvKey, defaultStart),
    );

    const models = Array.isArray(modelNames) ? modelNames : [modelNames];
    let maxNum = startNumber - 1;

    for (const modelName of models) {
      const maxFromDb = await this.getMaxNumericFromDb(
        modelName,
        fieldName,
        prefix,
      );
      if (maxFromDb !== null && !isNaN(maxFromDb)) {
        if (maxFromDb > maxNum) {
          maxNum = maxFromDb;
        }
        continue;
      }

      // Fetch top 10 records by field name descending to find the maximum number
      const topRecords = await (this.prisma as any)[modelName].findMany({
        where: { [fieldName]: { startsWith: prefix, mode: 'insensitive' } },
        select: { [fieldName]: true },
        orderBy: { [fieldName]: 'desc' },
        take: 10,
      });

      for (const rec of topRecords) {
        const raw = rec[fieldName].toString();
        // Extract number part more carefully
        const numPart = raw.toLowerCase().startsWith(prefix.toLowerCase())
          ? raw.substring(prefix.length)
          : raw.replace(new RegExp(`^${prefix}`, 'i'), '');

        const parsed = parseInt(numPart);
        if (!isNaN(parsed) && parsed > maxNum) {
          maxNum = parsed;
        }
      }
    }

    let nextNum = maxNum + 1;
    let finalNo = `${prefix}${nextNum}`;

    // --- FINAL SAFETY VERIFICATION ---
    // Even after finding max, we double check to handle gaps or race conditions
    const checkExists = async (val: string) => {
      for (const modelName of models) {
        const exists = await (this.prisma as any)[modelName].findFirst({
          where: { [fieldName]: { equals: val, mode: 'insensitive' } },
        });
        if (exists) return true;
      }
      return false;
    };

    let safetyCounter = 0;
    while (await checkExists(finalNo)) {
      nextNum++;
      finalNo = `${prefix}${nextNum}`;
      safetyCounter++;
      if (safetyCounter > 10000) {
        throw new Error(
          `Failed to generate unique number for ${fieldName}. Please retry.`,
        );
      }
    }

    return finalNo;
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  }

  private async getMaxNumericFromDb(
    modelName: string,
    fieldName: string,
    prefix: string,
  ): Promise<number | null> {
    const table = this.modelTableMap[modelName];
    if (!table) return null;
    const column = this.toSnakeCase(fieldName);

    if (!/^[a-z0-9_]+$/.test(table) || !/^[a-z0-9_]+$/.test(column)) {
      return null;
    }

    const likePattern = `${prefix}%`;
    const query = `
      SELECT MAX(NULLIF(REGEXP_REPLACE(${column}, '[^0-9]', '', 'g'), '')::bigint) AS max
      FROM ${table}
      WHERE ${column} ILIKE $1
    `;

    try {
      const result = await this.prisma.$queryRawUnsafe<
        Array<{ max: bigint | number | null }>
      >(query, likePattern);
      const maxVal = result?.[0]?.max;
      if (maxVal === null || maxVal === undefined) return null;
      return typeof maxVal === 'bigint' ? Number(maxVal) : Number(maxVal);
    } catch {
      return null;
    }
  }
}
