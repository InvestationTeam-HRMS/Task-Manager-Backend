import { PrismaClient } from '@prisma/client';
import * as https from 'https';

const prisma = new PrismaClient();

function getPublicIp(): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org?format=json', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.ip);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
}

async function main() {
    try {
        console.log('🔍 Detecting public IP...');
        const ip = await getPublicIp();
        console.log(`✅ Detected Public IP: ${ip}`);

        const email = 'admin-01@investationteam.com';
        console.log(`🔄 Checking user: ${email}...`);

        const user = await prisma.team.findUnique({ where: { email } });

        if (!user) {
            console.error(`❌ User ${email} not found! Please run setup-external-db.ts first.`);
            return;
        }

        console.log(`📊 Current allowed IPs: ${JSON.stringify(user.allowedIps)}`);

        const ipsToAdd = [ip, '127.0.0.1', '::1'];
        console.log(`🎯 IPs to ensure are allowed: ${ipsToAdd.join(', ')}`);

        let updated = false;
        let currentAllowed = user.allowedIps;

        for (const newIp of ipsToAdd) {
            if (!currentAllowed.includes(newIp)) {
                console.log(`➕ Adding ${newIp} to allowed IPs...`);
                currentAllowed.push(newIp);
                updated = true;
            } else {
                console.log(`ℹ️  IP ${newIp} is already allowed.`);
            }
        }

        if (updated) {
            await prisma.team.update({
                where: { email },
                data: {
                    allowedIps: currentAllowed
                }
            });
            console.log(`✅ Successfully updated allowed IPs.`);
        } else {
            console.log(`✅ All IPs were already allowed. No changes made.`);
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
