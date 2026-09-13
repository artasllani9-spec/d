FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY data ./data
COPY discord-bot ./discord-bot
COPY local-server.js ./local-server.js

CMD ["node", "discord-bot/index.js"]
