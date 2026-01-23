
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const tables = [
            'client_groups',
            'client_companies',
            'client_locations',
            'sub_locations',
            'projects',
            'teams',
            'groups',
            'ip_addresses',
            'users'
        ];

        for (const table of tables) {
            console.log(`\n--- Table: ${table} ---`);
            const columnName = table === 'projects' ? 'status' : 'status'; // projects has both status and priority

            const results = await prisma.$queryRawUnsafe(`
                SELECT DISTINCT "${columnName}"::text as val, count(*) 
                FROM "${table}" 
                GROUP BY "${columnName}"
            `);
            console.log(JSON.stringify(results, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value, 2));

            if (table === 'projects') {
                const priorityResults: any = await prisma.$queryRawUnsafe(`
                    SELECT DISTINCT "priority"::text as val, count(*) 
                    FROM "projects" 
                    GROUP BY "priority"
                `);
                console.log('Priority:', JSON.stringify(priorityResults, (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value, 2));
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
