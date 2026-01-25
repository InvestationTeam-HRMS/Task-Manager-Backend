import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Verifying External Database Setup...');

    // Check roles
    const roles = await prisma.role.findMany();
    console.log(`Total Roles: ${roles.length}`);
    roles.forEach(r => console.log(`- ${r.name}`));

    // Check admin user
    const email = 'admin-01@investationteam.com';
    const admin = await prisma.team.findUnique({
        where: { email },
        select: { teamNo: true, teamName: true, role: true, status: true }
    });

    if (admin) {
        console.log('\n✅ Admin User Found:');
        console.log(JSON.stringify(admin, null, 2));
    } else {
        console.log(`\n❌ Admin User ${email} NOT found.`);
    }

    if (roles.length > 0 && admin && admin.role === 'SUPER_ADMIN') {
        console.log('\n✨ Verification PASSED!');
    } else {
        console.log('\n❌ Verification FAILED!');
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
