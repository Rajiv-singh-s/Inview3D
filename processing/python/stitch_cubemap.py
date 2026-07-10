#!/usr/bin/env python3
import argparse
import sys
import os
import glob
import cv2
import json

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def main():
    parser = argparse.ArgumentParser(description="Stitch 3 images into a single cubemap face")
    parser.add_argument('--input', required=True, help="Directory containing the 3 face images")
    parser.add_argument('--output', required=True, help="Output stitched face image path")
    parser.add_argument('--max-dim', type=int, default=1024, help="Max dimension to scale images before stitching")
    args = parser.parse_args()

    input_dir = args.input
    output_path = args.output
    max_dim = args.max_dim

    extensions = ('*.jpg', '*.jpeg', '*.png')
    image_files = []
    for ext in extensions:
        image_files.extend(glob.glob(os.path.join(input_dir, ext)))
        image_files.extend(glob.glob(os.path.join(input_dir, ext.upper())))
    
    image_files = sorted(image_files)

    if len(image_files) == 0:
        eprint(f"No images found in {input_dir}")
        sys.exit(1)

    eprint(f"Found {len(image_files)} images in {input_dir}")

    images = []
    for filepath in image_files:
        img = cv2.imread(filepath)
        if img is None:
            eprint(f"Failed to read image: {filepath}")
            sys.exit(1)

        # Scale down if too large
        h, w = img.shape[:2]
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        images.append(img)

    if len(images) == 1:
        # If there's only 1 image (shouldn't happen in our 3-shot pipeline, but just in case)
        cv2.imwrite(output_path, images[0])
        eprint("Only 1 image found, saved as output without stitching.")
        sys.exit(0)

    eprint(f"Stitching {len(images)} images...")
    
    # We use SCANS mode because we want a planar projection (rectilinear) for a cube face,
    # rather than a spherical projection which would curve straight lines.
    # Actually, SCANS assumes affine transforms. PANORAMA is more robust for rotation.
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    
    # Increase confidence thresholds to allow stitching even with fewer features
    stitcher.setPanoConfidenceThresh(0.6)

    status, stitched = stitcher.stitch(images)

    if status != cv2.Stitcher_OK:
        error_messages = {
            cv2.Stitcher_ERR_NEED_MORE_IMGS: "Need more images (not enough overlapping features).",
            cv2.Stitcher_ERR_HOMOGRAPHY_EST_FAIL: "Homography estimation failed (images don't align).",
            cv2.Stitcher_ERR_CAMERA_PARAMS_ADJUST_FAIL: "Camera parameters adjustment failed."
        }
        msg = error_messages.get(status, f"Unknown error code {status}")
        eprint(f"Stitching failed: {msg}")
        
        # Fallback: just return the center image if stitching fails so the pipeline doesn't crash completely
        if len(images) >= 2:
            eprint("Fallback: using the middle image instead of stitched result.")
            center_idx = len(images) // 2
            cv2.imwrite(output_path, images[center_idx])
            sys.exit(0)
        else:
            sys.exit(1)

    eprint(f"Stitching successful. Output shape: {stitched.shape}")

    # For a cubemap face, we generally want a square aspect ratio.
    # We can crop the stitched image to a square if desired, or let Three.js handle the aspect ratio.
    # A simple square crop from the center:
    h, w = stitched.shape[:2]
    size = min(h, w)
    start_y = (h - size) // 2
    start_x = (w - size) // 2
    square_stitched = stitched[start_y:start_y+size, start_x:start_x+size]

    cv2.imwrite(output_path, square_stitched)
    eprint(f"Saved stitched face to {output_path} with square crop.")
    sys.exit(0)

if __name__ == "__main__":
    main()
