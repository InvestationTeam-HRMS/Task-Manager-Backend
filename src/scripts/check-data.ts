import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Client Groups ---');
    const groups = await prisma.clientGroup.findMany({
        select: {
            id: true,
            groupNo: true,
            groupName: true,
            groupCode: true,
            status: true,
            remark: true
        }
    });
    console.log(JSON.stringify(groups, null, 2));

    console.log('\n--- Projects ---');
    const projects = await prisma.project.findMany({
        take: 5,
        select: {
            id: true,
            projectNo: true,
            projectName: true,
            status: true
        }
    });
    console.log(JSON.stringify(projects, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
