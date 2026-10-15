# syntax=docker/dockerfile:1
# The injector (D-157): Go reverse proxy plus the page bundle it serves under /__toolbar/.
# Build context: the repo root (docker build -f apps/injector/Dockerfile .).

# 1. The page bundle, built from the extension's capture code.
FROM node:24-bookworm-slim AS page
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@toolbar/extension..."
RUN pnpm --filter @toolbar/extension build:page

# 2. The proxy: one static binary.
FROM golang:1.26-bookworm AS proxy
WORKDIR /src
COPY apps/injector/go.mod apps/injector/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/injector/*.go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/injector .

# 3. Runtime: nothing but the binary and the bundle.
FROM scratch
COPY --from=proxy /out/injector /injector
COPY --from=page /repo/apps/extension/.output/page/ /srv/toolbar/
USER 65532:65532
ENV INJECTOR_LISTEN=:8080 INJECTOR_ASSETS=/srv/toolbar
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=4s --start-period=5s --retries=3 CMD ["/injector", "healthcheck"]
ENTRYPOINT ["/injector"]
