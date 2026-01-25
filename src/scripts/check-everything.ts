import { PrismaClient } from '@prisma/client';

const dbUrl = 'postgresql://postgres:gaurav%40%402004@localhost:5432/hrms_db?schema=public';
const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
});

async function main() {
    const email = 'admin-01@investationteam.com';
    const user = await prisma.team.findUnique({
        where: { email },
        select: { id: true, email: true, role: true, status: true, allowedIps: true }
    });

    console.log('--- User Status ---');
    console.log(JSON.stringify(user, null, 2));

    const roles = await prisma.role.findMany();
    console.log('\n--- Roles and Permissions ---');
    console.log(JSON.stringify(roles, null, 2));
}

main()
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());
