import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StitchJobData } from '../../common/interfaces';
import { PanoramaService } from '../../pipeline/panorama.service';
import { ProjectsService } from '../projects/projects.service';
import { STITCH_QUEUE } from './queue.constants';

/**
 * BullMQ worker that stitches one capture into a photosphere.
 * Concurrency is 1: stitching is CPU/memory heavy, so jobs run serially.
 */
@Processor(STITCH_QUEUE, { concurrency: 1 })
export class StitchProcessor extends WorkerHost {
  private readonly logger = new Logger(StitchProcessor.name);

  constructor(
    private readonly panorama: PanoramaService,
    private readonly projects: ProjectsService,
  ) {
    super();
  }

  async process(job: Job<StitchJobData>): Promise<void> {
    const { projectId } = job.data;
    this.logger.log(`Stitching photosphere for project ${projectId}`);
    try {
      await this.panorama.run(projectId);
      await job.updateProgress(100);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Stitching failed for ${projectId}: ${message}`);
      this.projects.setStatus(projectId, 'failed', message);
      throw err; // let BullMQ mark the job failed
    }
  }
}
