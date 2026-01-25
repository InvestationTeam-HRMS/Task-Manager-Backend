import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin-01@investationteam.com';
    const user = await prisma.team.findUnique({
        where: { email },
        select: { id: true, email: true, role: true, status: true, firstName: true }
    });

    if (user) {
        console.log('✅ VERIFICATION SUCCESS: User found in database.');
        console.log(JSON.stringify(user, null, 2));
    } else {
        console.error('❌ VERIFICATION FAILED: User NOT found in database.');
    }
}

main()
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());
