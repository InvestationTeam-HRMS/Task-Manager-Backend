
// Mocking the logic from task.service.ts
function getWhere(userId: string, role: string, viewMode: string) {
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'HR' || role === 'MANAGER';
    const isCompletedView = viewMode === 'MY_COMPLETED' || viewMode === 'TEAM_COMPLETED';

    const where: any = {
        AND: []
    };

    if (!isAdmin && userId) {
        where.AND.push({
            OR: [
                { assignedTo: userId },
                { targetTeamId: userId },
                { createdBy: userId },
                { workingBy: userId },
                {
                    targetGroup: { members: { some: { userId } } },
                    ...(isCompletedView ? {} : {
                        assignedTo: null,
                        taskAcceptances: { none: { userId, status: 'REJECTED' } }
                    })
                }
            ]
        });
    }

    const andArray = where.AND;

    if (viewMode && userId) {
        switch (viewMode) {
            case 'MY_PENDING':
                andArray.push({
                    OR: [
                        { assignedTo: userId },
                        { targetTeamId: userId },
                        {
                            targetGroup: { members: { some: { userId } } },
                            assignedTo: null,
                            taskAcceptances: { none: { userId, status: 'REJECTED' } },
                            createdBy: { not: userId }
                        }
                    ],
                    taskStatus: 'Pending'
                });
                break;
            case 'TEAM_PENDING':
                andArray.push({
                    createdBy: userId,
                    taskStatus: 'Pending',
                    AND: [
                        { OR: [{ assignedTo: { not: userId } }, { assignedTo: null }] },
                        { OR: [{ targetTeamId: { not: userId } }, { targetTeamId: null }] }
                    ]
                });
                break;
        }
    }
    return where;
}

const adminId = 'admin_uid';
const hrId = 'hr_uid';

console.log('--- ADMIN MY_PENDING ---');
console.log(JSON.stringify(getWhere(adminId, 'SUPER_ADMIN', 'MY_PENDING'), null, 2));

console.log('\n--- ADMIN TEAM_PENDING ---');
console.log(JSON.stringify(getWhere(adminId, 'SUPER_ADMIN', 'TEAM_PENDING'), null, 2));

console.log('\n--- HR MY_PENDING (Assignee) ---');
console.log(JSON.stringify(getWhere(hrId, 'HR', 'MY_PENDING'), null, 2));

console.log('\n--- HR TEAM_PENDING ---');
console.log(JSON.stringify(getWhere(hrId, 'HR', 'TEAM_PENDING'), null, 2));
