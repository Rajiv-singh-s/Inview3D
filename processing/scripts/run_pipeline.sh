#!/usr/bin/env bash
# ===========================================================================
# InView3D — Standalone reference pipeline (COLMAP + OpenMVS)
#
# The NestJS backend runs each stage individually for fine-grained progress,
# but this script documents and reproduces the exact command sequence. Handy
# for debugging a project's workspace by hand.
#
# Usage:
#   ./run_pipeline.sh <PROJECT_WORKSPACE_DIR>
#
# Expects <workspace>/frames to already contain extracted JPGs.
# Produces <workspace>/textures/model_textured.obj and, via the Python helper,
# <workspace>/glb/model.glb.
# ===========================================================================
set -euo pipefail

WS="${1:?Usage: run_pipeline.sh <workspace_dir>}"
THREADS="${PROCESSING_THREADS:-$(nproc 2>/dev/null || echo 4)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COLMAP="${COLMAP_BIN:-colmap}"
OPENMVS_DIR="${OPENMVS_BIN_DIR:-}"
mvs() { if [ -n "$OPENMVS_DIR" ]; then echo "$OPENMVS_DIR/$1"; else echo "$1"; fi; }

FRAMES="$WS/frames"
COLMAP_DIR="$WS/colmap"
DENSE="$WS/dense"
MESH="$WS/mesh"
TEXTURES="$WS/textures"
GLB="$WS/glb"
mkdir -p "$COLMAP_DIR" "$DENSE" "$MESH" "$TEXTURES" "$GLB"

echo ">> [1/8] COLMAP feature extraction"
"$COLMAP" feature_extractor \
  --database_path "$COLMAP_DIR/database.db" \
  --image_path "$FRAMES" \
  --ImageReader.single_camera 1 \
  --SiftExtraction.num_threads "$THREADS"

echo ">> [2/8] COLMAP feature matching"
"$COLMAP" exhaustive_matcher \
  --database_path "$COLMAP_DIR/database.db" \
  --SiftMatching.num_threads "$THREADS"

echo ">> [3/8] COLMAP sparse reconstruction (mapper)"
mkdir -p "$COLMAP_DIR/sparse"
"$COLMAP" mapper \
  --database_path "$COLMAP_DIR/database.db" \
  --image_path "$FRAMES" \
  --output_path "$COLMAP_DIR/sparse"

echo ">> [4/8] COLMAP image undistortion"
"$COLMAP" image_undistorter \
  --image_path "$FRAMES" \
  --input_path "$COLMAP_DIR/sparse/0" \
  --output_path "$DENSE" \
  --output_type COLMAP

echo ">> [5/8] OpenMVS densify"
"$(mvs InterfaceCOLMAP)" -i "$DENSE" -o "$DENSE/scene.mvs" --working-folder "$DENSE"
"$(mvs DensifyPointCloud)" "$DENSE/scene.mvs" --working-folder "$DENSE" --max-threads "$THREADS"

echo ">> [6/8] OpenMVS reconstruct mesh"
"$(mvs ReconstructMesh)" "$DENSE/scene_dense.mvs" -o "$MESH/scene_mesh.mvs" --working-folder "$DENSE"

echo ">> [7/8] OpenMVS texture mesh"
"$(mvs TextureMesh)" "$MESH/scene_mesh.mvs" -o "$TEXTURES/model_textured.obj" \
  --export-type obj --working-folder "$DENSE"

echo ">> [8/8] Convert to GLB"
python3 "$SCRIPT_DIR/../python/convert_to_glb.py" \
  --input "$TEXTURES/model_textured.obj" \
  --output "$GLB/model.glb"

echo ">> Done. GLB at $GLB/model.glb"
