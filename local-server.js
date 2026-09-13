const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const express = require('express');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, 'utf8')
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

loadEnvFile();

function shouldRunDiscordBot() {
  // Force website mode on Railway only if explicitly requested
  if (process.env.RUN_SITE_SERVER === '1') return false;
  if (process.env.RUN_DISCORD_BOT === '1') return true;
  // This Railway service is for the always-on Discord bot (site stays on Vercel)
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
}

if (shouldRunDiscordBot()) {
  const port = Number(process.env.PORT) || 8080;
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ValueDex Discord bot is running\n');
    })
    .listen(port, () => {
      console.log(`Bot health check listening on :${port}`);
    });

  console.log('Starting ValueDex Discord bot...');
  const child = spawn('npm', ['start', '--prefix', 'discord-bot'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    console.error(`Discord bot exited (code=${code}, signal=${signal || 'none'})`);
    process.exit(code == null ? 1 : code);
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
