
import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Starting Database Seed...');

    const defaultPassword = '123Qwe';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

    const users = [
        {
            email: 'admin-01@investationteam.com',
            teamNo: 'TM-ADMIN-01',
            name: 'Super Admin',
            role: 'SUPER_ADMIN',
            phone: '9999000001'
        },
        {
            email: 'manager-01@investationteam.com',
            teamNo: 'TM-MGR-01',
            name: 'Manager User',
            role: 'MANAGER',
            phone: '9999000002'
        },
        {
            email: 'hr-01@investationteam.com',
            teamNo: 'TM-HR-01',
            name: 'HR User',
            role: 'HR',
            phone: '9999000003'
        },
        {
            email: 'employee-01@investationteam.com',
            teamNo: 'TM-EMP-01',
            name: 'Employee User',
            role: 'EMPLOYEE',
            phone: '9999000004'
        }
    ];

    const credentialsLog: string[] = [];
    credentialsLog.push('=== HRMS SYSTEM CREDENTIALS ===');
    credentialsLog.push(`Generated on: ${new Date().toLocaleString()}`);
    credentialsLog.push('All accounts have the same password for testing.\n');
    credentialsLog.push(`DEFAULT PASSWORD: ${defaultPassword}\n`);
    credentialsLog.push('----------------------------------------');

    for (const user of users) {
        console.log(`Creating user: ${user.email} (${user.role})`);

        await prisma.team.create({
            data: {
                teamNo: user.teamNo,
                teamName: user.name,
                email: user.email,
                password: hashedPassword,
                role: user.role as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true,
                firstName: user.name.split(' ')[0],
                lastName: user.name.split(' ')[1] || '',
                phone: user.phone,
                allowedIps: ['::1', '127.0.0.1']
            }
        });

        credentialsLog.push(`Role:      ${user.role}`);
        credentialsLog.push(`Name:      ${user.name}`);
        credentialsLog.push(`Email:     ${user.email}`);
        credentialsLog.push(`TeamID:    ${user.teamNo}`);
        credentialsLog.push('----------------------------------------');
    }

    // Write credentials to file in the project root and desktop for easy access
    const projectRoot = path.join(__dirname, '../../');
    const logContent = credentialsLog.join('\n');

    // Save to valid locations
    fs.writeFileSync(path.join(projectRoot, 'SEED_CREDENTIALS.txt'), logContent);

    console.log('\n✅ Database Seed Completed Successfully!');
    console.log(logContent);
}

main()
    .catch((e) => {
        console.error('❌ Error Seeding Database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
