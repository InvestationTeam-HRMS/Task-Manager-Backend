
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const taskNo = '#11001';
    console.log(`--- DUMPING TASK ${taskNo} ---`);

    const task = await prisma.pendingTask.findFirst({
        where: { taskNo },
        include: { targetGroup: true }
    });

    if (!task) {
        console.log('Not found in PendingTask. Checking CompletedTask...');
        const completed = await prisma.completedTask.findFirst({
            where: { taskNo },
            include: { targetGroup: true }
        });
        console.log(JSON.stringify(completed, null, 2));
    } else {
        console.log(JSON.stringify(task, null, 2));
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
