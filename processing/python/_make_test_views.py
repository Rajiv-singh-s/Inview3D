#!/usr/bin/env python3
"""Dev-only: render perspective views from an equirectangular image.

Simulates a phone rotating in place, which is exactly the capture motion the
stitcher assumes. Feeding these views back through `stitch_panorama.py` should
recover a 2:1 equirectangular image — a round-trip test of the whole rotation
estimation + spherical warp path.

Not part of the runtime pipeline.
"""
import argparse
import math
import os

import cv2
import numpy as np


def rot(yaw_deg, pitch_deg):
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    return Ry @ Rx


def render(equirect, yaw, pitch, out_w, out_h, fov_deg):
    H, W = equirect.shape[:2]
    focal = (out_w / 2.0) / math.tan(math.radians(fov_deg) / 2.0)

    xs, ys = np.meshgrid(np.arange(out_w), np.arange(out_h))
    dirs = np.stack([xs - out_w / 2.0, ys - out_h / 2.0, np.full_like(xs, focal, dtype=float)], -1)
    dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)

    world = dirs @ rot(yaw, pitch).T
    theta = np.arctan2(world[..., 0], world[..., 2])
    phi = np.arcsin(np.clip(world[..., 1], -1, 1))

    u = ((theta / (2 * math.pi)) + 0.5) * W
    v = (0.5 - (phi / math.pi)) * H
    return cv2.remap(
        equirect, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="Any image, treated as an equirectangular env")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--fov", type=float, default=75.0)
    args = ap.parse_args()

    src = cv2.imread(args.source)
    if src is None:
        raise SystemExit("cannot read " + args.source)
    src = cv2.resize(src, (2048, 1024), interpolation=cv2.INTER_AREA)

    os.makedirs(args.outdir, exist_ok=True)
    views = []
    for pitch, count in ((45, 4), (0, 8), (-45, 4)):
        for i in range(count):
            views.append((360.0 / count * i, pitch))

    for i, (yaw, pitch) in enumerate(views):
        img = render(src, yaw, pitch, 640, 480, args.fov)
        cv2.imwrite(os.path.join(args.outdir, "v_%03d.jpg" % i), img)
    print("rendered %d views" % len(views))


if __name__ == "__main__":
    main()
