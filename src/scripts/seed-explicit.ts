import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Explicitly using the user-provided URL to guarantee connection target
const dbUrl = 'postgresql://postgres:gaurav%40%402004@localhost:5432/hrms_db?schema=public';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl,
        },
    },
});

async function main() {
    console.log(`🌱 CONNECTING TO: ${dbUrl}`);
    console.log('🌱 Starting database seed in EXPLICIT mode...');

    const roles = [
        {
            name: 'Supervisor',
            description: 'Oversees operations and users.',
            permissions: {
                settings: { theme: true },
                group: { read: true, write: true },
                users: { view: true, edit: true }
            }
        },
        {
            name: 'Support',
            description: 'Provides technical assistance.',
            permissions: {
                settings: { theme: true },
                users: { view: true }
            }
        },
        { name: 'User', description: 'Basic access.', permissions: {} },
        { name: 'Auditor', description: 'Reviews system activities.', permissions: { users: { view: true }, project: { view: true } } },
        { name: 'Guest', description: 'Temporary access.', permissions: {} },
        {
            name: 'HR',
            description: 'Human Resources role.',
            permissions: {
                settings: { theme: true },
                users: { add: true, view: true, edit: true, delete: true },
                team: { read: true, write: true }
            }
        },
        {
            name: 'SUPER_ADMIN',
            description: 'Full System Access',
            permissions: {
                settings: { theme: true },
                "*": true
            }
        },
        {
            name: 'ADMIN',
            description: 'Administrator',
            permissions: {
                settings: { theme: true }
            }
        }
    ];

    for (const role of roles) {
        await prisma.role.upsert({
            where: { name: role.name },
            update: {
                description: role.description,
                permissions: role.permissions, // Explicitly update permissions
            },
            create: role,
        });
    }
    console.log('✅ Roles & Permissions seeded.');

    // 2. Admin User
    const adminEmail = 'admin-01@investationteam.com';
    const adminPassword = '123Qwe';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const existingAdmin = await prisma.team.findUnique({ where: { email: adminEmail } });

    if (existingAdmin) {
        console.log('User exists. Updating...');
        await prisma.team.update({
            where: { email: adminEmail },
            data: {
                password: hashedPassword,
                role: 'SUPER_ADMIN' as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true
            }
        });
        console.log(`✅ Admin updated: ${adminEmail}`);
    } else {
        console.log('Creating new Admin...');
        await prisma.team.create({
            data: {
                teamNo: 'TM-ADMIN-01',
                teamName: 'System Admin',
                email: adminEmail,
                password: hashedPassword,
                firstName: 'System',
                lastName: 'Admin',
                phone: '0000000000',
                role: 'SUPER_ADMIN' as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true
            }
        });
        console.log(`✅ Admin created: ${adminEmail}`);
    }
}

main()
    .catch((e) => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
