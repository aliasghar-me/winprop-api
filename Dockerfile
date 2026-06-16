# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack so pnpm is available
RUN corepack enable

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install all deps (including dev — needed for nest build)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm prisma generate

# Copy source and build
COPY . .
RUN pnpm build

# ─── Stage 2: run ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable

# Copy only what runtime needs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# The Prisma client is generated into node_modules at build time;
# re-generate here so the correct binary is present for this arch.
RUN pnpm prisma generate

EXPOSE 3001
ENV PORT=3001

# Run migrations then start the server.
# Seed (super-admin) is intentionally NOT run here — see runbook.
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/src/main"]
