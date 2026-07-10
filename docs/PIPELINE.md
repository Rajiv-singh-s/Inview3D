# Processing pipeline reference

Each project gets a working directory `uploads/<id>/` with subfolders:
`original-video/ frames/ colmap/ dense/ mesh/ textures/ glb/ logs/`.
Final artifacts are copied to `output/<id>/`.

The backend runs each stage individually (for granular progress + logging).
`processing/scripts/run_pipeline.sh` reproduces the exact same commands for
manual debugging.

## Stages & commands

### 1–2. Save & transcode
The original is preserved under `original-video/`. If the codec isn't in the
pipeline-friendly set (`h264, hevc, mpeg4, vp9, vp8, av1`), FFmpeg transcodes to
H.264 MP4:
```
ffmpeg -i <input> -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an working.mp4
```

### 3. Frame extraction
```
ffmpeg -i working.mp4 -vf fps=1/<FRAME_INTERVAL_SECONDS> -qscale:v 2 frames/frame_%05d.jpg
```
Requires ≥ 8 frames to proceed.

### 4. COLMAP feature extraction
```
colmap feature_extractor --database_path colmap/database.db --image_path frames \
  --ImageReader.single_camera 1
```

### 5. COLMAP feature matching
```
colmap exhaustive_matcher --database_path colmap/database.db
```

### 6. COLMAP sparse reconstruction
```
colmap mapper --database_path colmap/database.db --image_path frames \
  --output_path colmap/sparse
```
Fails if no model (`colmap/sparse/0`) is produced — indicates insufficient
overlap between frames.

### 7. Image undistortion
```
colmap image_undistorter --image_path frames \
  --input_path colmap/sparse/0 --output_path dense --output_type COLMAP
```

### 8–9. OpenMVS dense point cloud
```
InterfaceCOLMAP -i dense -o dense/scene.mvs --working-folder dense
DensifyPointCloud dense/scene.mvs --working-folder dense
# -> dense/scene_dense.ply / scene_dense.mvs
```

### 10. Mesh reconstruction
```
ReconstructMesh dense/scene_dense.mvs -o mesh/scene_mesh.mvs --working-folder dense
```

### 11. Texture mesh
```
TextureMesh mesh/scene_mesh.mvs -o textures/model_textured.obj \
  --export-type obj --working-folder dense
```

### 12. GLB export
```
python3 processing/python/convert_to_glb.py \
  --input textures/model_textured.obj --output glb/model.glb
```
Loads the textured OBJ (+ .mtl + texture) with trimesh, rotates Z-up → Y-up for
three.js, and writes an embedded-texture binary glTF.

### 13. Optimize (best-effort)
```
gltfpack -i glb/model.glb -o glb/model.opt.glb -cc
```
Skipped gracefully if `gltfpack` is not installed.

### 14. Store output
`glb/model.glb` is copied to `output/<id>/model.glb` and its size recorded on
the project.

## Logging
Every stage writes JSON lines to `uploads/<id>/logs/pipeline.log` with
timestamps, and raw tool stdout/stderr is appended for debugging. On failure,
the failing step is marked `failed` with the captured stderr tail, and the
project status becomes `failed`.

## Tuning tips
- More overlap between frames → more robust SfM. Lower `FRAME_INTERVAL_SECONDS`.
- `PROCESSING_THREADS` controls COLMAP/OpenMVS parallelism.
- Dense stereo is the slowest stage on CPU; a CUDA COLMAP build is dramatically
  faster.
