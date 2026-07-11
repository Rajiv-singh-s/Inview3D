# ===========================================================================
# InView3D backend image
#
# The backend now acts purely as an API gateway, orchestrating data flow 
# between the Next.js frontend and the Google Colab GPU pipeline.
# ===========================================================================
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install
COPY backend ./backend
RUN cd backend && npm run build

# ===========================================================================
# Runtime
# ===========================================================================
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json

ENV NODE_ENV=production
ENV UPLOAD_PATH=/data/uploads
ENV OUTPUT_PATH=/data/output
RUN mkdir -p /data/uploads /data/output

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/main.js"]
