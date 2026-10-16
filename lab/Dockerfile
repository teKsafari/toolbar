# syntax=docker/dockerfile:1
# The lab app as a container: a safe target for the injector on a real server
# (deploy/lab/docker-compose.lab.yml) and in apps/injector/test/coolify-like/.
# Build context: this folder (docker build lab).
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /lab
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
WORKDIR /lab
COPY --from=build /lab/package.json /lab/server.js ./
COPY --from=build /lab/node_modules ./node_modules
COPY --from=build /lab/build ./build
ENV NODE_ENV=production PORT=5173 HOST=0.0.0.0
USER node
EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5173/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
