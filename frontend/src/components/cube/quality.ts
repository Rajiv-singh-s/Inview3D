/**
 * Variance of the Laplacian — the standard focus/blur metric. A sharp frame has
 * strong second derivatives; motion blur or defocus smooths them out and the
 * variance collapses. Measured on a small grayscale copy so it can run on every
 * candidate frame cheaply.
 */
export function sharpness(source: CanvasImageSource, width: number, height: number): number {
  const W = 160;
  const H = Math.max(1, Math.round((height / width) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Number.POSITIVE_INFINITY; // cannot measure — don't block capture
  ctx.drawImage(source, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
