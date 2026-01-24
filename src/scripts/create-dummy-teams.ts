
import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const password = '123Qwe'; // Default password for all
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const users = [
        {
            teamNo: 'TM-USER-01',
            teamName: 'User One',
            email: 'user1@test.com',
            role: 'EMPLOYEE',
            phone: '9999999001'
        },
        {
            teamNo: 'TM-USER-02',
            teamName: 'User Two',
            email: 'user2@test.com',
            role: 'EMPLOYEE',
            phone: '9999999002'
        },
        {
            teamNo: 'TM-USER-03',
            teamName: 'User Three',
            email: 'user3@test.com',
            role: 'MANAGER',
            phone: '9999999003'
        },
        {
            teamNo: 'TM-USER-04',
            teamName: 'User Four',
            email: 'user4@test.com',
            role: 'HR',
            phone: '9999999004'
        }
    ];

    console.log('Starting seed...');

    for (const user of users) {
        // Check if user exists
        const existing = await prisma.team.findUnique({ where: { email: user.email } });
        if (existing) {
            console.log(`User ${user.email} already exists. Updating/Resetting...`);
            await prisma.team.update({
                where: { email: user.email },
                data: {
                    password: hashedPassword,
                    teamNo: user.teamNo, // Ensure teamNo aligns if needed
                    teamName: user.teamName,
                    role: user.role as UserRole,
                    status: 'Active' as TeamStatus,
                    isEmailVerified: true
                }
            });
        } else {
            console.log(`Creating user ${user.email}...`);
            // Check if teamNo is taken (if so, we might need to handle, but for this specific test list we assume purity)
            const existingNo = await prisma.team.findUnique({ where: { teamNo: user.teamNo } });
            if (existingNo) {
                // If teamNo exists but email doesn't, we can't use this teamNo. 
                // Simple hack: append timestamp to teamNo avoid collision if re-running in weird state
                user.teamNo = `${user.teamNo}-${Date.now()}`;
            }

            await prisma.team.create({
                data: {
                    teamNo: user.teamNo,
                    teamName: user.teamName,
                    email: user.email,
                    password: hashedPassword,
                    role: user.role as UserRole,
                    status: 'Active' as TeamStatus, // Explicit cast to match enum
                    phone: user.phone,
                    firstName: user.teamName.split(' ')[0],
                    lastName: user.teamName.split(' ')[1],
                    isEmailVerified: true
                }
            });
        }
    }

    console.log('\n✅ 4 Mock Users Created/Updated Successfully!');
    console.log('Default Password for all: 123Qwe');
    users.forEach(u => console.log(`- ${u.teamName} (${u.role}): ${u.email}`));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
