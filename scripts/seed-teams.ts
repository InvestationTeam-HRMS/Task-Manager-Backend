import { PrismaClient, UserRole, TeamStatus, LoginMethod } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const password = await bcrypt.hash('123Qwe', 10);

    const teams = [
        {
            teamNo: 'T-1001',
            teamName: 'Marketing Manager',
            firstName: 'Aman',
            lastName: 'Sharma',
            email: 'aman.manager@investationteam.com',
            password: password,
            role: UserRole.MANAGER,
            status: TeamStatus.Active,
            loginMethod: LoginMethod.General,
        },
        {
            teamNo: 'T-1002',
            teamName: 'HR Executive',
            firstName: 'Priya',
            lastName: 'Verma',
            email: 'priya.hr@investationteam.com',
            password: password,
            role: UserRole.HR,
            status: TeamStatus.Active,
            loginMethod: LoginMethod.General,
        },
        {
            teamNo: 'T-1003',
            teamName: 'Senior Developer',
            firstName: 'Rahul',
            lastName: 'Gupta',
            email: 'rahul.emp@investationteam.com',
            password: password,
            role: UserRole.EMPLOYEE,
            status: TeamStatus.Active,
            loginMethod: LoginMethod.General,
        }
    ];

    console.log('Seed: Creating teams...');

    for (const team of teams) {
        const existing = await prisma.team.findUnique({
            where: { email: team.email }
        });

        if (!existing) {
            await prisma.team.create({
                data: team
            });
            console.log(`Created team: ${team.email}`);
        } else {
            console.log(`Team already exists: ${team.email}`);
        }
    }

    console.log('Seed: Finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
