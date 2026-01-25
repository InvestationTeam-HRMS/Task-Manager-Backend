import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Database Debug ---');
    console.log('DATABASE_URL:', process.env.DATABASE_URL);

    try {
        const roles = await prisma.role.findMany();
        console.log(`Found ${roles.length} roles:`);
        roles.forEach(role => {
            console.log(`- ${role.name} (AccessRight size: ${JSON.stringify(role.permissions).length} chars)`);
        });

        const admin = await prisma.team.findUnique({ where: { email: 'admin-01@investationteam.com' } });
        console.log('Admin user found:', !!admin);
        if (admin) {
            console.log('Admin Role:', admin.role);
        }
    } catch (e) {
        console.error('Error querying DB:', e.message);
    }
}

main().finally(() => prisma.$disconnect());
