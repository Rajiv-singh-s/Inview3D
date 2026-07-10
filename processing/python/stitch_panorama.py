#!/usr/bin/env python3
"""Stitch a set of overlapping photos into a 360 panorama (photosphere).

Classical computer vision only: OpenCV's feature-based stitching pipeline
(SIFT/ORB features -> pairwise matching -> bundle adjustment -> spherical
warping -> multi-band blending). No AI, no depth estimation.

The output is a spherical-warped panorama suitable for texturing an inverted
sphere in three.js. When the captured photos cover a full horizontal rotation,
the result approximates an equirectangular image.

Usage:
    python stitch_panorama.py --input <dir-of-images> --output panorama.jpg
"""
import argparse
import glob
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

# OpenCV's Stitcher status codes -> actionable messages.
STATUS_MESSAGES = {
    1: (
        "Not enough overlapping features between photos. Capture with more "
        "overlap (rotate in smaller steps) and avoid blank walls."
    ),
    2: (
        "Could not estimate camera parameters. Rotate in place around a fixed "
        "point rather than walking between shots."
    ),
    3: (
        "Camera parameter adjustment failed. Try recapturing with steadier, "
        "evenly spaced rotation."
    ),
}


def load_images(input_dir: str, max_dim: int) -> "list[np.ndarray]":
    paths: "list[str]" = []
    for ext in IMAGE_EXTS:
        paths.extend(glob.glob(os.path.join(input_dir, ext)))
    paths = sorted(set(paths))
    if len(paths) < 2:
        raise ValueError("Need at least 2 images to stitch, found {}".format(len(paths)))

    images = []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            sys.stderr.write("Skipping unreadable image: {}\n".format(p))
            continue
        # Downscale very large photos: stitching cost grows fast with resolution,
        # and feature matching does not benefit beyond a few megapixels.
        h, w = img.shape[:2]
        scale = max_dim / float(max(h, w))
        if scale < 1.0:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        images.append(img)

    if len(images) < 2:
        raise ValueError("Need at least 2 readable images, got {}".format(len(images)))
    return images


def stitch(images: "list[np.ndarray]") -> "np.ndarray":
    """Run OpenCV's panorama stitcher in SCANS-free, spherical mode."""
    # PANORAMA mode assumes pure rotation about the camera centre, which is
    # exactly the guided capture motion, and warps onto a sphere.
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    status, pano = stitcher.stitch(images)
    if status != cv2.Stitcher_OK:
        raise RuntimeError(
            STATUS_MESSAGES.get(status, "Stitching failed (OpenCV status {})".format(status))
        )
    return pano


def main() -> int:
    parser = argparse.ArgumentParser(description="Stitch photos into a panorama")
    parser.add_argument("--input", required=True, help="Directory containing the source photos")
    parser.add_argument("--output", required=True, help="Path to write the panorama JPEG")
    parser.add_argument(
        "--max-dim",
        type=int,
        default=1600,
        help="Downscale each source photo so its longest side is at most this many pixels",
    )
    args = parser.parse_args()

    try:
        images = load_images(args.input, args.max_dim)
        sys.stdout.write("Stitching {} images...\n".format(len(images)))
        pano = stitch(images)

        out_dir = os.path.dirname(os.path.abspath(args.output))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        if not cv2.imwrite(args.output, pano, [int(cv2.IMWRITE_JPEG_QUALITY), 92]):
            raise RuntimeError("Failed to write panorama to {}".format(args.output))

        h, w = pano.shape[:2]
        sys.stdout.write(
            "Wrote panorama: {} ({}x{}, aspect {:.2f})\n".format(args.output, w, h, w / float(h))
        )
    except Exception as exc:
        sys.stderr.write("Panorama stitching failed: {}\n".format(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
