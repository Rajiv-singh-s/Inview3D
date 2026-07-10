#!/usr/bin/env python3
"""Stitch overlapping photos into a true equirectangular photosphere.

Classical computer vision only — no AI, no depth estimation:

    SIFT features -> pairwise matching -> homography-based rotation estimate
    -> ray bundle adjustment -> wave correction -> spherical warp
    -> multi-band blending

Why not `cv2.Stitcher`? Its output is an arbitrary spherical-warped canvas
cropped to the covered region. Mapping that onto a sphere stretches the image,
because the renderer assumes a full 360x180 equirectangular projection. Here we
warp every photo into one canonical canvas spanning theta in [-pi, pi] and phi
in [-pi/2, pi/2], which is exactly a 2:1 equirectangular image.

Writes `<output>` (JPEG) and `<output>.json` sidecar with the dimensions.

Usage:
    python stitch_panorama.py --input <dir-of-photos> --output panorama.jpg
"""
import argparse
import glob
import json
import math
import os
import sys

try:
    import cv2
    import numpy as np
except ImportError as exc:  # pragma: no cover
    sys.stderr.write(
        "Missing Python dependency: {}. Install with:\n"
        "    pip install -r processing/python/requirements.txt\n".format(exc)
    )
    sys.exit(2)

IMAGE_EXTS = ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG")


# Typical phone rear-camera horizontal field of view. Used only by the
# pose-based fallback, where no focal length can be estimated from features.
DEFAULT_HFOV_DEG = 65.0

OVERLAP_HINT = (
    "Consecutive photos need enough overlap to match. Rotate in smaller steps, "
    "pivot on the spot rather than walking, and keep textured surfaces in frame "
    "(blank walls cannot be matched)."
)


def load_images(input_dir, max_dim):
    """Returns (images, names) in capture order — names key the pose lookup."""
    paths = []
    for ext in IMAGE_EXTS:
        paths.extend(glob.glob(os.path.join(input_dir, ext)))
    paths = sorted(set(paths))

    images, names = [], []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            sys.stderr.write("Skipping unreadable image: {}\n".format(p))
            continue
        h, w = img.shape[:2]
        scale = max_dim / float(max(h, w))
        if scale < 1.0:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        images.append(img)
        names.append(os.path.basename(p))

    if len(images) < 2:
        raise ValueError("Need at least 2 readable photos, got {}".format(len(images)))
    return images, names


def load_poses(path):
    """Maps photo filename -> (yaw, pitch) in degrees, as recorded by the device."""
    if not path:
        return {}
    with open(path) as fh:
        entries = json.load(fh)
    return {e["file"]: (float(e["yaw"]), float(e["pitch"])) for e in entries}


def rotation_from_pose(yaw_deg, pitch_deg):
    """Camera rotation for a device yawed then pitched about a fixed centre."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    Ry = np.array(
        [[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]], np.float32
    )
    Rx = np.array(
        [[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]], np.float32
    )
    # World -> camera, so transpose the camera's orientation.
    return (Ry @ Rx).T.astype(np.float32)


def cameras_from_poses(images, names, poses, hfov_deg=DEFAULT_HFOV_DEG):
    """
    Build camera parameters straight from the device orientation.

    Used when feature-based estimation cannot recover the rotations. The phone
    genuinely knows where it was pointing, so this yields a correctly arranged
    (if slightly less precise) sphere instead of no panorama at all.
    """
    kept_images, cameras = [], []
    for img, name in zip(images, names):
        if name not in poses:
            continue
        h, w = img.shape[:2]
        focal = (w / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)
        cam = cv2.detail_CameraParams()
        cam.focal = float(focal)
        cam.aspect = 1.0
        cam.ppx = w / 2.0
        cam.ppy = h / 2.0
        cam.t = np.zeros((3, 1), np.float32)
        yaw, pitch = poses[name]
        cam.R = rotation_from_pose(yaw, pitch)
        kept_images.append(img)
        cameras.append(cam)

    if len(cameras) < 2:
        raise RuntimeError(
            "Feature matching failed and no usable device poses were recorded. " + OVERLAP_HINT
        )
    sys.stderr.write("Falling back to device poses for {} photos.\n".format(len(cameras)))
    return kept_images, cameras


def estimate_cameras(images):
    """Recover each photo's rotation and focal length about a common centre."""
    finder = cv2.SIFT_create()
    
    # Compute features and only keep images with enough features for the matcher
    valid_images = []
    features = []
    for img in images:
        feat = cv2.detail.computeImageFeatures2(finder, img)
        if len(feat.getKeypoints()) >= 10:
            valid_images.append(img)
            features.append(feat)
        else:
            sys.stderr.write("Warning: dropping image with too few features.\n")
            
    if len(valid_images) < 2:
        raise RuntimeError("Not enough textured photos to stitch (need at least 2). " + OVERLAP_HINT)
        
    images = valid_images

    matcher = cv2.detail_BestOf2NearestMatcher(False, 0.3)
    matches = matcher.apply2(features)
    matcher.collectGarbage()

    # Drop photos that do not connect to the main panorama.
    indices = cv2.detail.leaveBiggestComponent(features, matches, 0.3)
    kept = [int(i) for i in indices.flatten()] if indices is not None else list(range(len(images)))
    if len(kept) < 2:
        raise RuntimeError("Photos do not overlap enough to form a panorama. " + OVERLAP_HINT)
    if len(kept) < len(images):
        sys.stderr.write(
            "Warning: {} of {} photos could not be matched and were dropped.\n".format(
                len(images) - len(kept), len(images)
            )
        )
        images = [images[i] for i in kept]
        features = [cv2.detail.computeImageFeatures2(finder, img) for img in images]
        matches = matcher.apply2(features)
        matcher.collectGarbage()

    estimator = cv2.detail_HomographyBasedEstimator()
    ok, cameras = estimator.apply(features, matches, None)
    if not ok:
        raise RuntimeError("Could not estimate camera rotations. " + OVERLAP_HINT)
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)

    # Ray adjuster is ideal for pure-rotation panoramas, but can fail on
    # weak/ambiguous scenes. Fall back instead of aborting the whole capture.
    refined = None

    ray = cv2.detail_BundleAdjusterRay()
    ray.setConfThresh(1.0)
    ray.setRefinementMask(np.ones((3, 3), np.uint8))
    ok, ray_cameras = ray.apply(features, matches, cameras)
    if ok:
        refined = ray_cameras
    else:
        sys.stderr.write("Warning: ray bundle adjustment failed; trying reprojection adjuster.\n")
        reproj = cv2.detail_BundleAdjusterReproj()
        reproj.setConfThresh(0.8)
        reproj.setRefinementMask(np.ones((3, 3), np.uint8))
        ok, reproj_cameras = reproj.apply(features, matches, cameras)
        if ok:
            refined = reproj_cameras
        else:
            sys.stderr.write(
                "Warning: camera refinement failed; continuing with initial camera estimates.\n"
            )

    if refined is not None:
        cameras = refined

    # Remove accumulated roll so the horizon stays level.
    rmats = [np.copy(cam.R) for cam in cameras]
    rmats = cv2.detail.waveCorrect(rmats, cv2.detail.WAVE_CORRECT_HORIZ)
    for cam, R in zip(cameras, rmats):
        cam.R = R

    return images, cameras


def equirect_scale(cameras, max_width):
    """Pixels per radian. Derived from the median focal so detail is preserved."""
    focals = sorted(cam.focal for cam in cameras)
    n = len(focals)
    median = focals[n // 2] if n % 2 == 1 else (focals[n // 2 - 1] + focals[n // 2]) / 2.0
    # Full width is 2*pi*scale; clamp so huge focals do not blow up memory.
    scale = float(median)
    if 2.0 * math.pi * scale > max_width:
        scale = max_width / (2.0 * math.pi)
    return scale


def stitch_equirect(images, cameras, scale):
    """Warp every photo into one canonical 2:1 equirectangular canvas."""
    height = int(round(math.pi * scale))
    width = height * 2  # exact 2:1; the renderer relies on this
    # OpenCV's spherical projector maps
    #     u = scale * atan2(x, z)                  -> centred, [-pi*scale, +pi*scale]
    #     v = scale * (pi - acos(y / |p|))         -> top-origin, [0, pi*scale]
    # so the canvas starts at y = 0, not -height/2. Centring it vertically
    # offsets every warped tile by half the image and clips most of them away.
    dst_roi = (-width // 2, 0, width, height)

    warper = cv2.PyRotationWarper("spherical", scale)
    blender = cv2.detail_MultiBandBlender()
    blender.prepare(dst_roi)

    fed = 0
    for img, cam in zip(images, cameras):
        K = cam.K().astype(np.float32)
        corner, warped = warper.warp(img, K, cam.R, cv2.INTER_LINEAR, cv2.BORDER_REFLECT)
        mask = np.full(img.shape[:2], 255, np.uint8)
        _, warped_mask = warper.warp(mask, K, cam.R, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)

        # Skip anything the canvas cannot hold (a photo wrapping past +/-pi).
        x, y = corner
        wh, ww = warped.shape[:2]
        if x < dst_roi[0] or y < dst_roi[1] or x + ww > dst_roi[0] + width or y + wh > dst_roi[1] + height:
            warped, warped_mask, corner = _clip_to_roi(warped, warped_mask, corner, dst_roi)
            if warped is None:
                continue

        blender.feed(warped.astype(np.int16), warped_mask, corner)
        fed += 1

    if fed == 0:
        raise RuntimeError("No photo could be placed on the sphere. " + OVERLAP_HINT)

    pano, _ = blender.blend(None, None)
    pano = cv2.convertScaleAbs(pano)
    # Blender may return a slightly different size; force the exact 2:1 canvas.
    if pano.shape[1] != width or pano.shape[0] != height:
        pano = cv2.resize(pano, (width, height), interpolation=cv2.INTER_AREA)
    return pano


def _clip_to_roi(img, mask, corner, roi):
    """Crop a warped tile to the canvas, returning (img, mask, corner) or Nones."""
    rx, ry, rw, rh = roi
    x, y = corner
    h, w = img.shape[:2]
    x0, y0 = max(x, rx), max(y, ry)
    x1, y1 = min(x + w, rx + rw), min(y + h, ry + rh)
    if x1 <= x0 or y1 <= y0:
        return None, None, None
    sx, sy = x0 - x, y0 - y
    return img[sy : sy + (y1 - y0), sx : sx + (x1 - x0)], mask[
        sy : sy + (y1 - y0), sx : sx + (x1 - x0)
    ], (x0, y0)


def main():
    parser = argparse.ArgumentParser(description="Stitch photos into an equirectangular photosphere")
    parser.add_argument("--input", required=True, help="Directory containing the source photos")
    parser.add_argument("--output", required=True, help="Path to write the panorama JPEG")
    parser.add_argument("--max-dim", type=int, default=1600, help="Downscale each source photo to this longest side")
    parser.add_argument("--max-width", type=int, default=8192, help="Maximum equirectangular width")
    parser.add_argument("--poses", help="JSON of device orientations recorded per photo")
    args = parser.parse_args()

    try:
        images, names = load_images(args.input, args.max_dim)
        poses = load_poses(args.poses)
        sys.stdout.write(
            "Stitching {} photos ({} device poses)...\n".format(len(images), len(poses))
        )

        try:
            images, cameras = estimate_cameras(images)
        except Exception as exc:
            if not poses:
                raise
            sys.stderr.write("Feature-based estimation failed ({}).\n".format(exc))
            images, cameras = cameras_from_poses(images, names, poses)

        scale = equirect_scale(cameras, args.max_width)
        pano = stitch_equirect(images, cameras, scale)

        out_dir = os.path.dirname(os.path.abspath(args.output))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        if not cv2.imwrite(args.output, pano, [int(cv2.IMWRITE_JPEG_QUALITY), 90]):
            raise RuntimeError("Failed to write panorama to {}".format(args.output))

        h, w = pano.shape[:2]
        sidecar = os.path.splitext(args.output)[0] + ".json"
        with open(sidecar, "w") as fh:
            json.dump({"width": w, "height": h, "photos": len(images), "equirectangular": True}, fh)

        sys.stdout.write("Wrote equirectangular panorama: {} ({}x{})\n".format(args.output, w, h))
    except Exception as exc:
        sys.stderr.write("Panorama stitching failed: {}\n".format(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
