
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const adminId = 'ed9176a0-9ac9-4b40-86b2-28c8eac92b2a'; // Admin from logs
    const hrId = '6f2f43e8-8aaf-47bf-959f-95edc398dad6'; // HR from logs

    console.log('--- REPRODUCE VISIBILITY ---');

    // 1. Create a task created by Admin, Unassigned (Group task)
    const taskNo = 'V-DEBUG-1';
    await prisma.pendingTask.upsert({
        where: { taskNo },
        update: {},
        create: {
            taskNo,
            taskTitle: 'Visibility Debug Task',
            taskStatus: 'Pending',
            createdBy: adminId,
            assignedTo: null,
            targetGroupId: 'b0e5baf7-2737-4f9f-8dd6-dd94b0af06a5', // Doremon Group
            createdTime: new Date(),
            updatedAt: new Date()
        }
    });

    // 2. Test Admin's MY_PENDING
    const adminMyPending = await prisma.pendingTask.findMany({
        where: {
            AND: [
                {
                    OR: [
                        { assignedTo: adminId },
                        { targetTeamId: adminId },
                        {
                            targetGroup: { members: { some: { userId: adminId } } },
                            assignedTo: null,
                            taskAcceptances: { none: { userId: adminId, status: 'REJECTED' } },
                            createdBy: { not: adminId }
                        }
                    ],
                    taskStatus: 'Pending'
                }
            ]
        }
    });
    console.log(`Admin MY_PENDING count for ${taskNo}: ${adminMyPending.filter(t => t.taskNo === taskNo).length}`);

    // 3. Test Admin's TEAM_PENDING
    const adminTeamPending = await prisma.pendingTask.findMany({
        where: {
            AND: [
                {
                    createdBy: adminId,
                    taskStatus: 'Pending',
                    AND: [
                        { OR: [{ assignedTo: { not: adminId } }, { assignedTo: null }] },
                        { OR: [{ targetTeamId: { not: adminId } }, { targetTeamId: null }] }
                    ]
                }
            ]
        }
    });
    console.log(`Admin TEAM_PENDING count for ${taskNo}: ${adminTeamPending.filter(t => t.taskNo === taskNo).length}`);

    // 4. Test HR's MY_PENDING
    const hrMyPending = await prisma.pendingTask.findMany({
        where: {
            AND: [
                {
                    OR: [
                        { assignedTo: hrId },
                        { targetTeamId: hrId },
                        {
                            targetGroup: { members: { some: { userId: hrId } } },
                            assignedTo: null,
                            taskAcceptances: { none: { userId: hrId, status: 'REJECTED' } },
                            createdBy: { not: hrId }
                        }
                    ],
                    taskStatus: 'Pending'
                }
            ]
        }
    });
    console.log(`HR MY_PENDING count for ${taskNo}: ${hrMyPending.filter(t => t.taskNo === taskNo).length}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
