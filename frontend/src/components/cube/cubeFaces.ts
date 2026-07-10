import * as THREE from 'three';

/** The six faces of the room cube, in a fixed order used everywhere. */
export const CUBE_FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'] as const;
export type CubeFace = (typeof CUBE_FACES)[number];

/**
 * Resolution of each face texture. High-res so accumulated captures keep detail.
 * Every painted face allocates ~FACE_SIZE² · 8 bytes (RGBA + weight), so six
 * faces at 2048 is ~200 MB — acceptable on modern phones, lower this if needed.
 */
const FACE_SIZE = 2048;

/**
 * A face counts as "captured" for guidance once this fraction of it has real
 * pixels. One centred shot through a ~68° camera covers the middle ~half of a
 * 90° face, so a modest threshold lets the six-target flow complete while still
 * letting overlapping captures keep enriching the face beyond it.
 */
const CAPTURE_COVERAGE_THRESHOLD = 0.25;

/** A device pose: yaw/pitch of the camera relative to the capture origin (deg). */
export interface CameraPose {
  yaw: number;
  pitch: number;
}

/**
 * Maps a face texel (u,v ∈ [0,1], v=0 at the top) to the world direction that
 * texel represents. Derived to match exactly the plane transforms in
 * CubeScene, so a projected pixel lands where the viewer will show it.
 */
function uvToDir(face: CubeFace, u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const a = 2 * u - 1;
  const b = 1 - 2 * v;
  switch (face) {
    case 'front':
      return out.set(a, b, -1);
    case 'back':
      return out.set(-a, b, 1);
    case 'right':
      return out.set(1, b, a);
    case 'left':
      return out.set(-1, b, -a);
    case 'top':
      return out.set(a, 1, b);
    case 'bottom':
      return out.set(a, -1, -b);
  }
}

/** Inverse of {@link uvToDir}: which face a world direction belongs to, and where. */
function dirToFaceUV(d: THREE.Vector3): { face: CubeFace; u: number; v: number } {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  let face: CubeFace;
  let a: number;
  let b: number;
  if (az >= ax && az >= ay) {
    if (d.z < 0) ((face = 'front'), (a = d.x / az), (b = d.y / az));
    else ((face = 'back'), (a = -d.x / az), (b = d.y / az));
  } else if (ax >= ay) {
    if (d.x > 0) ((face = 'right'), (a = d.z / ax), (b = d.y / ax));
    else ((face = 'left'), (a = -d.z / ax), (b = d.y / ax));
  } else {
    if (d.y > 0) ((face = 'top'), (a = d.x / ay), (b = d.z / ay));
    else ((face = 'bottom'), (a = d.x / ay), (b = -d.z / ay));
  }
  return { face, u: (a + 1) / 2, v: (1 - b) / 2 };
}

/**
 * The live room model. Each face is a continuously refined texture canvas, not
 * a single photo: every accepted capture is projected into cube space and
 * blended into whichever faces it geometrically covers, weighted so overlaps
 * merge seamlessly and nothing is overwritten. The capture screen and the
 * viewer render these exact textures.
 */
export class CubeFaces {
  private readonly canvases = new Map<CubeFace, HTMLCanvasElement>();
  readonly textures = new Map<CubeFace, THREE.CanvasTexture>();

  /** Persistent RGBA pixels per face (authoritative buffer, mirrored to the canvas). */
  private readonly pixels = new Map<CubeFace, ImageData>();
  /** Accumulated blend weight per texel, parallel to {@link pixels}. */
  private readonly weights = new Map<CubeFace, Float32Array>();
  /** Fraction of texels that have received any real projection. */
  private readonly coverage = new Map<CubeFace, number>();

  constructor() {
    for (const face of CUBE_FACES) {
      const canvas = document.createElement('canvas');
      canvas.width = FACE_SIZE;
      canvas.height = FACE_SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0b0d12'; // the black void before any capture
      ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      this.canvases.set(face, canvas);
      this.textures.set(face, texture);
      this.coverage.set(face, 0);
    }
  }

  private ensureBuffers(face: CubeFace): { data: ImageData; weight: Float32Array } {
    let data = this.pixels.get(face);
    let weight = this.weights.get(face);
    if (!data || !weight) {
      const ctx = this.canvases.get(face)!.getContext('2d')!;
      data = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE);
      weight = new Float32Array(FACE_SIZE * FACE_SIZE);
      this.pixels.set(face, data);
      this.weights.set(face, weight);
    }
    return { data, weight };
  }

  /**
   * Projects a captured frame into cube space and blends it onto every face it
   * covers. Perspective-correct: for each destination texel we cast its world
   * ray back into the camera and sample the source with bilinear filtering,
   * so straight lines stay straight and no pixels are cropped except those that
   * fall outside the frame or belong to a different face.
   */
  project(frame: HTMLCanvasElement, pose: CameraPose, hFovDeg: number): void {
    const srcW = frame.width;
    const srcH = frame.height;
    const srcCtx = frame.getContext('2d')!;
    const src = srcCtx.getImageData(0, 0, srcW, srcH).data;

    // Camera basis from the pose, matching CubeScene's Euler(pitch, -yaw, 0, YXZ).
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(pose.pitch),
        THREE.MathUtils.degToRad(-pose.yaw),
        0,
        'YXZ',
      ),
    );
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    const tanH = Math.tan(THREE.MathUtils.degToRad(hFovDeg) / 2);
    const tanV = tanH * (srcH / srcW);

    // Which faces does this frame touch, and over what texel bounds? Forward
    // project a grid of source points to bound the work per face.
    const bounds = this.computeBounds(q, tanH, tanV);

    const d = new THREE.Vector3();
    for (const face of CUBE_FACES) {
      const box = bounds.get(face);
      if (!box) continue;
      const { data, weight } = this.ensureBuffers(face);
      const px = data.data;

      let newlyCovered = 0;
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) {
          uvToDir(face, (x + 0.5) / FACE_SIZE, (y + 0.5) / FACE_SIZE, d).normalize();

          const zc = d.dot(fwd);
          if (zc <= 1e-3) continue; // behind the camera
          const nx = d.dot(right) / zc / tanH;
          const ny = d.dot(up) / zc / tanV;
          if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue; // outside the frame

          // Source pixel (image y grows downward; camera up is smaller y).
          const sx = (nx * 0.5 + 0.5) * (srcW - 1);
          const sy = (0.5 - ny * 0.5) * (srcH - 1);
          const [r, g, bl] = bilinear(src, srcW, srcH, sx, sy);

          // Feather toward the frame edges + foreshorten, so overlaps blend and
          // seams disappear. Edge pixels contribute, just with less weight.
          const w = zc * (1 - Math.abs(nx)) * (1 - Math.abs(ny));
          if (w <= 0) continue;

          const wi = y * FACE_SIZE + x;
          const w0 = weight[wi];
          const inv = 1 / (w0 + w);
          const pi = wi * 4;
          px[pi] = (px[pi] * w0 + r * w) * inv;
          px[pi + 1] = (px[pi + 1] * w0 + g * w) * inv;
          px[pi + 2] = (px[pi + 2] * w0 + bl * w) * inv;
          px[pi + 3] = 255;
          if (w0 === 0) newlyCovered++;
          weight[wi] = w0 + w;
        }
      }

      if (box.x1 >= box.x0 && box.y1 >= box.y0) {
        const ctx = this.canvases.get(face)!.getContext('2d')!;
        ctx.putImageData(data, 0, 0, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
        this.textures.get(face)!.needsUpdate = true;
        this.coverage.set(face, (this.coverage.get(face) ?? 0) + newlyCovered / (FACE_SIZE * FACE_SIZE));
      }
    }
  }

  /** Per-face texel bounding boxes covered by the current frame. */
  private computeBounds(
    q: THREE.Quaternion,
    tanH: number,
    tanV: number,
  ): Map<CubeFace, { x0: number; y0: number; x1: number; y1: number }> {
    const out = new Map<CubeFace, { x0: number; y0: number; x1: number; y1: number }>();
    const N = 12;
    const ray = new THREE.Vector3();
    for (let gy = 0; gy <= N; gy++) {
      for (let gx = 0; gx <= N; gx++) {
        const nx = (gx / N) * 2 - 1;
        const ny = (gy / N) * 2 - 1;
        ray.set(nx * tanH, ny * tanV, -1).applyQuaternion(q).normalize();
        const { face, u, v } = dirToFaceUV(ray);
        const x = Math.min(FACE_SIZE - 1, Math.max(0, Math.round(u * (FACE_SIZE - 1))));
        const y = Math.min(FACE_SIZE - 1, Math.max(0, Math.round(v * (FACE_SIZE - 1))));
        const box = out.get(face);
        if (!box) out.set(face, { x0: x, y0: y, x1: x, y1: y });
        else {
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x);
          box.y1 = Math.max(box.y1, y);
        }
      }
    }
    // Pad a little so the coarse grid never clips the true coverage edge.
    const pad = Math.round(FACE_SIZE * 0.03);
    for (const box of out.values()) {
      box.x0 = Math.max(0, box.x0 - pad);
      box.y0 = Math.max(0, box.y0 - pad);
      box.x1 = Math.min(FACE_SIZE - 1, box.x1 + pad);
      box.y1 = Math.min(FACE_SIZE - 1, box.y1 + pad);
    }
    return out;
  }

  /** Draws a finished face image straight onto the canvas (used by the viewer). */
  paintImage(face: CubeFace, image: HTMLImageElement): void {
    const canvas = this.canvases.get(face);
    const texture = this.textures.get(face);
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, FACE_SIZE, FACE_SIZE);
    texture.needsUpdate = true;
    this.coverage.set(face, 1);
  }

  /** Fraction of a face that has received projected pixels (0–1). */
  coverageOf(face: CubeFace): number {
    return this.coverage.get(face) ?? 0;
  }

  isPainted(face: CubeFace): boolean {
    return (this.coverage.get(face) ?? 0) > 0;
  }

  /** True once a face has accumulated enough coverage to count toward progress. */
  isCaptured(face: CubeFace): boolean {
    return (this.coverage.get(face) ?? 0) >= CAPTURE_COVERAGE_THRESHOLD;
  }

  /** Number of faces that have reached the capture-coverage threshold. */
  capturedCount(): number {
    return CUBE_FACES.filter((f) => this.isCaptured(f)).length;
  }

  paintedCount(): number {
    return CUBE_FACES.filter((f) => this.isPainted(f)).length;
  }

  /** Exports every painted face as a JPEG blob for upload. */
  async exportFaces(quality = 0.92): Promise<Map<CubeFace, Blob>> {
    const out = new Map<CubeFace, Blob>();
    for (const face of CUBE_FACES) {
      if (!this.isPainted(face)) continue;
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
    this.pixels.clear();
    this.weights.clear();
  }
}

/** Bilinear sample of an RGBA buffer at fractional (x,y). */
function bilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const chan = (o: number) =>
    lerp(lerp(data[i00 + o], data[i10 + o], fx), lerp(data[i01 + o], data[i11 + o], fx), fy);
  return [chan(0), chan(1), chan(2)];
}
