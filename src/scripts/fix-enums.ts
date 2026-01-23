
import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    console.log('Starting DB Enums Migration to Title Case...');

    const enums = {
        'UserStatus': ['Active', 'Inactive', 'Suspended', 'Pending_Verification'],
        'CompanyStatus': ['Active', 'Inactive'],
        'LocationStatus': ['Active', 'Inactive'],
        'SubLocationStatus': ['Active', 'Inactive'],
        'ProjectStatus': ['Active', 'Inactive', 'Completed', 'On_Hold'],
        'ProjectPriority': ['Low', 'Medium', 'High', 'Critical'],
        'TeamStatus': ['Active', 'Inactive'],
        'GroupStatus': ['Active', 'Inactive'],
        'IpAddressStatus': ['Active', 'Inactive'],
        'TaskStatus': ['Pending', 'Success', 'Working', 'Review', 'Hold'],
        'ClientGroupStatus': ['Active', 'Inactive'],
    };

    try {
        // 1. Add new values to enums
        for (const [typeName, values] of Object.entries(enums)) {
            console.log(`Checking/Adding values for enum ${typeName}...`);
            for (const val of values) {
                try {
                    await prisma.$executeRawUnsafe(`ALTER TYPE "${typeName}" ADD VALUE '${val}'`);
                    console.log(`  Added '${val}' to ${typeName}`);
                } catch (e: any) {
                    if (e.message.includes('already exists')) {
                        console.log(`  '${val}' already exists in ${typeName}`);
                    } else {
                        console.log(`  Failed to add '${val}' to ${typeName}: ${e.message}`);
                    }
                }
            }
        }

        // 2. Update the records
        const updates = [
            { table: 'users', type: 'UserStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended', PENDING_VERIFICATION: 'Pending_Verification' } },
            { table: 'client_groups', type: 'ClientGroupStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'client_companies', type: 'CompanyStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'client_locations', type: 'LocationStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'sub_locations', type: 'SubLocationStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'projects', type: 'ProjectStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive', COMPLETED: 'Completed', ON_HOLD: 'On_Hold' } },
            { table: 'projects', type: 'priority', typeOverride: 'ProjectPriority', mapping: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' } },
            { table: 'teams', type: 'TeamStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'groups', type: 'GroupStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
            { table: 'ip_addresses', type: 'IpAddressStatus', mapping: { ACTIVE: 'Active', INACTIVE: 'Inactive' } },
        ];

        for (const update of updates) {
            console.log(`Updating table ${update.table}...`);
            const columnName = update.type === 'priority' ? 'priority' : 'status';
            const enumTypeName = update.typeOverride || update.type;

            for (const [oldVal, newVal] of Object.entries(update.mapping)) {
                try {
                    const count = await prisma.$executeRawUnsafe(`
                        UPDATE "${update.table}" 
                        SET "${columnName}" = '${newVal}'::"${enumTypeName}" 
                        WHERE "${columnName}"::text = '${oldVal}'
                    `);
                    if (count > 0) console.log(`  Updated ${count} records in ${update.table}: ${oldVal} -> ${newVal}`);
                } catch (e: any) {
                    console.error(`  Failed to update ${update.table} (${oldVal} -> ${newVal}): ${e.message}`);
                }
            }
        }

        console.log('✅ DB Enums Migration completed successfully.');
    } catch (error) {
        console.error('❌ Global Migration error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
