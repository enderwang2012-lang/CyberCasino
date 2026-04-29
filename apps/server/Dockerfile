FROM oven/bun:1.3 AS base
WORKDIR /app

COPY . .
RUN bun install

EXPOSE 3001
ENV PORT=3001
CMD ["bun", "apps/server/src/index.ts"]
