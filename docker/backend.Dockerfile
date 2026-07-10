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
    libglew-dev libeigen3-dev libnanoflann-dev libtinyxml2-dev \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu 22.04 ships CMake 3.22, but current OpenMVS requires a newer CMake.
# Install an up-to-date CMake from pip (lands in /usr/local/bin, ahead on PATH).
RUN pip3 install --no-cache-dir "cmake>=3.28"

# Ubuntu's libtinyxml2-dev ships only pkg-config, not the CMake config that
# TinyEXIF's find_package(tinyxml2) needs — so build tinyxml2 from source.
RUN git clone --depth 1 -b 10.0.0 https://github.com/leethomason/tinyxml2.git /opt/tinyxml2 && \
    cmake -S /opt/tinyxml2 -B /opt/tinyxml2/build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON && \
    cmake --build /opt/tinyxml2/build --target install -j2 && \
    ldconfig

# TinyEXIF is required by OpenMVS master and is not packaged in apt.
RUN git clone --depth 1 https://github.com/cdcseacave/TinyEXIF.git /opt/TinyEXIF && \
    cmake -S /opt/TinyEXIF -B /opt/TinyEXIF/build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_DEMO=OFF -DBUILD_SHARED_LIBS=ON && \
    cmake --build /opt/TinyEXIF/build --target install -j2 && \
    ldconfig

# ---- Build OpenMVS (VCGLib + OpenMVS) -------------------------------------
WORKDIR /opt
# Out-of-source build into a distinct dir (the repo already ships a `build/`),
# with CUDA disabled for this CPU-only image.
RUN git clone --depth 1 https://github.com/cdcseacave/VCG.git vcglib && \
    git clone --depth 1 https://github.com/cdcseacave/openMVS.git openMVS && \
    cmake -S openMVS -B openMVS_build \
      -DCMAKE_BUILD_TYPE=Release \
      -DVCG_ROOT=/opt/vcglib \
      -DOpenMVS_USE_CUDA=OFF && \
    cmake --build openMVS_build --target install -j2 && \
    rm -rf /opt/openMVS_build

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
