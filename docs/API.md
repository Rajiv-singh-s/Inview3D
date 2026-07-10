# API reference

Base URL: `http://localhost:4000` (configurable via `NEXT_PUBLIC_API_BASE_URL`
on the frontend and `BACKEND_PORT` on the backend).

All errors share a consistent envelope:
```json
{
  "statusCode": 400,
  "error": "BadRequestException",
  "message": "Video is too long (420s). Maximum is 300s.",
  "path": "/upload",
  "timestamp": "2026-07-10T12:00:00.000Z"
}
```

---

### POST `/upload`
Multipart form upload. Field name: **`video`**.

**Response 201**
```json
{
  "id": "a1b2c3d4e5f6",
  "status": "queued",
  "originalName": "walkthrough.mov",
  "videoInfo": {
    "filename": "walkthrough.mov",
    "sizeBytes": 48211234,
    "durationSeconds": 42.5,
    "width": 1920, "height": 1080,
    "fps": 30, "videoCodec": "hevc",
    "bitrate": 9120000, "container": "mov,mp4,m4a,3gp,3g2,mj2"
  }
}
```
Validation errors (empty file, corrupted, too large, too long, unreadable) →
`400` with a descriptive message.

---

### GET `/projects`
List all projects, newest first. Returns an array of `Project`.

### GET `/project/:id`
Full `Project` record (status, progress, steps, videoInfo, glb info).

### GET `/status/:id`
Lightweight polling payload:
```json
{
  "id": "a1b2c3d4e5f6",
  "status": "processing",
  "progress": 57,
  "steps": [
    { "id": "extract-frames", "label": "Extract frames", "status": "completed", "durationMs": 1830 },
    { "id": "feature-extraction", "label": "COLMAP feature extraction", "status": "running" }
  ],
  "error": null,
  "updatedAt": "2026-07-10T12:01:22.000Z"
}
```
`status` ∈ `uploaded | queued | processing | completed | failed | canceled`.

### GET `/viewer/:id`
Only succeeds when `status === "completed"`. Returns viewer metadata:
```json
{
  "id": "a1b2c3d4e5f6",
  "originalName": "walkthrough.mov",
  "videoInfo": { "...": "..." },
  "modelUrl": "/model/a1b2c3d4e5f6",
  "glbSizeBytes": 3211045,
  "completedAt": "2026-07-10T12:05:40.000Z"
}
```
Otherwise `404` ("Model is not ready for this project yet").

### GET `/model/:id`
Streams the generated GLB (`Content-Type: model/gltf-binary`). Used directly by
the three.js `GLTFLoader`. `404` if not yet produced.

### DELETE `/project/:id`
Removes the project record and all on-disk artifacts (uploads + output).
```json
{ "id": "a1b2c3d4e5f6", "deleted": true }
```

### GET `/health`
```json
{ "status": "ok", "service": "inview3d-backend", "timestamp": "..." }
```
