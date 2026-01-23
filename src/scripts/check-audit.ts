import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Last 5 Audit Logs ---');
    const logs = await prisma.auditLog.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            action: true,
            entity: true,
            entityId: true,
            createdAt: true,
            oldValue: true,
            newValue: true
        }
    });
    console.log(JSON.stringify(logs, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
