FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/

RUN bun install

COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/server apps/server

EXPOSE 3001
ENV PORT=3001
CMD ["bun", "apps/server/src/index.ts"]
