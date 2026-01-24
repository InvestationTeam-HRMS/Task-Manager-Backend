
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Latest Tasks ---');
    const tasks = await prisma.pendingTask.findMany({
        take: 5,
        orderBy: { creatingTime: 'desc' },
        include: {
            assignee: true,
            targetTeam: true,
            targetGroup: true
        }
    });

    console.log(JSON.stringify(tasks, null, 2));

    console.log('--- Checking All Users ---');
    const users = await prisma.user.findMany({
        take: 5
    });
    console.log(JSON.stringify(users, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
