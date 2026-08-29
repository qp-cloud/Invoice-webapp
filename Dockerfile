# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime deps (production only) ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    PGLITE_DATA_DIR=/data \
    BACKUP_DIR=/backups \
    WEB_DIST_DIR=/app/packages/web/dist
WORKDIR /app

COPY --from=deps  /app/node_modules            ./node_modules
COPY --from=build /app/package.json            ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist    ./packages/shared/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist    ./packages/server/dist
COPY --from=build /app/packages/web/package.json    ./packages/web/package.json
COPY --from=build /app/packages/web/dist       ./packages/web/dist

RUN mkdir -p /data /backups && chown -R node:node /data /backups /app
USER node
VOLUME ["/data", "/backups"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||4000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
