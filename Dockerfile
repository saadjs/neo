# Build stage
FROM node:24.14.0-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Production stage
FROM node:24.14.0-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ dist/
COPY data/ data/
COPY deploy/esm-loader.mjs deploy/esm-resolve-hook.mjs deploy/

VOLUME ["/app/data", "/app/logs"]

ENV NODE_ENV=production

CMD ["node", "--import", "./deploy/esm-loader.mjs", "dist/index.js"]
