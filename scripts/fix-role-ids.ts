/**
 * Script to fix roleId for existing team members
 * 
 * This script will:
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

    // Find all team members without roleId but with taskAssignPermission
    const teamsWithoutRoleId = await prisma.team.findMany({
        where: {
            roleId: null,
            taskAssignPermission: {
                not: null
            }
        },
        select: {
            id: true,
            email: true,
            teamName: true,
            taskAssignPermission: true,
        }
    });

    console.log(`Found ${teamsWithoutRoleId.length} team members without roleId\n`);

    if (teamsWithoutRoleId.length === 0) {
        console.log('✅ All team members already have roleId set. Nothing to do!');
        return;
    }

    // Get all roles for lookup
    const roles = await prisma.role.findMany({
        select: {
            id: true,
            name: true,
        }
    });

    const roleMap = new Map(roles.map(r => [r.name, r.id]));

    console.log('Available roles:', Array.from(roleMap.keys()).join(', '));
    console.log('');

    let updated = 0;
    let skipped = 0;

    for (const team of teamsWithoutRoleId) {
        const roleName = team.taskAssignPermission;
        if (!roleName) {
            console.log(`⚠️  Skipping ${team.email} - no taskAssignPermission`);
            skipped++;
            continue;
        }

        const roleId = roleMap.get(roleName);
        if (!roleId) {
            console.log(`⚠️  Skipping ${team.email} - role "${roleName}" not found`);
            skipped++;
            continue;
        }

        await prisma.team.update({
            where: { id: team.id },
            data: { roleId }
        });

        console.log(`✅ Updated ${team.email} (${team.teamName}) → roleId: ${roleId} (${roleName})`);
        updated++;
    }

    console.log('\n📊 Summary:');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log('\n🎉 Done!');
}

main()
    .catch((e) => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
