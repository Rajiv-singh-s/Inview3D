#!/usr/bin/env bash
# ===========================================================================
# InView3D — local setup (macOS / Linux)
# Installs Node dependencies and prepares .env. Native CV tools (FFmpeg,
# COLMAP, OpenMVS) are expected on PATH or provided via Docker.
# ===========================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Installing backend dependencies..."
(cd backend && npm install)

echo "Installing frontend dependencies..."
(cd frontend && npm install)

echo
echo "Setup complete. Start Redis, then run: npm run dev"
