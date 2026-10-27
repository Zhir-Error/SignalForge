FROM node:24-alpine

RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

ARG APP_PACKAGE
ARG API_BASE_URL=http://api:4000
ENV APP_PACKAGE=${APP_PACKAGE}
ENV API_BASE_URL=${API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter "${APP_PACKAGE}..." build \
  && mkdir -p apps/web/.next/cache \
  && chown -R node:node apps/web/.next/cache

USER node

EXPOSE 3000 4000 4100 4200
CMD ["sh", "-c", "pnpm --filter \"$APP_PACKAGE\" start"]
