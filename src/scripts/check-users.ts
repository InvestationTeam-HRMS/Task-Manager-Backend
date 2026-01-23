
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const counts: any = await prisma.$queryRawUnsafe(`
            SELECT "status"::text, count(*)::text as count
            FROM "users" 
            GROUP BY "status"::text
        `);
        console.log('User Status Counts:', JSON.stringify(counts, null, 2));
    } catch (error) {
        console.error('Error fetching counts:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
