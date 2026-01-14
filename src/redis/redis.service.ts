import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis;

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
        this.client = new Redis({
            host: this.configService.get('REDIS_HOST'),
            port: this.configService.get('REDIS_PORT'),
            password: this.configService.get('REDIS_PASSWORD'),
            db: this.configService.get('REDIS_DB', 0),
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        this.client.on('connect', () => {
            this.logger.log('✅ Redis connected successfully');
        });

        this.client.on('error', (error) => {
            this.logger.error('❌ Redis connection error', error);
        });
    }

    async onModuleDestroy() {
        await this.client.quit();
        this.logger.log('Redis disconnected');
    }

    // OTP Management
    async setOTP(email: string, otp: string, ttl: number = 600): Promise<void> {
        await this.client.setex(`otp:${email}`, ttl, otp);
    }

    async getOTP(email: string): Promise<string | null> {
        return await this.client.get(`otp:${email}`);
    }

    async deleteOTP(email: string): Promise<void> {
        await this.client.del(`otp:${email}`);
    }

    // Session Management
    async setSession(sessionId: string, data: any, ttl: number): Promise<void> {
        await this.client.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
    }

    async getSession(sessionId: string): Promise<any> {
        const data = await this.client.get(`session:${sessionId}`);
        return data ? JSON.parse(data) : null;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.client.del(`session:${sessionId}`);
    }

    async extendSession(sessionId: string, ttl: number): Promise<void> {
        await this.client.expire(`session:${sessionId}`, ttl);
    }

    // Refresh Token Management
    async setRefreshToken(token: string, userId: string, ttl: number): Promise<void> {
        await this.client.setex(`refresh:${token}`, ttl, userId);
    }

    async getRefreshToken(token: string): Promise<string | null> {
        return await this.client.get(`refresh:${token}`);
    }

    async deleteRefreshToken(token: string): Promise<void> {
        await this.client.del(`refresh:${token}`);
    }

    // Rate Limiting
    async incrementRateLimit(key: string, ttl: number): Promise<number> {
        const current = await this.client.incr(`ratelimit:${key}`);
        if (current === 1) {
            await this.client.expire(`ratelimit:${key}`, ttl);
        }
        return current;
    }

    async getRateLimit(key: string): Promise<number> {
        const value = await this.client.get(`ratelimit:${key}`);
        return value ? parseInt(value, 10) : 0;
    }

    // Cache Management
    async setCache(key: string, value: any, ttl?: number): Promise<void> {
        const data = JSON.stringify(value);
        if (ttl) {
            await this.client.setex(`cache:${key}`, ttl, data);
        } else {
            await this.client.set(`cache:${key}`, data);
        }
    }

    async getCache<T>(key: string): Promise<T | null> {
        const data = await this.client.get(`cache:${key}`);
        return data ? JSON.parse(data) : null;
    }

    async deleteCache(key: string): Promise<void> {
        await this.client.del(`cache:${key}`);
    }

    async deleteCachePattern(pattern: string): Promise<void> {
        const keys = await this.client.keys(`cache:${pattern}`);
        if (keys.length > 0) {
            await this.client.del(...keys);
        }
    }

    // Generic operations
    async set(key: string, value: string, ttl?: number): Promise<void> {
        if (ttl) {
            await this.client.setex(key, ttl, value);
        } else {
            await this.client.set(key, value);
        }
    }

    async get(key: string): Promise<string | null> {
        return await this.client.get(key);
    }

    async del(key: string): Promise<void> {
        await this.client.del(key);
    }

    async exists(key: string): Promise<boolean> {
        const result = await this.client.exists(key);
        return result === 1;
    }

    getClient(): Redis {
        return this.client;
    }
}
