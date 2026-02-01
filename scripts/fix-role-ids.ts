/**
 * Script to fix roleId for existing team members
 * 
 * NOTE: This script is now deprecated as taskAssignPermission field has been removed.
 * Team members now use roleId directly to reference their custom role.
 * 
 * This script was originally used to:
 * 1. Find all team members that have taskAssignPermission set but no roleId
 * 2. Look up the role by name (taskAssignPermission)
 * 3. Update the team member with the correct roleId
 * 
 * Run with: npx ts-node scripts/fix-role-ids.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔧 Starting role ID fix script...\n');
    console.log('⚠️  NOTE: This script is deprecated. taskAssignPermission field has been removed.');
    console.log('         Team members now use roleId directly.\n');

    // Find all team members without roleId
    const teamsWithoutRoleId = await prisma.team.findMany({
        where: {
            roleId: null,
        },
        select: {
            id: true,
            email: true,
            teamName: true,
        }
    });

    console.log(`Found ${teamsWithoutRoleId.length} team members without roleId\n`);

    if (teamsWithoutRoleId.length === 0) {
        console.log('✅ All team members already have roleId set. Nothing to do!');
        return;
    }

    console.log('Team members without roleId:');
    for (const team of teamsWithoutRoleId) {
        console.log(`  - ${team.email} (${team.teamName})`);
    }
    console.log('\nTo assign roles, use the admin panel or update roleId directly.');
}

main()
    .catch((e) => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
