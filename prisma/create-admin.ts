import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const hashedPassword = await bcrypt.hash('password123', 12);

    // 1. Create Default Roles
    console.log('Creating roles...');
    const managerRole = await prisma.role.upsert({
        where: { name: 'Manager' },
        update: {},
        create: {
            name: 'Manager',
            description: 'Can manage tasks and projects',
            permissions: {
                tasks: ['read', 'create', 'update', 'delete'],
                projects: ['read', 'create', 'update'],
                teams: ['read'],
                all: ['read']
            }
        }
    });

    const hrRole = await prisma.role.upsert({
        where: { name: 'HR Executive' },
        update: {},
        create: {
            name: 'HR Executive',
            description: 'Can manage teams and members',
            permissions: {
                teams: ['read', 'create', 'update', 'delete'],
                tasks: ['read'],
                all: ['read']
            }
        }
    });

    const developerRole = await prisma.role.upsert({
        where: { name: 'Developer' },
        update: {},
        create: {
            name: 'Developer',
            description: 'Can work on assigned tasks',
            permissions: {
                tasks: ['read', 'update'],
                projects: ['read'],
                all: ['read']
            }
        }
    });

    // 2. Create Admin
    const admin = await prisma.team.upsert({
        where: { email: 'admin-01@investationteam.com' },
        update: {},
        create: {
            teamNo: 'TM-ADMIN-001',
            teamName: 'Admin User',
            email: 'admin-01@investationteam.com',
            password: hashedPassword,
            role: UserRole.SUPER_ADMIN,
            status: 'Active',
            isEmailVerified: true,
            firstName: 'Super',
            lastName: 'Admin'
        },
    });
    console.log('✅ Admin user ready:', admin.email);

    // 3. Create Team Members
    const membersData = [
        {
            email: 'manager@example.com',
            name: 'Manager User',
            role: UserRole.MANAGER,
            roleId: managerRole.id,
            teamNo: 'TM-001'
        },
        {
            email: 'hr@example.com',
            name: 'HR User',
            role: UserRole.HR,
            roleId: hrRole.id,
            teamNo: 'TM-002'
        },
        {
            email: 'dev1@example.com',
            name: 'Developer One',
            role: UserRole.EMPLOYEE,
            roleId: developerRole.id,
            teamNo: 'TM-003'
        },
        {
            email: 'dev2@example.com',
            name: 'Developer Two',
            role: UserRole.EMPLOYEE,
            roleId: developerRole.id,
            teamNo: 'TM-004'
        }
    ];

    for (const m of membersData) {
        const user = await prisma.team.upsert({
            where: { email: m.email },
            update: {
                roleId: m.roleId,
                allowedIps: ['*']
            },
            create: {
                teamNo: m.teamNo,
                teamName: m.name,
                email: m.email,
                password: hashedPassword,
                role: m.role,
                roleId: m.roleId,
                status: 'Active',
                isEmailVerified: true,
                allowedIps: ['*'],
                firstName: m.name.split(' ')[0],
                lastName: m.name.split(' ')[1]
            }
        });
        console.log(`✅ Member ready: ${user.email} (IP: Any)`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
