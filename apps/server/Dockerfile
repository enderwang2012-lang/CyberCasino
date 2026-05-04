FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock* tsconfig.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/engine/ ./packages/engine/
COPY apps/server/ ./apps/server/

RUN bun install

RUN cd packages/shared && bun run build
RUN cd packages/engine && bun run build

EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production

CMD ["bun", "apps/server/src/index.ts"]
