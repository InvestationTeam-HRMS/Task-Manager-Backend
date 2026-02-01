import { PrismaClient, UserRole, TeamStatus, LoginMethod } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin-01@investationteam.com';
    const password = await bcrypt.hash('123Qwe', 10);

    const existing = await prisma.team.findUnique({
        where: { email: email }
    });

    if (!existing) {
        await prisma.team.create({
            data: {
                teamNo: 'ADMIN-01',
                teamName: 'Super Admin',
                email: email,
                password: password,
                role: UserRole.ADMIN,
                status: TeamStatus.Active,
                loginMethod: LoginMethod.General,
            }
        });
        console.log(`Created admin: ${email}`);
    } else {
        // Update password just to be sure it matches the screenshot
        await prisma.team.update({
            where: { email: email },
            data: { password: password, role: UserRole.ADMIN }
        });
        console.log(`Updated admin: ${email}`);
    }
}

main().finally(() => prisma.$disconnect());
