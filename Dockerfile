# Build stage — bundles all deps so production needs no node_modules
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/
RUN npx esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js

# Production stage
FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist/ dist/
COPY data/ data/

VOLUME ["/app/data", "/app/logs"]

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
