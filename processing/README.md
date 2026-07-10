# processing/

Native photogrammetry toolchain glue. The NestJS backend invokes these tools
directly for fine-grained progress, but the standalone assets here let you run
and debug a project's workspace by hand.

## Contents

- **`scripts/run_pipeline.sh`** — full COLMAP + OpenMVS + GLB reference pipeline.
  ```bash
  ./scripts/run_pipeline.sh ../uploads/<project-id>
  ```
  Expects `<workspace>/frames/` to already contain extracted JPGs.

- **`python/convert_to_glb.py`** — converts the OpenMVS textured OBJ into an
  embedded-texture GLB (Y-up for three.js).
  ```bash
  python3 python/convert_to_glb.py --input textured.obj --output model.glb
  ```

- **`python/requirements.txt`** — Python deps (`trimesh`, `numpy`, `pillow`).

## Required tools

| Tool     | Binaries used                                                        |
| -------- | -------------------------------------------------------------------- |
| FFmpeg   | `ffmpeg`, `ffprobe`                                                   |
| COLMAP   | `feature_extractor`, `exhaustive_matcher`, `mapper`, `image_undistorter` |
| OpenMVS  | `InterfaceCOLMAP`, `DensifyPointCloud`, `ReconstructMesh`, `TextureMesh` |
| Python   | `trimesh` (GLB export)                                                |
| Optional | `gltfpack` (GLB optimization)                                        |

Override binary locations with `COLMAP_BIN`, `OPENMVS_BIN_DIR`, `FFMPEG_BIN`,
`FFPROBE_BIN` (see `.env.example`). All of these are pre-installed in the
backend Docker image.
