# Multi-stage production build for GYM-2026 (Spec 023, ADR 0011)
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

RUN NODE_ENV=production pnpm -r build

# Runtime image for API + DB migrations + bootstrap CLI
FROM node:22-alpine AS api
WORKDIR /app
RUN corepack enable && adduser -D -u 10001 gymuser

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
USER gymuser
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
