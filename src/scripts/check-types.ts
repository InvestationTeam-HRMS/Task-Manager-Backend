
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const types = await prisma.$queryRawUnsafe(`
            SELECT n.nspname as schema, t.typname as "typeName"
            FROM pg_type t 
            JOIN pg_enum e ON t.oid = e.enumtypid 
            JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace 
            GROUP BY n.nspname, t.typname;
        `);
        console.log('Detected Enum Types:', JSON.stringify(types, null, 2));
    } catch (error) {
        console.error('Error fetching types:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
