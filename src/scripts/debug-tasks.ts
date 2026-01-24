
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Fetching latest 5 pending tasks...');
    const tasks = await prisma.pendingTask.findMany({
        take: 5,
        orderBy: { creatingTime: 'desc' },
        include: {
            assignee: true,
            targetTeam: true,
            targetGroup: true
        }
    });

    console.log('Found tasks:', tasks.length);
    tasks.forEach(task => {
        console.log('------------------------------------------------');
        console.log(`Task No: ${task.taskNo}`);
        console.log(`Title: ${task.taskTitle}`);
        console.log(`Assigned To ID: ${task.assignedTo}`);
        console.log(`Assignee Object:`, task.assignee ? {
            id: task.assignee.id,
            firstName: task.assignee.firstName,
            lastName: task.assignee.lastName,
            email: task.assignee.email,
            teamName: task.assignee.teamName
        } : 'NULL');
        console.log(`Target Team ID: ${task.targetTeamId}`);
        console.log(`Target Group ID: ${task.targetGroupId}`);
    });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
