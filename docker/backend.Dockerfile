# ===========================================================================
# InView3D backend image
#
# Bundles the full classical-photogrammetry toolchain so the pipeline runs
# self-contained: FFmpeg, COLMAP, OpenMVS, Python (trimesh) and Node 20.
#
# NOTE: This is a CPU build. COLMAP dense stereo is far faster on GPU; for
# production, base this on an NVIDIA CUDA image and a GPU-enabled COLMAP.
# ===========================================================================
FROM ubuntu:22.04 AS toolchain

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ---- System deps + FFmpeg + COLMAP (from Ubuntu repos) --------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential cmake \
    ffmpeg colmap \
    python3 python3-pip \
    # OpenMVS build deps
    libcgal-dev libboost-all-dev libopencv-dev libglu1-mesa-dev \
    libglew-dev libeigen3-dev \
    && rm -rf /var/lib/apt/lists/*

# ---- Build OpenMVS (VCGLib + OpenMVS) -------------------------------------
WORKDIR /opt
RUN git clone --depth 1 https://github.com/cdcseacave/VCG.git vcglib && \
    git clone --depth 1 https://github.com/cdcseacave/openMVS.git openMVS && \
    mkdir openMVS/build && cd openMVS/build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release -DVCG_ROOT=/opt/vcglib && \
    make -j"$(nproc)" && make install && \
    rm -rf /opt/openMVS/build/CMakeFiles

# OpenMVS binaries install to /usr/local/bin/OpenMVS
ENV OPENMVS_BIN_DIR=/usr/local/bin/OpenMVS

# ---- Node.js 20 -----------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# ---- Python GLB conversion deps -------------------------------------------
COPY processing/python/requirements.txt /opt/inview3d/processing/python/requirements.txt
RUN pip3 install --no-cache-dir -r /opt/inview3d/processing/python/requirements.txt

# ===========================================================================
# Build the backend
# ===========================================================================
FROM toolchain AS build
WORKDIR /app

# Install backend deps (use backend package.json only for a smaller context)
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
