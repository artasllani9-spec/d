const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      if (!key || process.env[key]) return;
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, 'discord-bot', '.env'));

function shouldRunDiscordBot() {
  if (process.env.RUN_SITE_SERVER === '1') return false;
  if (process.env.RUN_DISCORD_BOT === '1') return true;
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
}

if (shouldRunDiscordBot()) {
  console.log('Starting ValueDex Discord bot...');
  const bot = require(path.join(__dirname, 'discord-bot', 'index.js'));

  const port = Number(process.env.PORT) || 8080;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'ValueDex Discord bot',
          build: bot.BOT_BUILD || 'unknown',
          loggedIn: Boolean(bot.client && bot.client.user),
          user: bot.client && bot.client.user ? bot.client.user.tag : null,
        })
      );
    })
    .listen(port, () => {
      console.log(`Bot health check listening on :${port}`);
    });
} else {
  const { createTradeApp } = require('./create-trade-app');

  const PORT = process.env.PORT || 3000;
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const app = createTradeApp();

  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
      etag: true,
      lastModified: true,
    })
  );

  app.listen(PORT, () => {
    console.log(`valuedex running at http://localhost:${PORT}`);
    console.log(`Roblox login: http://localhost:${PORT}/api/auth/roblox`);
  });
}
