# ===========================================================================
# InView3D backend image
#
# The photosphere pipeline needs only Python + OpenCV (classical stitching) and
# Node for the API. No COLMAP, no OpenMVS, no FFmpeg — the old video->mesh
# pipeline is gone, and with it a ~40 minute source build.
# ===========================================================================
FROM node:20-bookworm-slim AS toolchain

ENV DEBIAN_FRONTEND=noninteractive

# opencv-python-headless still needs a couple of runtime shared libraries.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY processing/python/requirements.txt /opt/inview3d/processing/python/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
    -r /opt/inview3d/processing/python/requirements.txt

# ===========================================================================
# Build the backend
# ===========================================================================
FROM toolchain AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install
COPY backend ./backend
RUN cd backend && npm run build

# ===========================================================================
# Runtime
# ===========================================================================
FROM toolchain AS runtime
WORKDIR /app

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY processing ./processing

ENV NODE_ENV=production
ENV UPLOAD_PATH=/data/uploads
ENV OUTPUT_PATH=/data/output
ENV PIPELINE_SCRIPTS_DIR=/app/processing/scripts
RUN mkdir -p /data/uploads /data/output

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/main.js"]
