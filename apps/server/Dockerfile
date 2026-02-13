FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run -C apps/server build

FROM oven/bun:1.3 AS prod-deps

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages ./packages

RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3 AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/packages /app/packages
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/server/public /app/apps/server/public
COPY --from=builder /app/apps/server/drizzle /app/apps/server/drizzle

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const port = process.env.WS_PORT ?? '3000'; const res = await fetch('http://127.0.0.1:' + port + '/api/health'); if (!res.ok) process.exit(1);"

USER bun

CMD ["bun", "/app/apps/server/dist/index.mjs"]
