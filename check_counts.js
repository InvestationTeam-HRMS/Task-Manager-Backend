const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
    try {
        const users = await prisma.$queryRawUnsafe("SELECT COUNT(*) FROM users").catch(() => [{ count: 0 }]);
        const tasks = await prisma.$queryRawUnsafe("SELECT COUNT(*) FROM tasks").catch(() => [{ count: 0 }]);
        const client_groups = await prisma.$queryRawUnsafe("SELECT COUNT(*) FROM client_groups").catch(() => [{ count: 0 }]);

        const serialize = (obj) => JSON.parse(JSON.stringify(obj, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));

        console.log(JSON.stringify(serialize({ users, tasks, client_groups }), null, 2));
    } catch (e) {
        console.error(e);
    }
}
main().finally(() => prisma.$disconnect());
