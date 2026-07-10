# InView3D

Turn an indoor **walkthrough video** into an **interactive, browser-based 3D
environment** — like Google Street View for interiors — using only **classical
computer vision and photogrammetry** (COLMAP + OpenMVS). No AI, no NeRF, no
Gaussian Splatting.

> **Phase 1 MVP / Proof of Concept.** The goal is to prove the automatic
> reconstruction pipeline works end-to-end: upload a video → validate →
> reconstruct → generate an optimized GLB → explore in the browser.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Folder structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Running with Docker (recommended)](#running-with-docker-recommended)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Processing pipeline](#processing-pipeline)
- [API documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [Future improvements](#future-improvements)

---

## Features

- **Upload** any common video format (validated by FFprobe, not by extension).
  Unsupported codecs are automatically transcoded to H.264 MP4; the original is
  always preserved.
- **Automatic pipeline** (BullMQ background jobs): frame extraction → COLMAP SfM
  → OpenMVS dense reconstruction, mesh + texture → GLB export → optimization.
- **Live progress** with per-step status, timings and structured logs.
- **Interactive viewer** (React Three Fiber): orbit / zoom / pan, reset camera,
  fullscreen, grid & axes toggles, FPS counter. Control scheme is isolated so a
  first-person (PointerLock + WASD + collision) mode can be dropped in later.
- **Project management**: list, inspect, download GLB, delete.

## Architecture

```
Browser (Next.js)  ──HTTP──►  NestJS API  ──enqueue──►  Redis / BullMQ
      ▲                            │                         │
      │  poll /status              │  serve /model           ▼
      │                            │                   Reconstruction worker
      └──────── GLB (three.js) ◄───┘                   (FFmpeg + COLMAP + OpenMVS)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module boundaries and the
scalability rationale (why swapping in auth/DB/cloud storage later is easy).

## Tech stack

| Layer       | Technology                                                            |
| ----------- | --------------------------------------------------------------------- |
| Frontend    | Next.js 15, React 19, TypeScript, Tailwind, R3F, three.js, Drei, Zustand, TanStack Query, React Dropzone |
| Backend     | NestJS, TypeScript, BullMQ, Redis, Express, Multer                    |
| Processing  | FFmpeg / FFprobe, COLMAP, OpenMVS, Python (trimesh) for GLB export    |
| Rendering   | three.js + GLTFLoader (GLB)                                           |
| Dev / infra | Docker, Docker Compose, ESLint, Prettier                             |

## Folder structure

```
InView3D/
├── frontend/       Next.js app (landing, upload, processing, viewer, projects)
├── backend/        NestJS API + BullMQ pipeline orchestration
│   └── src/
│       ├── config/           typed env configuration
│       ├── common/           logger, exception filter, shared interfaces
│       ├── modules/
│       │   ├── upload/        FFprobe, validation, upload use case
│       │   ├── projects/      in-memory + JSON-persisted project store
│       │   ├── queue/         BullMQ queue + reconstruction worker
│       │   └── viewer/        (viewer endpoints live in projects controller)
│       └── pipeline/          the step-by-step reconstruction runner
├── processing/     standalone reference scripts + Python GLB converter
├── uploads/        per-project working data (frames, colmap, dense, mesh, …)
├── output/         per-project final artifacts (project.json, model.glb)
├── docker/         Dockerfiles
├── scripts/        setup helpers
└── docs/           architecture, pipeline and API docs
```

## Prerequisites

- **Node.js 20+**
- **Redis 7+** (or use Docker Compose)
- Native CV toolchain on `PATH` **only if running the pipeline outside Docker**:
  - `ffmpeg` / `ffprobe`
  - `colmap`
  - OpenMVS binaries (`InterfaceCOLMAP`, `DensifyPointCloud`, `ReconstructMesh`, `TextureMesh`)
  - `python3` with `pip install -r processing/python/requirements.txt`

> The **backend Docker image bundles the entire toolchain**, so Docker is the
> simplest way to run the full pipeline (especially on Windows).

## Running with Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend → http://localhost:3000
- Backend  → http://localhost:4000
- Redis    → localhost:6379

The first build is slow because OpenMVS is compiled from source.

## Running locally

```bash
# 1. Install dependencies and create .env
#    Windows:
powershell -File scripts/setup.ps1
#    macOS / Linux:
bash scripts/setup.sh

# 2. Start Redis (if you don't already have it)
docker run --rm -p 6379:6379 redis:7-alpine

# 3. Run backend + frontend together (from repo root)
npm run dev
```

Frame extraction and reconstruction require FFmpeg, COLMAP and OpenMVS on
`PATH`. If they're missing, upload/validation still works but the pipeline
step that needs the missing tool will fail with a clear message in the UI and
in `uploads/<id>/logs/pipeline.log`.

## Configuration

All configuration is via `.env` (see [.env.example](.env.example)). Key values:

| Variable                 | Default        | Purpose                                    |
| ------------------------ | -------------- | ------------------------------------------ |
| `BACKEND_PORT`           | `4000`         | API port                                   |
| `UPLOAD_PATH`            | `./uploads`    | Working data root                          |
| `OUTPUT_PATH`            | `./output`     | Final artifacts + project.json store       |
| `MAX_UPLOAD_SIZE`        | `2147483648`   | Max upload size (bytes)                     |
| `MAX_DURATION_SECONDS`   | `300`          | Max accepted video duration                 |
| `FRAME_INTERVAL_SECONDS` | `1`            | Extract one frame every N seconds           |
| `MAX_FRAMES`             | `300`          | Hard cap on extracted frames                |
| `PROCESSING_THREADS`     | `0` (all)      | CPU threads for COLMAP/OpenMVS             |
| `REDIS_HOST/PORT`        | `127.0.0.1/6379` | BullMQ connection                        |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000` | Frontend → backend base URL     |

## Processing pipeline

See [docs/PIPELINE.md](docs/PIPELINE.md) for the full command reference. Summary:

1. Save uploaded video (original preserved).
2. Transcode to H.264 MP4 if the codec isn't pipeline-friendly.
3. Extract frames with FFmpeg (`FRAME_INTERVAL_SECONDS`).
4. COLMAP feature extraction.
5. COLMAP feature matching.
6. COLMAP sparse reconstruction (mapper).
7. COLMAP image undistortion.
8. OpenMVS dense point cloud (`InterfaceCOLMAP` + `DensifyPointCloud`).
9. Export point cloud.
10. OpenMVS mesh reconstruction.
11. OpenMVS mesh texturing.
12. Convert textured mesh → GLB (`processing/python/convert_to_glb.py`).
13. Optimize GLB (`gltfpack`, best-effort / skipped if unavailable).
14. Store output in `output/<id>/model.glb`.

Every step logs start/end/duration/status/errors to
`uploads/<id>/logs/pipeline.log`.

## API documentation

See [docs/API.md](docs/API.md). Endpoints:

| Method | Path            | Description                    |
| ------ | --------------- | ----------------------------- |
| POST   | `/upload`       | Upload walkthrough video      |
| GET    | `/projects`     | List projects                 |
| GET    | `/project/:id`  | Project details               |
| GET    | `/status/:id`   | Processing status / progress  |
| GET    | `/viewer/:id`   | Viewer metadata               |
| GET    | `/model/:id`    | Download / stream GLB         |
| DELETE | `/project/:id`  | Delete project + artifacts    |
| GET    | `/health`       | Liveness                      |

## Troubleshooting

- **"Failed to start colmap/InterfaceCOLMAP …"** — the binary isn't on `PATH`.
  Use Docker, or install the tool and set `COLMAP_BIN` / `OPENMVS_BIN_DIR`.
- **Sparse reconstruction produced no model** — the walkthrough moved too fast
  or frames don't overlap. Record slower with more overlap, or lower
  `FRAME_INTERVAL_SECONDS`.
- **Only N frames extracted** — video too short for the interval; reduce
  `FRAME_INTERVAL_SECONDS`.
- **Upload rejected** — check size/duration limits and that the file is a real
  video (validation is FFprobe-based).
- **GLB conversion failed** — ensure `pip install -r processing/python/requirements.txt`.
- **Redis connection refused** — start Redis or fix `REDIS_HOST/PORT`.

## Future improvements

- GPU-accelerated COLMAP (CUDA base image) for far faster dense stereo.
- First-person navigation: PointerLockControls + WASD + collision detection.
- Persistence layer (Postgres) behind the existing `ProjectsService` interface.
- Cloud storage (S3) for uploads/outputs, and auth/billing/team features — all
  addable without changing the pipeline (see architecture notes).
- Mesh decimation / LOD and Draco compression for lighter models.
