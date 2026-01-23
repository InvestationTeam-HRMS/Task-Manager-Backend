
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    console.log('Migrating UserStatus...');

    try {
        // Try adding values one by one
        const values = ['Active', 'Inactive', 'Suspended', 'Pending_Verification'];
        for (const v of values) {
            try {
                await prisma.$executeRawUnsafe(`ALTER TYPE "UserStatus" ADD VALUE '${v}'`);
                console.log(`Added ${v}`);
            } catch (e) {
                console.log(`${v} already exists or error: ${e.message}`);
            }
        }

        // Update rows
        const result = await prisma.$executeRawUnsafe(`UPDATE "users" SET "status" = 'Active'::"UserStatus" WHERE "status"::text = 'ACTIVE'`);
        console.log(`Updated ${result} users to Active`);

        const result2 = await prisma.$executeRawUnsafe(`UPDATE "users" SET "status" = 'Pending_Verification'::"UserStatus" WHERE "status"::text = 'PENDING_VERIFICATION'`);
        console.log(`Updated ${result2} users to Pending_Verification`);

    } catch (error) {
        console.error('Core Migration failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
