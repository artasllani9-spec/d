FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY auto-mm/package.json auto-mm/package-lock.json ./auto-mm/
RUN npm ci --omit=dev --prefix auto-mm

COPY public ./public
COPY data ./data
COPY discord-bot ./discord-bot
COPY auto-mm ./auto-mm
COPY local-server.js ./local-server.js
COPY scripts/start-bots.js ./scripts/start-bots.js

CMD ["node", "scripts/start-bots.js"]
