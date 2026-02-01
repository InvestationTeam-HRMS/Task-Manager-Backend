import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const teams = await prisma.team.findMany({
    select: {
      teamName: true,
      email: true,
      role: true,
      customRole: { select: { name: true } }
    }
  });

  console.log('\n📋 Team Roles Status:\n');
  console.table(teams.map(t => ({
    'Team Name': t.teamName,
    'Email': t.email,
    'Role (Enum)': t.role,
    'Custom Role': t.customRole?.name || '-'
  })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
