import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reusable Auto-Number Generator Service
 * Generates sequential numbers for all HRMS modules
 * Pattern: PREFIX + NUMBER (e.g., CG-11001, CC-11002, etc.)
 */
@Injectable()
export class AutoNumberService {
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            '11001'
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
            // Fetch all records starting with prefix to find the TRUE maximum
            const existingRecords = await (this.prisma as any)[modelName].findMany({
                where: { [fieldName]: { startsWith: prefix, mode: 'insensitive' } },
                select: { [fieldName]: true }
            });

            for (const rec of existingRecords) {
                const raw = rec[fieldName].toString();
                const numPart = raw.replace(new RegExp(prefix, 'i'), '');
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
        while ((await checkExists(finalNo)) && safetyCounter < 100) {
            nextNum++;
            finalNo = `${prefix}${nextNum}`;
            safetyCounter++;
        }

        return finalNo;
    }
}
