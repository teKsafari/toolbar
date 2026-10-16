# syntax=docker/dockerfile:1
# Multi-stage build for @toolbar/server. Build context: the repo root.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@toolbar/server..."
RUN pnpm --filter @toolbar/server build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @toolbar/server deploy --prod --legacy /out

FROM node:24-bookworm-slim AS runtime
# ffmpeg remuxes MediaRecorder WebM and makes thumbnails (architecture section 5); tesseract reads
# canvas regions for the feedback folder's text/ (OCR_LANGS picks eng, swa or both); DejaVu draws the
# placeholder card of captures with no picture (D-183; ffmpeg already pulls it in, named to keep it).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu-core tesseract-ocr tesseract-ocr-eng tesseract-ocr-swa \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/build ./build
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/server/server.js ./server.js
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=210M
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
