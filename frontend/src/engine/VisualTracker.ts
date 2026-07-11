/**
 * VisualTracker.ts
 * Uses OpenCV.js for client-side ORB feature tracking and drift correction.
 */

import { loadOpenCV } from '@/lib/opencv-loader';

declare const cv: any;

export interface DriftCorrection {
  dyaw: number;
  dpitch: number;
}

export class VisualTracker {
  private orb: any = null;
  private matcher: any = null;
  
  // Reference frame data
  private refKeypoints: any = null;
  private refDescriptors: any = null;
  
  private isInitialized = false;
  private currentDrift: DriftCorrection = { dyaw: 0, dpitch: 0 };
  
  // Downscale dimensions for performance
  private readonly WIDTH = 320;
  private readonly HEIGHT = 240;

  constructor() {
    // Moved to init()
  }

  public async init(): Promise<void> {
    await loadOpenCV();
    this.orb = new cv.ORB(500);
    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, true);
  }

  /**
   * Processes a frame, extracting features and computing drift against the reference frame.
   * @param imageSource - The source frame to track (e.g. video element or canvas)
   * @returns Current cumulative drift correction
   */
  public processFrame(imageSource: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): DriftCorrection {
    const src = cv.imread(imageSource);
    const gray = new cv.Mat();
    const resized = new cv.Mat();
    
    // Downscale and convert to grayscale for faster tracking
    cv.resize(src, resized, new cv.Size(this.WIDTH, this.HEIGHT), 0, 0, cv.INTER_AREA);
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);

    const keypoints = new cv.KeyPointVector();
    const descriptors = new cv.Mat();
    
    this.orb.detectAndCompute(gray, new cv.Mat(), keypoints, descriptors);

    if (!this.isInitialized) {
      // Set the first frame as the reference
      this.refKeypoints = keypoints;
      this.refDescriptors = descriptors;
      this.isInitialized = true;
      
      // Memory cleanup for local Mats
      src.delete();
      gray.delete();
      resized.delete();
      return { dyaw: 0, dpitch: 0 };
    }

    // Match features against reference
    const matches = new cv.DMatchVector();
    this.matcher.match(descriptors, this.refDescriptors, matches);

    // Compute homography to estimate translation drift
    if (matches.size() >= 4) {
      const srcPtsArray = [];
      const dstPtsArray = [];
      
      for (let i = 0; i < matches.size(); i++) {
        const match = matches.get(i);
        const ptSrc = keypoints.get(match.queryIdx).pt;
        const ptRef = this.refKeypoints.get(match.trainIdx).pt;
        
        srcPtsArray.push(ptSrc.x, ptSrc.y);
        dstPtsArray.push(ptRef.x, ptRef.y);
      }
      
      const srcPts = cv.matFromArray(matches.size(), 1, cv.CV_32FC2, srcPtsArray);
      const dstPts = cv.matFromArray(matches.size(), 1, cv.CV_32FC2, dstPtsArray);
      
      const mask = new cv.Mat();
      const H = cv.findHomography(srcPts, dstPts, cv.RANSAC, 3.0, mask);
      
      if (!H.empty()) {
        // Extract translation from the 3x3 Homography Matrix (CV_64F)
        // H = [ h00, h01, h02=tx ]
        //     [ h10, h11, h12=ty ]
        //     [ h20, h21, h22 ]
        const tx = H.data64F[2];
        const ty = H.data64F[5];
        
        // Convert translation in pixels to angular drift
        // Assuming a standard mobile FOV of ~60 degrees horizontally
        const fovX = 60.0;
        const fovY = (60.0 * this.HEIGHT) / this.WIDTH;
        
        const degPerPixX = fovX / this.WIDTH;
        const degPerPixY = fovY / this.HEIGHT;
        
        this.currentDrift.dyaw = -tx * degPerPixX;
        this.currentDrift.dpitch = -ty * degPerPixY;
      }
      
      H.delete();
      mask.delete();
      srcPts.delete();
      dstPts.delete();
    }

    // CRITICAL: Prevent WASM memory leaks
    matches.delete();
    keypoints.delete();
    descriptors.delete();
    src.delete();
    gray.delete();
    resized.delete();

    return this.currentDrift;
  }

  /**
   * Clears the current reference frame.
   */
  public reset(): void {
    if (this.refKeypoints) {
      this.refKeypoints.delete();
      this.refKeypoints = null;
    }
    if (this.refDescriptors) {
      this.refDescriptors.delete();
      this.refDescriptors = null;
    }
    this.isInitialized = false;
    this.currentDrift = { dyaw: 0, dpitch: 0 };
  }

  /**
   * Frees all OpenCV resources associated with this tracker.
   */
  public destroy(): void {
    this.reset();
    if (this.orb) {
      this.orb.delete();
      this.orb = null;
    }
    if (this.matcher) {
      this.matcher.delete();
      this.matcher = null;
    }
  }
}
