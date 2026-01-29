
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const adminId = 'ed9176a0-9ac9-4b40-86b2-28c8eac92b2a';
    const workerId = '6f2f43e8-8aaf-47bf-959f-95edc398dad6'; // Simulating the group member
    const groupId = 'b0e5baf7-2737-4f9f-8dd6-dd94b0af06a5'; // Doremon Group

    console.log('--- REPRODUCE GROUP TASK FLOW ---');

    // 1. Create Task (Assigned to Group, No Individual)
    console.log('1. Creating Group Task...');
    const task = await prisma.pendingTask.create({
        data: {
            taskNo: `R-${Date.now()}`,
            taskTitle: 'Reproduction Task',
            taskStatus: 'Pending',
            createdBy: adminId,
            assignedTo: null,
            targetGroupId: groupId,
            createdTime: new Date(),
            updatedAt: new Date(),
            editTime: [new Date()]
        }
    });
    console.log(`Task Created: ${task.taskNo} (${task.id})`);

    // 2. Simulate User Acceptance (Sets assignedTo)
    console.log('2. Simulating Acceptance by Worker...');
    const accepted = await prisma.pendingTask.update({
        where: { id: task.id },
        data: {
            assignedTo: workerId,
            // targetGroupId remains set
        }
    });
    console.log(`Task Accepted. AssignedTo: ${accepted.assignedTo}, TargetGroup: ${accepted.targetGroupId}`);

    // 3. Simulate Submission (Status -> ReviewPending)
    console.log('3. Simulating Submission...');
    const submitted = await prisma.pendingTask.update({
        where: { id: task.id },
        data: {
            taskStatus: 'ReviewPending',
            workingBy: workerId,
            reviewedTime: { push: new Date() }
        }
    });
    console.log(`Task ReviewPending. WorkingBy: ${submitted.workingBy}`);

    // 4. Simulate Finalize Completion (The critical failure point)
    console.log('4. Attempting Finalize Completion (Admin Action)...');

    try {
        const result = await prisma.$transaction(async (tx) => {
            const completedData: any = {
                id: submitted.id,
                taskNo: submitted.taskNo,
                taskTitle: submitted.taskTitle,
                priority: submitted.priority,
                taskStatus: 'Completed',
                additionalNote: submitted.additionalNote,
                deadline: submitted.deadline,
                completeTime: new Date(),
                completedAt: new Date(),
                reviewedTime: submitted.reviewedTime,
                reminderTime: submitted.reminderTime,
                document: submitted.document,
                remarkChat: submitted.remarkChat,
                createdTime: submitted.createdTime,
                editTime: submitted.editTime,
                // Keys
                projectId: submitted.projectId,
                assignedTo: submitted.assignedTo, // Value is NOW SET (WorkerId)
                targetGroupId: submitted.targetGroupId, // Value is NOW SET (GroupId)
                targetTeamId: submitted.targetTeamId,
                createdBy: submitted.createdBy,
                workingBy: submitted.workingBy
            };

            // Mimic the service logic handling
            // ...

            console.log('Saving CompletedData:', JSON.stringify(completedData, null, 2));

            const completed = await tx.completedTask.create({
                data: completedData
            });

            await tx.pendingTask.delete({ where: { id: submitted.id } });

            return completed;
        });

        console.log(`SUCCESS! Task moved to CompletedTask: ${result.id}`);

    } catch (e: any) {
        console.error('!!! TRANSACTION FAILED !!!');
        console.error(e);
        console.error('Code:', e.code);
        console.error('Meta:', e.meta);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
