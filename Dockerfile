# Remotion render worker — Node 22 + Chromium + ffmpeg
FROM node:22-bookworm-slim

# Chromium + ffmpeg + fonts so Remotion can render headlessly
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto \
    fonts-noto-color-emoji \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm install tsx typescript --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

EXPOSE 10000

CMD ["npx", "tsx", "src/server.ts"]
