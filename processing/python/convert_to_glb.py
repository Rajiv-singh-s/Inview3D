#!/usr/bin/env python3
"""Convert a textured mesh into a single GLB file.

Used by the backend's `generate-glb` pipeline step. Loads the OpenMVS textured
mesh via trimesh — a PLY whose `comment TextureFile <name>.png` header points at
the atlas alongside it (OBJ also works) — applies a coordinate-system fix so the
model is Y-up for three.js, and writes a binary glTF (.glb) with the texture
embedded.

Usage:
    python convert_to_glb.py --input model_textured.ply --output model.glb
"""
import argparse
import os
import sys

try:
    import numpy as np
    import trimesh
except ImportError as exc:  # pragma: no cover
    sys.stderr.write(
        "Missing Python dependency: {}. Install with:\n"
        "    pip install -r processing/python/requirements.txt\n".format(exc)
    )
    sys.exit(2)


def convert(input_path: str, output_path: str) -> None:
    if not os.path.isfile(input_path):
        raise FileNotFoundError("Input mesh not found: {}".format(input_path))

    # `process=False` keeps texture/UV data intact; force a Scene for GLB export.
    loaded = trimesh.load(input_path, process=False, force="scene")

    if isinstance(loaded, trimesh.Scene):
        scene = loaded
    else:
        scene = trimesh.Scene(loaded)

    if len(scene.geometry) == 0:
        raise ValueError("Loaded mesh contains no geometry")

    # OpenMVS meshes are typically Z-up; three.js expects Y-up. Rotate -90° X.
    rotation = trimesh.transformations.rotation_matrix(-np.pi / 2.0, [1, 0, 0])
    scene.apply_transform(rotation)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    glb_bytes = trimesh.exchange.gltf.export_glb(scene)
    with open(output_path, "wb") as fh:
        fh.write(glb_bytes)

    size = os.path.getsize(output_path)
    print("Wrote GLB: {} ({} bytes)".format(output_path, size))


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a textured mesh to GLB")
    parser.add_argument("--input", required=True, help="Path to the textured mesh (.ply/.obj)")
    parser.add_argument("--output", required=True, help="Path to write the .glb")
    args = parser.parse_args()
    try:
        convert(args.input, args.output)
    except Exception as exc:  # surface a clean message to the pipeline log
        sys.stderr.write("GLB conversion failed: {}\n".format(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
