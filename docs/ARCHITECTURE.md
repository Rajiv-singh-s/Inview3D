# Architecture

InView3D is a monorepo with three cooperating parts — a Next.js **frontend**, a
NestJS **backend**, and a native **processing** toolchain the backend drives.
State for Phase 1 is deliberately simple (in-memory + JSON on disk), but every
seam is designed so heavier infrastructure can be added later without rewrites.

## High-level flow

```
Upload ─► Validate (FFprobe) ─► Create project ─► Enqueue (BullMQ)
                                                        │
                                                        ▼
                          Reconstruction worker runs the pipeline
        FFmpeg frames ─► COLMAP SfM ─► OpenMVS dense/mesh/texture ─► GLB ─► optimize
                                                        │
                                                        ▼
                              output/<id>/model.glb  +  project.json
                                                        │
                        Frontend polls /status, then loads /model in three.js
```

## Backend modules (SOLID / clean architecture)

- **`config/`** — a single typed `AppConfig` derived from env. Nothing else
  reads `process.env`. Relative paths are resolved once to absolute.
- **`common/`** — cross-cutting concerns: the structured `ProjectLogger`
  (per-project pipeline log), a global exception filter (consistent error
  envelope), and the shared domain `interfaces`.
- **`modules/upload/`** — ingestion use case. `FfprobeService` (inspection),
  `VideoValidationService` (content-based validation + transcode decision),
  `UploadService` (orchestration), `UploadController` (HTTP + Multer).
- **`modules/projects/`** — `ProjectsService` is the single source of truth for
  project state and the **only** place that touches persistence. It exposes a
  small method surface (`create`, `findAll`, `findOne`, `update`, `updateStep`,
  `remove`). Swapping the JSON store for a real repository (Postgres, Prisma)
  means changing this one class — no call sites change.
- **`modules/queue/`** — BullMQ wiring. `ReconstructionQueue` is a thin enqueue
  facade so callers don't depend on BullMQ; `ReconstructionProcessor` is the
  worker (concurrency 1).
- **`pipeline/`** — `PipelineService` owns step orchestration, progress and
  logging, and delegates the actual heavy lifting to external binaries via a
  small `runCommand` helper. Each CV stage is a private method, so a stage can
  be tuned or replaced in isolation.

### Dependency direction

Controllers → services → (queue / pipeline) → external tools. `ProjectsModule`
is `@Global` because upload, queue and viewer all read/write project state; it
still resolves to a single instance. No module imports a controller.

## Why this scales to later phases

| Future need          | How it slots in without architectural change                        |
| -------------------- | ------------------------------------------------------------------- |
| Auth / users         | Add a guard + user id on `Project`; controllers already thin.       |
| Database             | Reimplement `ProjectsService` against a repo; interface is stable.  |
| Cloud storage (S3)   | Replace filesystem reads/writes behind a `StorageService`.          |
| Billing / quotas     | Middleware/guard before upload; config already centralized.         |
| GPU / horizontal scale | Add BullMQ workers on more machines; queue already decouples them. |
| First-person viewer  | Swap `OrbitControls` in `ModelViewer` — model loading is separate.  |

## Frontend structure

- **App Router pages**: `/` (landing), `/upload`, `/processing/[id]`,
  `/viewer/[id]`, `/projects`.
- **State**: Zustand for the active upload; TanStack Query for server state
  (status polling, project list, viewer metadata).
- **Viewer**: `ModelViewer` (R3F `Canvas`, lighting, environment, grid/axes,
  stats) with the control scheme isolated in one place; `ViewerControls` is the
  overlay toolbar. Loaded via `next/dynamic` (`ssr: false`) since it needs WebGL.
