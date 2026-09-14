/**
 * Register slash commands via REST only (does not open a gateway session).
 * Usage: node discord-bot/register-commands.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');

process.env.DISCORD_SKIP_LOGIN = '1';
const { allCommands } = require('./index.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

async function main() {
  const rest = new REST({ version: '10' }).setToken(token);
  const names = allCommands.map((cmd) => `/${cmd.name}`).join(', ');

  // Remove globals so Discord doesn't show each command twice.
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log('Cleared global slash commands.');

  if (!guildId) {
    await rest.put(Routes.applicationCommands(clientId), { body: allCommands });
    console.log(`No DISCORD_GUILD_ID set — registered global commands: ${names}`);
    return;
  }

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: allCommands,
  });
  console.log(`Registered guild commands (${guildId}): ${names}`);

  const listed = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
  console.log(
    'Verified:',
    (Array.isArray(listed) ? listed : []).map((cmd) => `/${cmd.name}`).join(', ')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
