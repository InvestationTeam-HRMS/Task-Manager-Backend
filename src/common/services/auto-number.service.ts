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
            'U_NUMBER_PREFIX',
            'U_NUMBER_START',
            'U-',
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
     */
    async generateTaskNo(): Promise<string> {
        return this.generateNumber(
            'task',
            'taskNo',
            'T_NUMBER_PREFIX',
            'T_NUMBER_START',
            'T-',
            '11001'
        );
    }

    /**
     * Generic number generator
     * @param modelName - Prisma model name (e.g., 'clientGroup')
     * @param fieldName - Field name for the number (e.g., 'groupNo')
     * @param prefixEnvKey - Environment variable key for prefix
     * @param startEnvKey - Environment variable key for start number
     * @param defaultPrefix - Default prefix if env not set
     * @param defaultStart - Default start number if env not set
     */
    private async generateNumber(
        modelName: string,
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

        // Get the last record ordered by the number field
        const lastRecord = await (this.prisma as any)[modelName].findFirst({
            orderBy: { [fieldName]: 'desc' },
            select: { [fieldName]: true },
        });

        let nextNumber = startNumber;

        if (lastRecord && lastRecord[fieldName]) {
            const lastNumber = parseInt(
                lastRecord[fieldName].replace(prefix, ''),
            );
            nextNumber = lastNumber + 1;
        }

        return `${prefix}${nextNumber}`;
    }
}
