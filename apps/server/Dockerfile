FROM oven/bun:1.3.0 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY tsconfig.json ./
COPY apps/server/package.json apps/server/tsdown.config.ts apps/server/ ./
COPY apps/server/ui ./apps/server/ui
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run -C apps/server ui:build
RUN bun run -C apps/server build

FROM oven/bun:1.3.0 AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/server/ui/dist /app/apps/server/ui/dist

EXPOSE 3000

CMD ["bun", "/app/apps/server/dist/index.js"]
