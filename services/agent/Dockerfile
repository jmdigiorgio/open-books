# OpenBooks classification agent — production image.
# Build: docker build -t open-books-agent ./services/agent
# Run: docker run --rm -p 3001:3001 --env-file .env open-books-agent

# ---- Build stage: compile TypeScript ----
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps (production + dev for tsc).
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY tsconfig.json ./
COPY src ./src
COPY prompt.md ./
RUN npm run build

# ---- Run stage: minimal runtime ----
FROM node:22-alpine AS runner

WORKDIR /app

# Production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Built output and prompt (used at runtime).
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompt.md ./

# Agent listens on PORT (default 3001).
ENV NODE_ENV=production
EXPOSE 3001

USER node
CMD ["node", "dist/index.js"]
