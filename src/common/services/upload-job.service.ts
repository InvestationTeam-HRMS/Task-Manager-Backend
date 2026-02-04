import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

export type UploadJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type UploadJobRecord = {
  jobId: string;
  status: UploadJobStatus;
  module: string;
  fileName: string;
  userId: string;
  message?: string;
  success?: number;
  failed?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

@Injectable()
export class UploadJobService {
  private readonly ttlSeconds =
    Number(process.env.UPLOAD_STATUS_TTL_SECONDS) || 86400;

  constructor(private redisService: RedisService) {}

  private buildKey(jobId: string) {
    return `upload_job:${jobId}`;
  }

  async createJob(params: {
    module: string;
    fileName: string;
    userId: string;
  }): Promise<UploadJobRecord> {
    const now = new Date().toISOString();
    const job: UploadJobRecord = {
      jobId: uuidv4(),
      status: 'queued',
      module: params.module,
      fileName: params.fileName,
      userId: params.userId,
      createdAt: now,
      updatedAt: now,
    };

    await this.redisService.set(
      this.buildKey(job.jobId),
      JSON.stringify(job),
      this.ttlSeconds,
    );
    return job;
  }

  async getJob(jobId: string): Promise<UploadJobRecord | null> {
    const data = await this.redisService.get(this.buildKey(jobId));
    return data ? (JSON.parse(data) as UploadJobRecord) : null;
  }

  async markProcessing(jobId: string): Promise<UploadJobRecord | null> {
    return this.updateJob(jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });
  }

  async markCompleted(
    jobId: string,
    params: { success: number; failed: number; message?: string },
  ): Promise<UploadJobRecord | null> {
    return this.updateJob(jobId, {
      status: 'completed',
      success: params.success,
      failed: params.failed,
      message: params.message,
      finishedAt: new Date().toISOString(),
    });
  }

  async markFailed(
    jobId: string,
    message: string,
  ): Promise<UploadJobRecord | null> {
    return this.updateJob(jobId, {
      status: 'failed',
      message,
      finishedAt: new Date().toISOString(),
    });
  }

  private async updateJob(
    jobId: string,
    patch: Partial<UploadJobRecord>,
  ): Promise<UploadJobRecord | null> {
    const existing = await this.getJob(jobId);
    if (!existing) return null;

    const updated: UploadJobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await this.redisService.set(
      this.buildKey(jobId),
      JSON.stringify(updated),
      this.ttlSeconds,
    );

    return updated;
  }
}
