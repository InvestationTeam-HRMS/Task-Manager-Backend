import { PrismaClient, UserRole, TeamStatus, LoginMethod } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding teams...');

    const saltRounds = 12;
    const password = 'password123'; // Default password for all
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const teams = [
        {
            teamName: 'Super Admin Team',
            email: 'admin@missionhrms.com',
            teamNo: 'U-10001',
            role: UserRole.SUPER_ADMIN,
            phone: '9999999991',
        },
        {
            teamName: 'HR Manager Team',
            email: 'hr@missionhrms.com',
            teamNo: 'U-10002',
            role: UserRole.HR,
            phone: '9999999992',
        },
        {
            teamName: 'Employee Team',
            email: 'employee@missionhrms.com',
            teamNo: 'U-10003',
            role: UserRole.EMPLOYEE,
            phone: '9999999993',
        },
    ];

    for (const team of teams) {
        // Check if exists
        const exists = await prisma.team.findFirst({
            where: { email: team.email }
        });

        if (exists) {
            console.log(`⚠️  Team ${team.email} already exists. Skipping.`);
            continue;
        }

        const newTeam = await prisma.team.create({
            data: {
                teamName: team.teamName,
                email: team.email,
                teamNo: team.teamNo,
                phone: team.phone,
                role: team.role,
                status: TeamStatus.Active,
                loginMethod: LoginMethod.General,
                password: hashedPassword,
                isEmailVerified: true,
                firstName: team.teamName.split(' ')[0], // Simple split
                lastName: team.teamName.split(' ').slice(1).join(' '),
            },
        });

        console.log(`✅ Created ${team.role}: ${team.email}`);
    }

    console.log('\n✨ Seeding completed!');
    console.log('------------------------------------------------');
    console.log(`🔑 Default Password: ${password}`);
    console.log('------------------------------------------------');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
