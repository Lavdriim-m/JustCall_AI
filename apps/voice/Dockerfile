# JustCall voice server (Twilio media streams, STT/TTS, jobs)
# Build from the repository root:  docker build -f apps/voice/Dockerfile -t justcall-voice .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc* ./
COPY apps/voice/package.json apps/voice/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
RUN pnpm install --frozen-lockfile --filter "@justcall/voice..." --filter "@justcall/db..."
COPY packages ./packages
COPY apps/voice ./apps/voice
RUN pnpm --filter @justcall/voice build

FROM base AS runtime
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
WORKDIR /app/apps/voice
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run migrations before start with:  docker run … justcall-voice pnpm --filter @justcall/db migrate
CMD ["node", "dist/index.js"]
