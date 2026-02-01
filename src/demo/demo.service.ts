import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { ClientGroupService } from '../client-group/client-group.service';
import { PdfService, ApiSection, ApiEndpoint } from '../pdf/pdf.service';
import { v4 as uuidv4 } from 'uuid';
import { ClientGroupStatus } from '@prisma/client';

@Injectable()
export class DemoService {
    private readonly logger = new Logger(DemoService.name);

    constructor(
        private authService: AuthService,
        private clientGroupService: ClientGroupService,
        private pdfService: PdfService,
        private redisService: RedisService,
    ) { }

    async runDemo() {
        this.logger.log('🚀 Starting System Demo & Test...');
        const sections: ApiSection[] = [];
        const testId = uuidv4().substring(0, 8);
        const email = `demo.test.${testId}@example.com`;
        const password = 'Test@123456';
        const ip = '127.0.0.1';

        // 1. Authentication
        const authSection: ApiSection = { title: 'Authentication Module', apis: [] };
        let userId: string;
        let token: string;

        try {
            // Register (Step 1)
            this.logger.log('Testing Register (Step 1)...');
            const regDto = {
                email,
                password,
                teamName: 'Demo User',
            };
            const regResult = await this.authService.register(regDto, ip);

            authSection.apis.push({
                name: 'Register User (Step 1)',
                endpoint: '/api/v1/auth/register',
                method: 'POST',
                description: 'Initiate registration',
                authRequired: false,
                requestExample: regDto,
                responseExample: regResult,
            });

            // Verify OTP (Step 2)
            // Fetch OTP from Redis for the demo
            const regOtp = await this.redisService.getOTP(email);
            if (regOtp) {
                this.logger.log(`Testing Verify OTP (Step 2) with OTP: ${regOtp}...`);
                const verifyResult = await this.authService.verifyOtp({ email, otp: regOtp }, ip);

                authSection.apis.push({
                    name: 'Verify Registration OTP (Step 2)',
                    endpoint: '/api/v1/auth/verify-otp',
                    method: 'POST',
                    description: 'Complete registration',
                    authRequired: false,
                    requestExample: { email, otp: regOtp },
                    responseExample: verifyResult,
                });
            }

            // Login (Step 1)
            this.logger.log('Testing Login (Step 1)...');
            const loginResult = await this.authService.login({ email, password }, ip);

            authSection.apis.push({
                name: 'Login (Step 1)',
                endpoint: '/api/v1/auth/login',
                method: 'POST',
                description: 'Initiate Login',
                authRequired: false,
                requestExample: { email, password },
                responseExample: loginResult
            });

            // Verify Login OTP (Step 2)
            const loginOtp = await this.redisService.getLoginOTP(email);
            if (loginOtp) {
                this.logger.log(`Testing Login Verification (Step 2) with OTP: ${loginOtp}...`);
                const verifyLoginResult = await this.authService.verifyLogin({ email, otp: loginOtp }, ip);

                if (verifyLoginResult.user) {
                    userId = verifyLoginResult.user.id;
                    token = verifyLoginResult.accessToken;

                    authSection.apis.push({
                        name: 'Verify Login OTP (Step 2)',
                        endpoint: '/api/v1/auth/verify-login',
                        method: 'POST',
                        description: 'Complete Login & Get Tokens',
                        authRequired: false,
                        requestExample: { email, otp: loginOtp },
                        responseExample: {
                            accessToken: '********',
                            refreshToken: '********',
                            user: verifyLoginResult.user
                        }
                    });
                }
            }

        } catch (error) {
            this.logger.warn(`Auth demo incomplete: ${error.message}`);
        }
        sections.push(authSection);

        // 2. Client Group
        const cgSection: ApiSection = { title: 'Client Group Module', apis: [] };

        // Create (Simulate request payload)
        cgSection.apis.push({
            name: 'Create Client Group',
            endpoint: '/api/v1/client-groups',
            method: 'POST',
            description: 'Create a new client group',
            authRequired: true,
            roles: ['ADMIN', 'HR'],
            requestExample: {
                groupNo: 'GRP-TEST',
                groupName: 'Test Corp',
                groupCode: `TC-${testId}`,
                country: 'India',
                status: 'Active'
            },
            responseExample: {
                id: 'uuid',
                cgNumber: 'CG-11002',
                status: 'Active'
            }
        });

        // List
        cgSection.apis.push({
            name: 'List Client Groups',
            endpoint: '/api/v1/client-groups',
            method: 'GET',
            description: 'Get all client groups',
            authRequired: true,
            responseExample: {
                data: [],
                meta: { total: 0, page: 1 }
            }
        });

        sections.push(cgSection);

        // Generate PDF
        const pdfPath = await this.pdfService.generateReport('System Capability Demonstration', sections, 'system-demo-report.pdf');
        return {
            message: 'Demo executed and report generated',
            reportPath: pdfPath,
            summary: sections
        };
    }
}
