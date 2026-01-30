const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const users = await p.team.findMany({ 
        take: 5, 
        select: { id: true, firstName: true, lastName: true, role: true } 
    });
    console.log('Users:', JSON.stringify(users, null, 2));
    
    const completed = await p.completedTask.findMany({ 
        take: 5, 
        orderBy: { completedAt: 'desc' },
        select: { id: true, taskNo: true, taskTitle: true, workingBy: true, assignedTo: true, createdBy: true } 
    });
    console.log('Completed Tasks:', JSON.stringify(completed, null, 2));
}

main().finally(() => p.$disconnect());
