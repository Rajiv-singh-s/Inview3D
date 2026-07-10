import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Project } from '../../common/interfaces';
import { PanoramaService } from '../../pipeline/panorama.service';
import { ProjectsService } from '../projects/projects.service';
import { StitchQueue } from '../queue/stitch.queue';

/** Minimum photos the guided capture must produce before we bother stitching. */
const MIN_PHOTOS = 4;

/** Device orientation recorded at the moment a photo was taken. */
interface DevicePose {
  yaw: number;
  pitch: number;
}

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
    private readonly queue: StitchQueue,
  ) {}

  /**
   * Parses the device poses that accompanied the photos. Never throws: a
   * capture without usable poses still stitches, it just loses the fallback.
   */
  private parsePoses(raw: string | undefined, expected: number): DevicePose[] | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DevicePose[];
      if (!Array.isArray(parsed) || parsed.length !== expected) {
        this.logger.warn(`Ignoring poses: got ${parsed?.length}, expected ${expected}`);
        return null;
      }
      const ok = parsed.every(
        (p) => Number.isFinite(p?.yaw) && Number.isFinite(p?.pitch),
      );
      if (!ok) {
        this.logger.warn('Ignoring poses: contains non-finite values');
        return null;
      }
      return parsed;
    } catch {
      this.logger.warn('Ignoring poses: not valid JSON');
      return null;
    }
  }

  async handleCapture(
    files: Express.Multer.File[],
    name?: string,
    posesRaw?: string,
  ): Promise<Project> {
    if (!files || files.length < MIN_PHOTOS) {
      throw new BadRequestException(
        `Need at least ${MIN_PHOTOS} photos to build a photosphere, received ${files?.length ?? 0}.`,
      );
    }

    const project = this.projects.create({
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

    // Persist the device poses next to the photos, keyed by the same filenames
    // the stitcher globs, so ordering can never drift between the two.
    const poses = this.parsePoses(posesRaw, files.length);
    if (poses) {
      const keyed = files.map((file, index) => ({
        file: `photo_${String(index).padStart(3, '0')}${this.extensionFor(file)}`,
        yaw: poses[index].yaw,
        pitch: poses[index].pitch,
      }));
      fs.writeFileSync(path.join(ws.root, 'poses.json'), JSON.stringify(keyed, null, 2), 'utf8');
      this.logger.log(`Stored ${keyed.length} device poses for ${project.id}`);
    }

    this.projects.update(project.id, { originalPath: ws.photos, status: 'queued' });
    await this.queue.enqueue(project.id);
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
