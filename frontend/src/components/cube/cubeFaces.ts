import * as THREE from 'three';

/** The six faces of the room cube, in a fixed order used everywhere. */
export const CUBE_FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

/** Resolution of each face texture. Square; a room wall is one face. */
const FACE_SIZE = 1024;

/**
 * Holds one offscreen canvas + GPU texture per cube face and paints captured
 * camera frames onto them. This is the live room model: the capture screen and
 * the viewer both render these exact textures, so the cube the user builds
 * during capture *is* the cube they explore afterwards.
 *
 * Framework-agnostic on purpose — three.js objects are created here but no
 * React. A component owns one instance and disposes it on unmount.
 */
export class CubeFaces {
  private readonly canvases = new Map<CubeFace, HTMLCanvasElement>();
  readonly textures = new Map<CubeFace, THREE.CanvasTexture>();
  /** Which faces have received a real capture (vs. still void/black). */
  private readonly painted = new Set<CubeFace>();

  constructor() {
    for (const face of CUBE_FACES) {
      const canvas = document.createElement('canvas');
      canvas.width = FACE_SIZE;
      canvas.height = FACE_SIZE;
      const ctx = canvas.getContext('2d')!;
      // Empty faces are the black void described by the capture model.
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      this.canvases.set(face, canvas);
      this.textures.set(face, texture);
    }
  }

  /**
   * Projects a captured frame onto a face, cover-fitting it (fill the square,
   * crop the overflow) so a ~4:3 phone frame maps cleanly onto a square wall.
   * Marks the texture for GPU re-upload so the change is visible next frame.
   */
  paint(face: CubeFace, source: CanvasImageSource, sourceWidth: number, sourceHeight: number): void {
    const canvas = this.canvases.get(face);
    const texture = this.textures.get(face);
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d')!;

    const scale = Math.max(FACE_SIZE / sourceWidth, FACE_SIZE / sourceHeight);
    const dw = sourceWidth * scale;
    const dh = sourceHeight * scale;
    const dx = (FACE_SIZE - dw) / 2;
    const dy = (FACE_SIZE - dh) / 2;

    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
    ctx.drawImage(source, dx, dy, dw, dh);

    this.painted.add(face);
    texture.needsUpdate = true;
  }

  /** Paints a face directly from an <img>/<canvas> already at final size. */
  paintImage(face: CubeFace, image: HTMLImageElement): void {
    this.paint(face, image, image.naturalWidth, image.naturalHeight);
  }

  isPainted(face: CubeFace): boolean {
    return this.painted.has(face);
  }

  paintedCount(): number {
    return this.painted.size;
  }

  /** Exports every painted face as a JPEG blob for upload. */
  async exportFaces(quality = 0.9): Promise<Map<CubeFace, Blob>> {
    const out = new Map<CubeFace, Blob>();
    for (const face of CUBE_FACES) {
      if (!this.painted.has(face)) continue;
      const canvas = this.canvases.get(face)!;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
      );
      if (blob) out.set(face, blob);
    }
    return out;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.canvases.clear();
  }
}
