/**
 * Script to fix team role enum based on their custom role (roleId)
 * - If custom role name contains 'admin' → ADMIN
 * - If team name is 'Admin' or email contains 'admin' → ADMIN (for admin accounts)
 * - Everything else → EMPLOYEE
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Fixing team role enum based on custom roles...\n');

  // Get all teams with their custom roles
  const teams = await prisma.team.findMany({
    include: {
      customRole: {
        select: { id: true, name: true }
      }
    }
  });

  let updatedCount = 0;
  let adminCount = 0;
  let employeeCount = 0;

  for (const team of teams) {
    let expectedRole: string = 'EMPLOYEE';
    
    // Check if this is an admin account (by team name, email, or custom role)
    const isAdminByName = team.teamName.toUpperCase() === 'ADMIN';
    const isAdminByEmail = team.email.toLowerCase().includes('admin');
    const isAdminByRole = team.customRole && team.customRole.name.toUpperCase().includes('ADMIN');
    
    if (isAdminByName || isAdminByEmail || isAdminByRole) {
      expectedRole = 'ADMIN';
    }

    // Only update if role doesn't match
    if (team.role !== expectedRole) {
      await prisma.team.update({
        where: { id: team.id },
        data: { role: expectedRole }
      });
      console.log(`✅ Updated ${team.teamName} (${team.email}): ${team.role} → ${expectedRole}`);
      updatedCount++;
    } else {
      console.log(`⏭️  Skipped ${team.teamName} (${team.email}): already ${team.role}`);
    }

    if (expectedRole === 'ADMIN') {
      adminCount++;
    } else {
      employeeCount++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Total teams: ${teams.length}`);
  console.log(`   ADMIN: ${adminCount}`);
  console.log(`   EMPLOYEE: ${employeeCount}`);
  console.log(`   Updated: ${updatedCount}`);
  console.log('\n✅ Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
