FROM node:22-bookworm-slim

WORKDIR /app

# Install bot dependencies only (site Express deps are not needed to run the bot)
COPY discord-bot/package.json discord-bot/package-lock.json ./discord-bot/
RUN npm ci --prefix discord-bot --omit=dev

# Bot reads values/images from these paths at runtime
COPY public ./public
COPY data ./data
COPY discord-bot ./discord-bot

CMD ["npm", "start", "--prefix", "discord-bot"]
