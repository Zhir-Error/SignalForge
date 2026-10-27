FROM node:24-alpine AS base

RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/demo-service/package.json apps/demo-service/package.json
COPY apps/verification-runner/package.json apps/verification-runner/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai-investigator/package.json packages/ai-investigator/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ARG APP_PACKAGE
ARG API_BASE_URL=http://api:4000
ENV API_BASE_URL=${API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter "${APP_PACKAGE}..." build

FROM builder AS packager

RUN pnpm --filter "${APP_PACKAGE}" deploy --prod --config.inject-workspace-packages=true /prod \
  && case "${APP_PACKAGE}" in \
    @signalforge/api|@signalforge/worker) workspace_packages="ai-investigator auth contracts db domain" ;; \
    @signalforge/demo-service|@signalforge/verification-runner) workspace_packages="contracts domain" ;; \
    *) workspace_packages="" ;; \
  esac \
  && mkdir -p /prod/node_modules/@signalforge \
  && for package in $workspace_packages; do \
    mkdir -p "/prod/packages/${package}"; \
    cp "packages/${package}/package.json" "/prod/packages/${package}/package.json"; \
    cp -a "packages/${package}/dist" "/prod/packages/${package}/dist"; \
    ln -sfn "../../packages/${package}" "/prod/node_modules/@signalforge/${package}"; \
  done \
  && if [ "${APP_PACKAGE}" = "@signalforge/web" ]; then \
    cp -a apps/web/.next /prod/.next; \
  fi

FROM node:24-alpine AS runtime

RUN apk add --no-cache libc6-compat

WORKDIR /app

ARG APP_PACKAGE
ARG API_BASE_URL=http://api:4000
ENV APP_PACKAGE=${APP_PACKAGE}
ENV API_BASE_URL=${API_BASE_URL}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=packager --chown=node:node /prod/ ./

RUN mkdir -p .next/cache \
  && chown -R node:node .next

USER node

EXPOSE 3000 4000 4100 4200
CMD ["npm", "start"]
