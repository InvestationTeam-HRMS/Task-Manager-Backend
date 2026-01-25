import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Finalizing Admin User & Roles Fix...');

    // 1. Ensure Roles are correct
    const roles = [
        { name: 'Super Admin', description: 'Full system access.' },
        { name: 'HR Manager', description: 'User management focus.' },
        { name: 'Project Manager', description: 'Project focus.' },
        { name: 'Team Lead', description: 'Team supervision.' },
        { name: 'Employee', description: 'Standard access.' },
        { name: 'Auditor', description: 'Read-only access.' }
    ];

    for (const r of roles) {
        await prisma.role.upsert({
            where: { name: r.name },
            update: { description: r.description },
            create: { name: r.name, description: r.description }
        });
    }
    console.log('✅ Roles updated.');

    // 2. Setup Admin with BOTH passwords (just in case they want both, but I'll set it to 123Qwe as per screenshot)
    const email = 'admin-01@investationteam.com';
    const password = '123Qwe'; // Noticed they are typed this in screenshot
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.team.upsert({
        where: { email },
        update: {
            password: hashedPassword,
            role: UserRole.SUPER_ADMIN,
            status: TeamStatus.Active,
            isEmailVerified: true
        },
        create: {
            teamNo: 'TM-ADMIN-01',
            teamName: 'Investation Admin',
            email: email,
            password: hashedPassword,
            firstName: 'Investation',
            lastName: 'Admin',
            role: UserRole.SUPER_ADMIN,
            status: TeamStatus.Active,
            isEmailVerified: true,
            phone: '0000000000'
        }
    });

    console.log(`✅ Admin user ${email} is now ready with password: ${password}`);
    console.log('\n✨ Setup completed! Please push the backend changes to Render as well.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
