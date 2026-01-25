import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const allPermissions = ['add', 'view', 'edit', 'delete', 'bulk', 'upload', 'download'];

const roles = [
    {
        name: 'Super Admin',
        description: 'Full system access. Can manage all modules, users, and configurations without restrictions.',
        permissions: {
            organization: allPermissions,
            project: allPermissions,
            users: allPermissions,
            group: allPermissions,
            ip_address: allPermissions,
            task: allPermissions,
            task_advance: ['self', 'others', 'groups']
        }
    },
    {
        name: 'HR Manager',
        description: 'Focuses on user management and organizational structure. Can manage employees and groups.',
        permissions: {
            organization: ['view', 'edit', 'download'],
            project: ['view'],
            users: allPermissions,
            group: allPermissions,
            ip_address: ['view'],
            task: ['view', 'download'],
            task_advance: ['self', 'others']
        }
    },
    {
        name: 'Project Manager',
        description: 'Manages projects and tasks. Oversight of project timelines and task assignments.',
        permissions: {
            organization: ['view'],
            project: allPermissions,
            users: ['view'],
            group: ['view'],
            ip_address: ['view'],
            task: allPermissions,
            task_advance: ['self', 'others', 'groups']
        }
    },
    {
        name: 'Team Lead',
        description: 'Supervises team tasks and group activities. Can assign and manage tasks within their scope.',
        permissions: {
            organization: ['view'],
            project: ['view'],
            users: ['view'],
            group: ['view'],
            ip_address: [],
            task: ['add', 'view', 'edit', 'bulk', 'upload', 'download'],
            task_advance: ['self', 'groups']
        }
    },
    {
        name: 'Employee',
        description: 'Standard access for performing assigned tasks and viewing relevant project information.',
        permissions: {
            organization: [],
            project: ['view'],
            users: [],
            group: [],
            ip_address: [],
            task: ['add', 'view', 'edit'],
            task_advance: ['self']
        }
    },
    {
        name: 'Auditor',
        description: 'Read-only access across the system for compliance and review purposes.',
        permissions: {
            organization: ['view', 'download'],
            project: ['view', 'download'],
            users: ['view', 'download'],
            group: ['view', 'download'],
            ip_address: ['view', 'download'],
            task: ['view', 'download'],
            task_advance: []
        }
    }
];

async function main() {
    console.log('🚀 Starting External Database Setup...');

    // 1. Seed Roles
    console.log('\n--- Seeding Roles ---');
    for (const role of roles) {
        const upsertedRole = await prisma.role.upsert({
            where: { name: role.name },
            update: {
                description: role.description,
                permissions: role.permissions
            },
            create: {
                name: role.name,
                description: role.description,
                permissions: role.permissions
            },
        });
        console.log(`✅ Role "${upsertedRole.name}" upserted.`);
    }

    // 2. Create Admin User
    console.log('\n--- Creating Admin User ---');
    const email = 'admin-01@investationteam.com';
    const password = 'admin-01@investationteam.com';
    const hashedPassword = await bcrypt.hash(password, 12);

    const existingTeam = await prisma.team.findUnique({ where: { email } });

    if (existingTeam) {
        console.log(`User ${email} already exists. Updating...`);
        await prisma.team.update({
            where: { email },
            data: {
                password: hashedPassword,
                role: UserRole.SUPER_ADMIN,
                status: TeamStatus.Active,
                isEmailVerified: true
            }
        });
        console.log('✅ Admin user updated.');
    } else {
        console.log(`Creating new admin user: ${email}`);
        await prisma.team.create({
            data: {
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
        console.log('✅ Admin user created.');
    }

    console.log('\n✨ External database setup completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Error during setup:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
