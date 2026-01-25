
import { PrismaClient, TeamStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';
import { createClient } from 'redis';

dotenv.config();

async function main() {
    dotenv.config();
    const dbUrl = process.env.DATABASE_URL || '';
    console.log(`Using Database: ${dbUrl.split('@')[1] || 'local'}`);
    const prisma = new PrismaClient();

    // 1. Fetch all pending users
    const pendingUsers = await prisma.team.findMany({
        where: {
            status: TeamStatus.Pending_Verification,
            password: '', // Only those who haven't set a password
        },
    });

    console.log(`Found ${pendingUsers.length} users with Pending_Verification status.`);

    if (pendingUsers.length === 0) {
        console.log('No pending invitations to send.');
        return;
    }

    // 2. Setup Redis for tokens
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisClient = createClient({ url: redisUrl });
    await redisClient.connect();

    // 3. Setup SMTP
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: {
            rejectUnauthorized: false,
        }
    });

    const fromEmail = process.env.SMTP_FROM || `"HRMS Support" <${process.env.SMTP_USER}>`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    for (const user of pendingUsers) {
        if (!user.email) continue;

        console.log(`Processing: ${user.teamName} (${user.email})`);
        const token = uuidv4();

        try {
            // Save to Redis (24 hours)
            await redisClient.set(`invitation:${token}`, user.email, { EX: 86400 });

            const link = `${frontendUrl}/set-password?token=${token}&email=${user.email}`;

            await transporter.sendMail({
                from: fromEmail,
                to: user.email,
                subject: '🤝 Welcome to Mission HRMS - Set Your Password',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <div style="background: linear-gradient(135deg, #FF3D71 0%, #FF8A9B 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Secure Your Account</h1>
                        </div>
                        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                            <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.teamName}</strong>,</p>
                            <p style="font-size: 16px; margin-bottom: 20px;">Welcome to <strong>Mission HRMS</strong>! Your account has been created. For security reasons, you must set an initial password before you can log in.</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${link}" style="background-color: #FF3D71; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Set My Password</a>
                            </div>
                            <p style="font-size: 14px; color: #666;">If the button above does not work, copy and paste the following link into your browser:</p>
                            <p style="font-size: 12px; color: #FF3D71; word-break: break-all;">${link}</p>
                            <p style="font-size: 14px; color: #666; margin-top: 20px;">This link is valid for <strong>24 hours</strong>. If you did not expect this invitation, please contact your HR administrator.</p>
                            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                            <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Mission HRMS. All rights reserved.</p>
                        </div>
                    </body>
                    </html>
                `,
            });

            console.log(`✅ Sent to ${user.email}`);
        } catch (err: any) {
            console.error(`❌ Failed for ${user.email}: ${err.message}`);
        }
    }

    await redisClient.disconnect();
    await prisma.$disconnect();
    console.log('Done.');
}

main().catch(console.error);
