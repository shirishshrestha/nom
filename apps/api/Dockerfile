# Build context is the repo root (see docker-compose.apps.yml).
# Multi-stage pnpm build for the NestJS API in a hoisted workspace.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- install deps (cached on manifest changes) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/dtos/package.json packages/dtos/
COPY packages/neo4j/package.json packages/neo4j/
RUN pnpm install --frozen-lockfile

# --- build the API and its workspace deps ---
FROM deps AS build
COPY . .
RUN pnpm --filter @nom/shared build \
 && pnpm --filter @nom/dtos build \
 && pnpm --filter @nom/database build \
 && pnpm --filter @nom/neo4j build \
 && pnpm --filter api build

# --- production runtime ---
FROM base AS prod
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/dtos/package.json packages/dtos/
COPY packages/neo4j/package.json packages/neo4j/
# --ignore-scripts: the root `prepare` runs husky (a devDep, absent with --prod).
# Lifecycle scripts aren't needed for a runtime-only install anyway.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
# Compiled output for the API and the linked workspace packages.
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/dtos/dist packages/dtos/dist
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/neo4j/dist packages/neo4j/dist
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
EXPOSE 3000
# tsconfig rootDir "." preserves the src/ prefix, so the entrypoint is dist/src/main.js.
CMD ["node", "dist/src/main.js"]
