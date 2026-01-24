
import { PrismaClient, UserRole, TeamStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin-01@investationteam.com';
    const password = '123Qwe';
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    console.log(`Processing user: ${email}`);

    const existing = await prisma.team.findUnique({ where: { email } });

    if (existing) {
        console.log('User exists. Updating password and ensuring admin status...');
        await prisma.team.update({
            where: { email },
            data: {
                password: hashedPassword,
                role: 'SUPER_ADMIN' as UserRole, // Ensuring they are admin
                status: 'Active' as TeamStatus,
                isEmailVerified: true
            }
        });
        console.log('✅ User updated successfully.');
    } else {
        console.log('User does not exist. Creating new admin user...');
        await prisma.team.create({
            data: {
                teamNo: 'TM-ADMIN-01', // Using the standard admin ID from previous context
                teamName: 'Investation Admin',
                email: email,
                password: hashedPassword,
                firstName: 'Investation',
                lastName: 'Admin',
                role: 'SUPER_ADMIN' as UserRole,
                status: 'Active' as TeamStatus,
                isEmailVerified: true,
                phone: '0000000000'
            }
        });
        console.log('✅ User created successfully.');
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
