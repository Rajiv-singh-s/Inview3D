# Deployment guide

This project deploys as two services:

- **Frontend → Vercel** (Next.js). Straightforward.
- **Backend → Railway** (Docker image with the CV toolchain). Heavy — read the
  caveats below before relying on it.

---

## 0. Push to GitHub

```bash
# from the repo root
git init
git add .
git commit -m "Initial commit: InView3D Phase 1 MVP"
gh auth login                      # if not already authenticated
gh repo create InView3D --public --source . --remote origin --push
```

---

## 1. Frontend on Vercel

The repo is a monorepo, so point Vercel at the `frontend/` subdirectory.

**Dashboard method (recommended):**
1. Import the GitHub repo in Vercel.
2. Set **Root Directory** = `frontend`.
3. Add environment variable:
   - `NEXT_PUBLIC_API_BASE_URL` = your Railway backend URL (e.g.
     `https://inview3d-backend.up.railway.app`).
4. Deploy.

**CLI method:**
```bash
npm i -g vercel
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_BASE_URL   # paste the Railway URL
vercel --prod
```

After the backend is deployed, update `NEXT_PUBLIC_API_BASE_URL` and redeploy
the frontend so the browser calls the right API host.

---

## 2. Backend on Railway

```bash
npm i -g @railway/cli
railway login
railway init                       # create/link a project
railway up                         # builds docker/backend.Dockerfile
```

Railway reads `railway.toml` (Dockerfile builder, `/health` healthcheck).

**Add required services in the Railway project:**
- **Redis** — add the Railway Redis plugin. It exposes `REDISHOST`, `REDISPORT`,
  `REDISPASSWORD` (or a `REDIS_URL`). Map them to the backend's env vars.
- **Volume** — attach a persistent volume mounted at `/data` so uploads/outputs
  survive restarts.

**Environment variables (backend service):**
| Variable            | Value                                             |
| ------------------- | ------------------------------------------------- |
| `BACKEND_PORT`      | `4000` (or bind to Railway's `$PORT` — see below) |
| `REDIS_HOST`        | Redis service host                                |
| `REDIS_PORT`        | Redis service port                                |
| `REDIS_PASSWORD`    | Redis password                                    |
| `UPLOAD_PATH`       | `/data/uploads`                                   |
| `OUTPUT_PATH`       | `/data/output`                                    |
| `CORS_ORIGIN`       | your Vercel frontend URL                           |

> Railway injects a `$PORT` the service must listen on. Either set
> `BACKEND_PORT=$PORT` in the Railway variables, or expose 4000 and configure
> the service port to 4000 in the Railway networking settings.

---

## ⚠️ Important caveats for the Railway backend

The backend image bundles the **full classical-photogrammetry pipeline**, which
has real infrastructure demands that a typical PaaS hobby tier may not meet:

1. **Build size & time** — `docker/backend.Dockerfile` compiles OpenMVS (and
   its VCGLib dependency) from source. Expect a multi-GB image and a long build
   that can exceed default build timeouts. Consider pre-building the image and
   pushing to a registry (GHCR/Docker Hub), then deploying that image instead.
2. **CPU & RAM** — COLMAP dense stereo + OpenMVS densification are memory- and
   CPU-intensive. Small instances will OOM or run for a very long time. There is
   **no GPU** on standard Railway instances, so dense reconstruction is CPU-only
   and slow.
3. **Disk** — frames, dense clouds and meshes are large. Attach a volume and
   size it generously.
4. **Long-running jobs** — a reconstruction can take many minutes. That's fine
   for a background BullMQ worker, but keep the healthcheck lenient
   (`healthcheckTimeout` is already 300s).

**Recommendation for a public demo:** deploy the frontend to Vercel and the API
to Railway so the UI, upload, validation and project management all work online.
For the actual heavy reconstruction, either (a) run it on a beefier VM / GPU
host, or (b) pre-build and host the Docker image and give the Railway service
enough resources. Treat Railway as "API + light work"; treat real reconstruction
as a resourced workload.

---

## Post-deploy checklist

- [ ] Backend `/health` returns 200 on the Railway URL.
- [ ] `NEXT_PUBLIC_API_BASE_URL` on Vercel points at the Railway URL.
- [ ] `CORS_ORIGIN` on Railway points at the Vercel URL.
- [ ] Redis is connected (no `ECONNREFUSED` in backend logs).
- [ ] A test upload creates a project (`GET /projects` shows it).
