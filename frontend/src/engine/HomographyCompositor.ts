/**
 * HomographyCompositor.ts
 * Uses OpenCV.js to align and stitch incoming frames onto an output canvas via alpha-blended homography.
 */

declare const cv: any;

export class HomographyCompositor {
  private orb: any;
  private matcher: any;
  
  private outputCanvas: HTMLCanvasElement;
  private outputCtx: CanvasRenderingContext2D;
  
  private isFirstFrame = true;

  /**
   * @param width - The width of the compositing canvas
   * @param height - The height of the compositing canvas
   */
  constructor(width: number, height: number) {
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;
    
    const ctx = this.outputCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get 2d context for compositor');
    this.outputCtx = ctx;

    this.orb = new cv.ORB(1000); // Higher feature count for robust stitching
    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, true);
  }

  /**
   * Matches features between the new frame and the existing composition, 
   * computes a homography matrix, warps it, and applies a soft blend.
   * @param frame - The incoming image or video frame
   */
  public stitchFrame(frame: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): void {
    const srcMat = cv.imread(frame);

    if (this.isFirstFrame) {
      cv.imshow(this.outputCanvas, srcMat);
      this.isFirstFrame = false;
      srcMat.delete();
      return;
    }

    const currentOutputMat = cv.imread(this.outputCanvas);
    const srcGray = new cv.Mat();
    const dstGray = new cv.Mat();
    
    cv.cvtColor(srcMat, srcGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(currentOutputMat, dstGray, cv.COLOR_RGBA2GRAY);

    const kpSrc = new cv.KeyPointVector();
    const desSrc = new cv.Mat();
    const kpDst = new cv.KeyPointVector();
    const desDst = new cv.Mat();

    this.orb.detectAndCompute(srcGray, new cv.Mat(), kpSrc, desSrc);
    this.orb.detectAndCompute(dstGray, new cv.Mat(), kpDst, desDst);

    const matches = new cv.DMatchVector();
    this.matcher.match(desSrc, desDst, matches);

    if (matches.size() >= 4) {
      const srcPtsArray = [];
      const dstPtsArray = [];

      for (let i = 0; i < matches.size(); i++) {
        const match = matches.get(i);
        const ptSrc = kpSrc.get(match.queryIdx).pt;
        const ptDst = kpDst.get(match.trainIdx).pt;
        srcPtsArray.push(ptSrc.x, ptSrc.y);
        dstPtsArray.push(ptDst.x, ptDst.y);
      }

      const srcPts = cv.matFromArray(matches.size(), 1, cv.CV_32FC2, srcPtsArray);
      const dstPts = cv.matFromArray(matches.size(), 1, cv.CV_32FC2, dstPtsArray);

      const mask = new cv.Mat();
      const H = cv.findHomography(srcPts, dstPts, cv.RANSAC, 5.0, mask);

      if (!H.empty()) {
        const warpedSrc = new cv.Mat();
        const dsize = new cv.Size(this.outputCanvas.width, this.outputCanvas.height);
        
        cv.warpPerspective(srcMat, warpedSrc, H, dsize, cv.INTER_LINEAR, cv.BORDER_TRANSPARENT, new cv.Scalar(0, 0, 0, 0));

        // Create a radial gradient mask for alpha blending
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = this.outputCanvas.width;
        maskCanvas.height = this.outputCanvas.height;
        const mCtx = maskCanvas.getContext('2d')!;
        
        const cx = maskCanvas.width / 2;
        const cy = maskCanvas.height / 2;
        const radius = Math.min(cx, cy);
        
        const gradient = mCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        
        mCtx.fillStyle = gradient;
        mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        const warpedCanvas = document.createElement('canvas');
        warpedCanvas.width = this.outputCanvas.width;
        warpedCanvas.height = this.outputCanvas.height;
        cv.imshow(warpedCanvas, warpedSrc);
        
        // Apply the soft feathering mask to the warped frame
        const wCtx = warpedCanvas.getContext('2d')!;
        wCtx.globalCompositeOperation = 'destination-in';
        wCtx.drawImage(maskCanvas, 0, 0);
        
        // Blend into the final output
        this.outputCtx.save();
        this.outputCtx.globalCompositeOperation = 'source-over';
        this.outputCtx.drawImage(warpedCanvas, 0, 0);
        this.outputCtx.restore();

        warpedSrc.delete();
      }

      H.delete();
      mask.delete();
      srcPts.delete();
      dstPts.delete();
    }

    // Clean up WASM memory
    kpSrc.delete();
    desSrc.delete();
    kpDst.delete();
    desDst.delete();
    srcGray.delete();
    dstGray.delete();
    srcMat.delete();
    currentOutputMat.delete();
    matches.delete();
  }

  /**
   * Returns the final alpha-blended and stitched output canvas.
   */
  public getOutputCanvas(): HTMLCanvasElement {
    return this.outputCanvas;
  }

  /**
   * Frees underlying OpenCV resources.
   */
  public destroy(): void {
    if (this.orb) this.orb.delete();
    if (this.matcher) this.matcher.delete();
  }
}
