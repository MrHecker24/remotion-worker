# FFmpeg render worker — Node 22 + ffmpeg only (no browser, no Remotion)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm install tsx typescript --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

EXPOSE 10000

CMD ["npx", "tsx", "src/server.ts"]
