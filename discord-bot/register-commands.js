/**
 * Register slash commands via REST only (does not open a gateway session).
 * Usage: node discord-bot/register-commands.js
 *
 * - Global: /value + /help (user-install / DMs)
 * - Guild: admin + editor tools
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');

process.env.DISCORD_SKIP_LOGIN = '1';
const { userInstallCommands, guildOnlyCommands, allCommands } = require('./index.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

async function main() {
  const rest = new REST({ version: '10' }).setToken(token);
  const userNames = userInstallCommands.map((cmd) => `/${cmd.name}`).join(', ');
  const guildNames = guildOnlyCommands.map((cmd) => `/${cmd.name}`).join(', ');

  await rest.put(Routes.applicationCommands(clientId), { body: userInstallCommands });
  console.log(`Registered global (user-install) commands: ${userNames}`);

  const listedGlobal = await rest.get(Routes.applicationCommands(clientId));
  console.log(
    'Verified global:',
    (Array.isArray(listedGlobal) ? listedGlobal : []).map((cmd) => `/${cmd.name}`).join(', ')
  );

  if (!guildId) {
    console.log('No DISCORD_GUILD_ID set — skipped guild-only registration.');
    console.log(`All command names: ${allCommands.map((cmd) => `/${cmd.name}`).join(', ')}`);
    return;
  }

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: guildOnlyCommands,
  });
  console.log(`Registered guild-only commands (${guildId}): ${guildNames}`);

  const listed = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
  console.log(
    'Verified guild:',
    (Array.isArray(listed) ? listed : []).map((cmd) => `/${cmd.name}`).join(', ')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
