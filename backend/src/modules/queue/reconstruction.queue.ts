import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ReconstructionJobData } from '../../common/interfaces';
import { RECONSTRUCTION_JOB, RECONSTRUCTION_QUEUE } from './queue.constants';

/**
 * Small facade over the BullMQ queue so callers (UploadService) don't depend
 * on BullMQ specifics and job options stay consistent in one place.
 */
@Injectable()
export class ReconstructionQueue {
  constructor(
    @InjectQueue(RECONSTRUCTION_QUEUE)
    private readonly queue: Queue<ReconstructionJobData>,
  ) {}

  /** Enqueue a reconstruction job keyed by projectId (also used as jobId). */
  async enqueue(projectId: string): Promise<void> {
    await this.queue.add(
      RECONSTRUCTION_JOB,
      { projectId },
      {
        jobId: projectId,
        attempts: 1, // reconstruction is expensive & non-idempotent — no auto retry
        removeOnComplete: { age: 3600 },
        removeOnFail: false,
      },
    );
  }

  /** Remove a queued/active job (used for cancel/delete). */
  async cancel(projectId: string): Promise<void> {
    const job = await this.queue.getJob(projectId);
    if (job) await job.remove();
  }
}
