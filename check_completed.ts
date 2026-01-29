
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- RECENT COMPLETED TASKS ---');
    const tasks = await prisma.completedTask.findMany({
        take: 5,
        orderBy: { completedAt: 'desc' },
        include: {
            assignee: { select: { email: true } },
            worker: { select: { email: true } },
            creator: { select: { email: true } }
        }
    });

    console.log(JSON.stringify(tasks, (key, value) =>
        key === 'attachments' ? undefined : value
        , 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
