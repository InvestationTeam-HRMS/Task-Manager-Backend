
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        console.log('--- Checking Latest 5 Pending Tasks ---');
        // fetching as any to bypass strict typing issues during debug
        const tasks = await prisma.pendingTask.findMany({
            take: 5,
            orderBy: { creatingTime: 'desc' },
        });

        for (const task of tasks) {
            console.log(`Task: ${task.taskTitle} (${task.taskNo})`);
            console.log(`  ID: ${task.id}`);
            console.log(`  AssignedTo ID: ${task.assignedTo}`);

            if (task.assignedTo) {
                // Try to find if this ID exists in Team table
                const team = await prisma.team.findUnique({ where: { id: task.assignedTo } });
                if (team) {
                    console.log(`  -> Found in Team table: ${team.teamName}`);
                } else {
                    console.log(`  -> NOT Found in Team table`);
                    // Optionally check in User table if that exists separate from Team in your mind map, 
                    // but schema said relations point to Team. 
                    // Let's check generally just in case
                    // const user = await prisma.user.findUnique({ where: { id: task.assignedTo } });
                    // if (user) console.log(`  -> Found in User table: ${user.firstName} ${user.lastName}`);
                }
            } else {
                console.log(`  -> No assignment`);
            }
            console.log('-----------------------------------');
        }
    } catch (e) {
        console.error("Error running script:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
