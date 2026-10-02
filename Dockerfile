# syntax=docker/dockerfile:1

# Debian (glibc) base: onnxruntime-node ships no musl/alpine binaries.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# OpenSSL is needed by the Prisma CLI (migrate deploy) at runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@10.11.1 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build

# postinstall runs `prisma generate`, so the schema must be present first.
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Bake the embedding model into the image (cached until deps or model change).
ARG EMBEDDING_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
ENV EMBEDDING_MODEL=$EMBEDDING_MODEL \
    EMBEDDING_CACHE_DIR=/app/.models
COPY scripts ./scripts
RUN node scripts/download-model.mjs

COPY . .
RUN pnpm build \
 && pnpm prune --prod --ignore-scripts

# ---------------------------------------------------------------------------
FROM base AS runtime
ARG EMBEDDING_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
ENV NODE_ENV=production \
    EMBEDDING_MODEL=$EMBEDDING_MODEL \
    EMBEDDING_CACHE_DIR=/app/.models

COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.models ./.models
# Needed at runtime by `prisma migrate deploy` and the seed script.
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node docker-entrypoint.sh ./

USER node
EXPOSE 3000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
