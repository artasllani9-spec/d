#!/usr/bin/env node
/**
 * Keeps ValueDex online, and starts Auto MM when its secrets are set.
 *
 * Railway / production env:
 *   DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID          -> ValueDex bot
 *   AUTO_MM_DISCORD_BOT_TOKEN                    -> Auto MM bot (required to start it)
 *   AUTO_MM_DISCORD_CLIENT_ID                    -> Auto MM application id
 *   AUTO_MM_WALLET_MNEMONIC                      -> Auto MM HD wallet phrase
 *   AUTO_MM_STAFF_ROLE_ID, AUTO_MM_ESCROW_CATEGORY_ID, AUTO_MM_DEALS_CHANNEL_ID (optional)
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const children = new Map();
let shuttingDown = false;

function log(tag, message) {
  console.log(`[${tag}] ${message}`);
}

function start(name, entry, env = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(name, child);
  const prefix = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line) console.log(`[${name}] ${line}`);
    }
  };
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${name}] exited (${reason})`);
    shuttingDown = true;
    for (const [other, proc] of children) {
      log('start-bots', `stopping ${other}`);
      proc.kill('SIGTERM');
    }
    process.exit(code && code !== 0 ? code : 1);
  });
  log('start-bots', `started ${name}`);
  return child;
}

start('valuedex', path.join(root, 'discord-bot', 'index.js'));

const autoToken = (process.env.AUTO_MM_DISCORD_BOT_TOKEN || '').trim();
const autoClient = (process.env.AUTO_MM_DISCORD_CLIENT_ID || '').trim();
const autoMnemonic = (process.env.AUTO_MM_WALLET_MNEMONIC || process.env.WALLET_MNEMONIC || '').trim();

if (autoToken && autoClient && autoMnemonic) {
  start('auto-mm', path.join(root, 'auto-mm', 'src', 'index.js'), {
    // Prefer dedicated Auto MM secrets so ValueDex's Discord token is not reused.
    AUTO_MM_DISCORD_BOT_TOKEN: autoToken,
    AUTO_MM_DISCORD_CLIENT_ID: autoClient,
    AUTO_MM_WALLET_MNEMONIC: autoMnemonic,
  });
} else {
  log(
    'start-bots',
    'Auto MM skipped — set AUTO_MM_DISCORD_BOT_TOKEN, AUTO_MM_DISCORD_CLIENT_ID, and AUTO_MM_WALLET_MNEMONIC on Railway to bring it online.'
  );
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('start-bots', `shutting down (${signal})`);
  for (const proc of children.values()) proc.kill(signal);
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
