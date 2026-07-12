#!/usr/bin/env python3
"""Stitch photos captured while rotating in place into a 360 equirectangular panorama.

Classical computer vision only (OpenCV): SIFT features, pairwise matching,
rotation-only camera estimation, ray bundle adjustment, wave correction,
spherical warp, exposure compensation, seam finding, multi-band blending.

Key correctness points, all verified:
  * Equirectangular canvas origin is (−W/2, 0): OpenCV's spherical projector maps
    v to [0, pi*scale], so centring the canvas vertically clips most tiles.
  * Degenerate cameras (focal ~0) are dropped — they warp to garbage and smear.
  * Exposure compensation + seam finding are applied, so overlaps are cut along
    an optimal seam instead of averaged (which causes ghosting/doubling).

Writes <output> (JPEG) and <output>.json sidecar with the dimensions.

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
    sys.stderr.write("Missing dependency: {}. pip install opencv-python-headless numpy\n".format(exc))
    sys.exit(2)

IMAGE_EXTS = ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG")

OVERLAP_HINT = (
    "Consecutive photos need enough overlap to match. Rotate in smaller steps, "
    "pivot on the spot rather than walking, and keep textured surfaces in frame."
)


def load_images(input_dir, max_dim):
    paths = []
    for ext in IMAGE_EXTS:
        paths.extend(glob.glob(os.path.join(input_dir, ext)))
    paths = sorted(set(paths))
    images = []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            continue
        h, w = img.shape[:2]
        s = max_dim / float(max(h, w))
        if s < 1.0:
            img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        images.append(img)
    if len(images) < 2:
        raise ValueError("Need at least 2 readable photos, got {}".format(len(images)))
    return images


def estimate_cameras(images):
    """Recover each photo's rotation and focal length about a common centre."""
    finder = cv2.SIFT_create()
    features = []
    kept = []
    for img in images:
        feat = cv2.detail.computeImageFeatures2(finder, img)
        if len(feat.getKeypoints()) >= 10:
            features.append(feat)
            kept.append(img)
    if len(kept) < 2:
        raise RuntimeError("Not enough textured photos to stitch. " + OVERLAP_HINT)
    images = kept

    matcher = cv2.detail_BestOf2NearestMatcher(False, 0.3)
    matches = matcher.apply2(features)
    matcher.collectGarbage()

    idx = cv2.detail.leaveBiggestComponent(features, matches, 0.3)
    keep = [int(i) for i in idx.flatten()] if idx is not None else list(range(len(images)))
    if len(keep) < 2:
        raise RuntimeError("Photos do not overlap enough to form a panorama. " + OVERLAP_HINT)
    if len(keep) < len(images):
        images = [images[i] for i in keep]
        features = [cv2.detail.computeImageFeatures2(finder, im) for im in images]
        matches = matcher.apply2(features)
        matcher.collectGarbage()

    ok, cameras = cv2.detail_HomographyBasedEstimator().apply(features, matches, None)
    if not ok:
        raise RuntimeError("Could not estimate camera rotations. " + OVERLAP_HINT)
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)

    adjuster = cv2.detail_BundleAdjusterRay()
    adjuster.setConfThresh(1.0)
    adjuster.setRefinementMask(np.ones((3, 3), np.uint8))
    ok, refined = adjuster.apply(features, matches, cameras)
    if ok:
        cameras = refined

    rmats = [np.copy(c.R) for c in cameras]
    rmats = cv2.detail.waveCorrect(rmats, cv2.detail.WAVE_CORRECT_HORIZ)
    for c, R in zip(cameras, rmats):
        c.R = R

    # Drop degenerate cameras: a zero/inf focal has a singular K and warps to
    # garbage that smears across the sphere.
    pairs = [(im, c) for im, c in zip(images, cameras) if np.isfinite(c.focal) and c.focal > 1.0]
    if len(pairs) < 2:
        raise RuntimeError("Camera estimation produced no usable views. " + OVERLAP_HINT)
    return [p[0] for p in pairs], [p[1] for p in pairs]


def equirect_scale(cameras, max_width):
    focals = sorted(c.focal for c in cameras)
    n = len(focals)
    median = focals[n // 2] if n % 2 else (focals[n // 2 - 1] + focals[n // 2]) / 2.0
    scale = float(median)
    if 2.0 * math.pi * scale > max_width:
        scale = max_width / (2.0 * math.pi)
    return scale


def _clip_to_roi(img, mask, corner, roi):
    rx, ry, rw, rh = roi
    x, y = corner
    h, w = img.shape[:2]
    x0, y0 = max(x, rx), max(y, ry)
    x1, y1 = min(x + w, rx + rw), min(y + h, ry + rh)
    if x1 <= x0 or y1 <= y0:
        return None, None, None
    sx, sy = x0 - x, y0 - y
    return (
        img[sy : sy + (y1 - y0), sx : sx + (x1 - x0)],
        mask[sy : sy + (y1 - y0), sx : sx + (x1 - x0)],
        (x0, y0),
    )


def stitch_equirect(images, cameras, scale):
    """Warp, exposure-compensate, seam-find and multi-band blend into a 2:1 canvas."""
    height = int(round(math.pi * scale))
    width = height * 2
    # Origin y = 0 (not -H/2): OpenCV's spherical v is [0, pi*scale].
    roi = (-width // 2, 0, width, height)

    warper = cv2.PyRotationWarper("spherical", scale)
    corners, wimgs, wmasks = [], [], []
    for img, cam in zip(images, cameras):
        K = cam.K().astype(np.float32)
        corner, wi = warper.warp(img, K, cam.R, cv2.INTER_LINEAR, cv2.BORDER_REFLECT)
        m = np.full(img.shape[:2], 255, np.uint8)
        _, wm = warper.warp(m, K, cam.R, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)
        corners.append(corner)
        wimgs.append(wi)
        wmasks.append(wm)

    # Exposure compensation so photos shot at different auto-exposure match up.
    try:
        comp = cv2.detail_BlocksGainCompensator()
        comp.feed(corners, wimgs, wmasks)
        for i in range(len(wimgs)):
            comp.apply(i, corners[i], wimgs[i], wmasks[i])
    except Exception as exc:  # non-fatal; blending still works, just less even
        sys.stderr.write("Exposure compensation skipped: {}\n".format(exc))

    # Seam finding so each output pixel comes from one photo (no ghosting).
    seam_masks = wmasks
    try:
        sf = cv2.detail_DpSeamFinder("COLOR")
        found = sf.find([wi.astype(np.float32) for wi in wimgs], corners, wmasks)
        seam_masks = []
        for m in found:
            arr = m.get() if isinstance(m, cv2.UMat) else np.asarray(m)
            seam_masks.append(cv2.dilate(arr, np.ones((3, 3), np.uint8)))
    except Exception as exc:
        sys.stderr.write("Seam finding skipped: {}\n".format(exc))

    blender = cv2.detail_MultiBandBlender()
    blender.prepare(roi)
    fed = 0
    for wi, mk, corner in zip(wimgs, seam_masks, corners):
        ci, cm, cc = _clip_to_roi(wi, mk, corner, roi)
        if ci is None:
            continue
        blender.feed(ci.astype(np.int16), cm, cc)
        fed += 1
    if fed == 0:
        raise RuntimeError("No photo could be placed on the sphere. " + OVERLAP_HINT)

    pano, _ = blender.blend(None, None)
    pano = cv2.convertScaleAbs(pano)
    if pano.shape[1] != width or pano.shape[0] != height:
        pano = cv2.resize(pano, (width, height), interpolation=cv2.INTER_AREA)
    return pano


def main():
    ap = argparse.ArgumentParser(description="Stitch photos into an equirectangular panorama")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--max-dim", type=int, default=1600)
    ap.add_argument("--max-width", type=int, default=8192)
    args = ap.parse_args()
    try:
        images = load_images(args.input, args.max_dim)
        sys.stdout.write("Stitching {} photos...\n".format(len(images)))
        images, cameras = estimate_cameras(images)
        scale = equirect_scale(cameras, args.max_width)
        pano = stitch_equirect(images, cameras, scale)

        out_dir = os.path.dirname(os.path.abspath(args.output))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        if not cv2.imwrite(args.output, pano, [int(cv2.IMWRITE_JPEG_QUALITY), 90]):
            raise RuntimeError("Failed to write panorama")
        h, w = pano.shape[:2]
        with open(os.path.splitext(args.output)[0] + ".json", "w") as fh:
            json.dump({"width": w, "height": h, "photos": len(images)}, fh)
        sys.stdout.write("Wrote equirectangular panorama {}x{}\n".format(w, h))
    except Exception as exc:
        sys.stderr.write("Panorama stitching failed: {}\n".format(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
