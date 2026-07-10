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
  face: string;
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
   * Parses the device poses that accompanied the photos. For the cubemap pipeline,
   * we expect exactly 18 poses, each specifying which cube face the photo belongs to.
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
        (p) => Number.isFinite(p?.yaw) && Number.isFinite(p?.pitch) && typeof p?.face === 'string',
      );
      if (!ok) {
        this.logger.warn('Ignoring poses: contains invalid values or missing face tag');
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
    if (!files || files.length !== 18) {
      throw new BadRequestException(
        `Need exactly 18 photos to build a cubemap (3 per face), received ${files?.length ?? 0}.`,
      );
    }

    const poses = this.parsePoses(posesRaw, files.length);
    if (!poses) {
      throw new BadRequestException('Valid poses with face metadata are required for cubemap capture.');
    }

    const project = this.projects.create({
      originalName: name?.trim() || `Cube Capture ${new Date().toLocaleString()}`,
      originalPath: '',
      photoCount: files.length,
    });

    const ws = this.panorama.createWorkspace(project.id);
    
    // Create face subdirectories
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    for (const face of faces) {
      fs.mkdirSync(path.join(ws.photos, face), { recursive: true });
    }

    const keyed: Array<{ file: string; face: string; yaw: number; pitch: number }> = [];

    files.forEach((file, index) => {
      const pose = poses[index];
      const face = pose.face.toLowerCase();
      if (!faces.includes(face)) {
         throw new BadRequestException(`Invalid face name: ${face}`);
      }
      
      const ext = this.extensionFor(file);
      const filename = `photo_${String(index).padStart(3, '0')}${ext}`;
      const dest = path.join(ws.photos, face, filename);
      
      fs.writeFileSync(dest, file.buffer);
      
      keyed.push({
        file: `${face}/${filename}`,
        face,
        yaw: pose.yaw,
        pitch: pose.pitch,
      });
    });

    // Persist the device poses next to the photos
    fs.writeFileSync(path.join(ws.root, 'poses.json'), JSON.stringify(keyed, null, 2), 'utf8');
    this.logger.log(`Stored ${keyed.length} device poses for ${project.id}`);

    this.projects.update(project.id, { originalPath: ws.photos, status: 'queued' });
    await this.queue.enqueue(project.id);
    this.logger.log(`Cubemap project ${project.id} queued with ${files.length} photos`);

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
