import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Project } from '../../common/interfaces';
import { PanoramaService } from '../../pipeline/panorama.service';
import { ProjectsService } from '../projects/projects.service';
import { ReconstructionQueue } from '../queue/reconstruction.queue';

/** Minimum photos the guided capture must produce before we bother stitching. */
const MIN_PHOTOS = 4;

/**
 * Ingests a guided capture: a set of photos shot while rotating in place.
 *
 * The photos arrive in capture order; we preserve that ordering on disk
 * (`photo_000.jpg`, ...) because OpenCV's stitcher matches consecutive frames
 * far more reliably than an arbitrary ordering.
 */
@Injectable()
export class PanoramaCaptureService {
  private readonly logger = new Logger(PanoramaCaptureService.name);

  constructor(
    private readonly projects: ProjectsService,
    private readonly panorama: PanoramaService,
    private readonly queue: ReconstructionQueue,
  ) {}

  async handleCapture(files: Express.Multer.File[], name?: string): Promise<Project> {
    if (!files || files.length < MIN_PHOTOS) {
      throw new BadRequestException(
        `Need at least ${MIN_PHOTOS} photos to build a photosphere, received ${files?.length ?? 0}.`,
      );
    }

    const project = this.projects.create({
      kind: 'panorama',
      originalName: name?.trim() || `Capture ${new Date().toLocaleString()}`,
      originalPath: '',
      photoCount: files.length,
    });

    const ws = this.panorama.createWorkspace(project.id);
    files.forEach((file, index) => {
      const ext = this.extensionFor(file);
      const dest = path.join(ws.photos, `photo_${String(index).padStart(3, '0')}${ext}`);
      fs.writeFileSync(dest, file.buffer);
    });

    this.projects.update(project.id, { originalPath: ws.photos, status: 'queued' });
    await this.queue.enqueue(project.id, 'panorama');
    this.logger.log(`Panorama project ${project.id} queued with ${files.length} photos`);

    return this.projects.findOne(project.id);
  }

  private extensionFor(file: Express.Multer.File): string {
    if (file.mimetype === 'image/png') return '.png';
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') return '.jpg';
    const ext = path.extname(file.originalname ?? '').toLowerCase();
    if (['.jpg', '.jpeg', '.png'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
    throw new BadRequestException(`Unsupported photo type: ${file.mimetype}`);
  }
}
