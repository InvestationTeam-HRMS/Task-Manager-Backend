
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { createClient } from 'redis';

dotenv.config();

async function main() {
    console.log('--- Debugging Email & Redis ---');

    const email = 'gauravchand222@gmail.com';
    const teamName = 'Debug User';
    const token = uuidv4();

    // 1. Test Redis
    console.log('\n1. Testing Redis...');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({ url: redisUrl });

    try {
        await client.connect();
        console.log('✅ Redis connected');
        await client.set(`debug:invitation:${token}`, email, { EX: 60 });
        const val = await client.get(`debug:invitation:${token}`);
        console.log(`✅ Redis Set/Get successful: ${val}`);
        await client.disconnect();
    } catch (err: any) {
        console.error(`❌ Redis Error: ${err.message}`);
    }

    // 2. Test SMTP
    console.log('\n2. Testing SMTP...');
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpSecure = process.env.SMTP_SECURE === 'true';

    console.log(`Config: ${smtpHost}:${smtpPort} (Secure: ${smtpSecure})`);
    console.log(`User: ${smtpUser}`);
    console.log(`From: ${process.env.SMTP_FROM}`);

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.error('❌ SMTP config missing in .env');
        return;
    }

    console.log('Creating transporter...');
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
        tls: {
            rejectUnauthorized: false,
        },
        debug: true,
        logger: true
    });

    try {
        console.log('Verifying transporter...');
        await transporter.verify();
        console.log('✅ SMTP connection verified');

        console.log(`Sending test email to ${email}...`);
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || `"HRMS Support" <${smtpUser}>`,
            to: email,
            subject: 'Test Email - HRMS Debug',
            html: `<h1>Test Email</h1><p>This is a test email to debug the invitation flow. Token: ${token}</p>`,
        });
        console.log('✅ Email sent successfully!');
        console.log('Message ID:', info.messageId);
    } catch (err: any) {
        console.error(`❌ SMTP Error: ${err.message}`);
        console.error(err);
    }
    console.log('Done.');
}

main().catch(console.error);
