import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...');

    // 1. Seed Dynamic Roles (for Role Table)
    const roles = [
        {
            name: 'Supervisor',
            description: 'Oversees operations and users. Can view reports and has limited configuration access.'
        },
        {
            name: 'Support',
            description: 'Provides technical assistance. Can access user accounts and system reports for diagnostics.'
        },
        {
            name: 'User',
            description: 'Access to basic features necessary for tasks. Limited administrative privileges.'
        },
        {
            name: 'Auditor',
            description: 'Reviews system activities. Can access reports, but cannot make changes.'
        },
        {
            name: 'Guest',
            description: 'Temporary access to limited features. Ideal for visitors or temporary users.'
        },
        {
            name: 'HR',
            description: 'Human Resources role with ability to manage teams and recruitment.'
        }
    ];

    console.log(`Processing ${roles.length} roles...`);
    for (const role of roles) {
        await prisma.role.upsert({
            where: { name: role.name },
            update: { description: role.description },
            create: role,
        });
    }
    console.log('✅ Roles seeded successfully.');

    // 2. Create/Update Admin User
    const adminEmail = 'admin-01@investationteam.com';
    const adminPassword = '123Qwe';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

    console.log(`Processing Admin User: ${adminEmail}`);

    const existingAdmin = await prisma.team.findUnique({ where: { email: adminEmail } });

    if (existingAdmin) {
        console.log('User exists. Updating credentials and role...');
        await prisma.team.update({
            where: { email: adminEmail },
            data: {
                password: hashedPassword,
                role: 'SUPER_ADMIN' as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true,
                // Ensure optional fields logic is handled by schema (nullable)
            }
        });
        console.log(`✅ Admin user updated: ${adminEmail}`);
    } else {
        console.log('Creating new Admin user...');
        // Check if phone exists (since it's unique)
        let phone = '0000000000';
        const existingPhone = await prisma.team.findUnique({ where: { phone } });
        if (existingPhone) {
            phone = '0000000001'; // Fallback
        }

        await prisma.team.create({
            data: {
                teamNo: 'TM-ADMIN-01',
                teamName: 'System Admin',
                email: adminEmail,
                password: hashedPassword,
                firstName: 'System',
                lastName: 'Admin',
                phone: phone,
                role: 'SUPER_ADMIN' as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true,
                // clientGroupId etc are optional, leaving them null for Super Admin
            }
        });
        console.log(`✅ Admin user created: ${adminEmail}`);
    }

    console.log('🎉 Seeding completed successfully.');
}

main()
    .catch((e) => {
        console.error('❌ Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
