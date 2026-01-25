const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});
async function main() {
    try {
        const tables = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
        console.log(JSON.stringify(tables, null, 2));
    } catch (e) {
        console.error(e);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
