
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- ALL COMPLETED TASKS OWNERSHIP ---');
    const tasks = await prisma.completedTask.findMany({
        select: {
            id: true,
            taskNo: true,
            taskTitle: true,
            createdBy: true,
            assignedTo: true,
            workingBy: true,
            targetTeamId: true,
            targetGroupId: true
        }
    });

    console.log(JSON.stringify(tasks, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
