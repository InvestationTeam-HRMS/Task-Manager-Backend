const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
    const enumsToFix = [
        { type: 'ClientGroupStatus', values: ['Active', 'Inactive'], table: 'client_groups' },
        { type: 'CompanyStatus', values: ['Active', 'Inactive'], table: 'client_companies' },
        { type: 'LocationStatus', values: ['Active', 'Inactive'], table: 'client_locations' },
        { type: 'SubLocationStatus', values: ['Active', 'Inactive'], table: 'sub_locations' }
    ];

    for (const item of enumsToFix) {
        try {
            console.log(`Fixing enum: ${item.type}`);
            // Add new values
            for (const val of item.values) {
                await prisma.$executeRawUnsafe(`ALTER TYPE "${item.type}" ADD VALUE IF NOT EXISTS '${val}'`).catch(e => console.log(`  Value ${val} might already exist or error: ${e.message}`));
            }
            // Update data
            for (const val of item.values) {
                const oldVal = val.toUpperCase();
                const rows = await prisma.$executeRawUnsafe(`UPDATE ${item.table} SET status = '${val}' WHERE status::text = '${oldVal}'`);
                console.log(`  Updated ${rows} rows in ${item.table} from ${oldVal} to ${val}`);
            }
        } catch (e) {
            console.error(`  Failed to fix ${item.type}:`, e.message);
        }
    }
}
main().finally(() => prisma.$disconnect());
