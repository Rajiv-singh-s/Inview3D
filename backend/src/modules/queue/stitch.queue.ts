import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { StitchJobData } from '../../common/interfaces';
import { STITCH_JOB, STITCH_QUEUE } from './queue.constants';

/**
 * Small facade over the BullMQ queue so callers don't depend on BullMQ
 * specifics and job options stay consistent in one place.
 */
@Injectable()
export class StitchQueue {
  constructor(
    @InjectQueue(STITCH_QUEUE)
    private readonly queue: Queue<StitchJobData>,
  ) {}

  /** Enqueue a stitching job keyed by projectId (also used as jobId). */
  async enqueue(projectId: string): Promise<void> {
    await this.queue.add(
      STITCH_JOB,
      { projectId },
      {
        jobId: projectId,
        attempts: 1, // stitching is non-idempotent — no auto retry
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
