# ===========================================================================
# InView3D backend image
#
# NestJS API + a local OpenCV panorama stitcher (Python). No GPU, no cloud:
# the 16 rotate-in-place photos are stitched into a 360° equirectangular image
# on this machine.
# ===========================================================================
FROM node:20-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
# opencv-python-headless needs a couple of runtime shared libraries.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY processing/python/requirements.txt /opt/processing/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /opt/processing/requirements.txt

# ---- Build the backend ----------------------------------------------------
FROM base AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install
COPY backend ./backend
RUN cd backend && npm run build

# ---- Runtime --------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
# The stitcher script; config resolves it at <cwd>/../processing/python.
COPY processing ./processing

ENV NODE_ENV=production
ENV UPLOAD_PATH=/data/uploads
ENV OUTPUT_PATH=/data/output
RUN mkdir -p /data/uploads /data/output

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/main.js"]
