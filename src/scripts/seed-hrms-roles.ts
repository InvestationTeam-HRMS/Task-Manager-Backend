import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const standardAccess = ['add', 'view', 'edit', 'delete', 'bulk', 'upload', 'download'];
const viewOnly = ['view'];

async function main() {
    console.log('🌱 Starting HRMS Roles seeding...');

    const roles = [
        {
            name: 'Super Admin',
            description: 'Full system access with all administrative privileges.',
            permissions: {
                organization: standardAccess,
                project: standardAccess,
                users: standardAccess,
                group: standardAccess,
                ip_address: standardAccess,
                task: standardAccess,
                task_advance: ['self', 'others', 'groups'],
                settings: ['theme']
            }
        },
        {
            name: 'HR Manager',
            description: 'Manages company structure, employees, and groups.',
            permissions: {
                organization: ['add', 'view', 'edit', 'bulk', 'upload', 'download'],
                users: ['add', 'view', 'edit', 'delete', 'bulk', 'upload', 'download'],
                group: ['add', 'view', 'edit', 'delete', 'bulk'],
                project: ['view'],
                task: ['add', 'view', 'edit'],
                task_advance: ['others', 'groups'],
                settings: ['theme']
            }
        },
        {
            name: 'Project Head',
            description: 'Oversees projects, tasks, and team productivity.',
            permissions: {
                organization: ['view'],
                project: standardAccess,
                users: ['view'],
                group: ['view'],
                task: standardAccess,
                task_advance: ['self', 'others', 'groups'],
                settings: ['theme']
            }
        },
        {
            name: 'Recruiter',
            description: 'Responsible for employee onboarding and user management.',
            permissions: {
                organization: ['view'],
                users: ['add', 'view', 'edit', 'bulk', 'upload', 'download'],
                group: ['view'],
                task: ['add', 'view', 'edit'],
                task_advance: ['self']
            }
        },
        {
            name: 'Staff / Employee',
            description: 'Standard employee access for personal task tracking.',
            permissions: {
                organization: ['view'],
                project: ['view'],
                task: ['add', 'view', 'edit'],
                task_advance: ['self']
            }
        },
        {
            name: 'Auditor',
            description: 'Compliance role with view-only access across the platform.',
            permissions: {
                organization: viewOnly,
                project: viewOnly,
                users: viewOnly,
                group: viewOnly,
                ip_address: viewOnly,
                task: viewOnly,
                task_advance: []
            }
        }
    ];

    for (const role of roles) {
        await prisma.role.upsert({
            where: { name: role.name },
            update: {
                description: role.description,
                permissions: role.permissions
            },
            create: {
                name: role.name,
                description: role.description,
                permissions: role.permissions
            }
        });
        console.log(`✅ Role "${role.name}" seeded/updated.`);
    }

    console.log('🎉 HRMS Roles seeding completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Error seeding roles:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
