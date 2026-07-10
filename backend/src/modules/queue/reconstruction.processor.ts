import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReconstructionJobData } from '../../common/interfaces';
import { PipelineService } from '../../pipeline/pipeline.service';
import { ProjectsService } from '../projects/projects.service';
import { RECONSTRUCTION_QUEUE } from './queue.constants';

/**
 * BullMQ worker that runs the reconstruction pipeline for one project.
 * Concurrency is 1: photogrammetry is CPU/GPU heavy, so jobs run serially.
 */
@Processor(RECONSTRUCTION_QUEUE, { concurrency: 1 })
export class ReconstructionProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconstructionProcessor.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly projects: ProjectsService,
  ) {
    super();
  }

  async process(job: Job<ReconstructionJobData>): Promise<void> {
    const { projectId } = job.data;
    this.logger.log(`Processing reconstruction for project ${projectId}`);
    try {
      await this.pipeline.run(projectId);
      await job.updateProgress(100);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Reconstruction failed for ${projectId}: ${message}`);
      this.projects.setStatus(projectId, 'failed', message);
      throw err; // let BullMQ mark the job failed
    }
  }
}
