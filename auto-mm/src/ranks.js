const { PermissionFlagsBits } = require('discord.js');
const flow = require('./flow');

const DEAL_ROLE = '1561507422001045615';
const DEAL_ROLE_NAME = 'Client';

const NO_BADGE_COLOR = 0x99aab5;

const TIERS = [
  { cents: 10000000n, roleId: '1561508920369877083', name: 'Dragon Client', color: 0x1f8b4c },
  { cents: 5000000n, roleId: '1561508777251962900', name: 'Whale Client', color: 0x3498db },
  { cents: 2500000n, roleId: '1561506536822677516', name: 'Shark Client', color: 0x206694 },
  { cents: 1000000n, roleId: '1561506550919471174', name: 'Diamond Client', color: 0x68a4a8 },
  { cents: 500000n, roleId: '1561506557789868062', name: 'Gold Client', color: 0xc27c0e },
  { cents: 250000n, roleId: '1561506564815331408', name: 'Silver Client', color: 0xc7c7c7 },
  { cents: 100000n, roleId: '1561506571018829835', name: 'Bronze Client', color: 0xa84300 },
];

const MANAGED = [DEAL_ROLE, ...TIERS.map((tier) => tier.roleId)];

function rolesFor(stats) {
  if (!stats || (stats.completed < 1 && stats.cents <= 0n)) return [];
  const roles = [DEAL_ROLE];
  const badge = TIERS.find((tier) => stats.cents >= tier.cents);
  if (badge) roles.push(badge.roleId);
  return roles;
}

function roleName(roleId) {
  if (roleId === DEAL_ROLE) return DEAL_ROLE_NAME;
  return TIERS.find((tier) => tier.roleId === roleId)?.name || null;
}

function badgeColor(roleId) {
  return TIERS.find((tier) => tier.roleId === roleId)?.color ?? NO_BADGE_COLOR;
}

function topRole(stats) {
  const roles = rolesFor(stats);
  if (roles.length > 1) return roles[1];
  return roles[0] || null;
}

function rankList() {
  return [
    { roleId: DEAL_ROLE },
    ...[...TIERS].reverse().map((tier) => ({ roleId: tier.roleId, cents: tier.cents })),
  ];
}

function nextRole(stats) {
  const cents = stats?.cents || 0n;
  let next = null;
  for (const tier of TIERS) {
    if (tier.cents > cents) next = tier;
  }
  if (!next) return null;
  return { roleId: next.roleId, left: next.cents - cents };
}

async function ranksGuild(client) {
  for (const guild of client.guilds.cache.values()) {
    await guild.roles.fetch().catch(() => null);
    if (guild.roles.cache.has(DEAL_ROLE)) return guild;
  }
  return null;
}

async function apply(guild, person) {
  const member = await guild.members.fetch(person.id).catch(() => null);
  if (!member) return false;
  const want = new Set(rolesFor(person));
  const add = [...want].filter((roleId) => guild.roles.cache.has(roleId) && !member.roles.cache.has(roleId));
  const remove = MANAGED.filter((roleId) => member.roles.cache.has(roleId) && !want.has(roleId));
  if (!add.length && !remove.length) return false;
  if (add.length) await member.roles.add(add);
  if (remove.length) await member.roles.remove(remove);
  return true;
}

async function sync(client, userIds) {
  const guild = await ranksGuild(client);
  if (!guild) {
    console.error('[ranks] The client roles are not in a server this bot can see.');
    return;
  }
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.error('[ranks] Give the bot Manage Roles, and put its role above the client roles.');
    return;
  }
  const people = userIds
    ? userIds.map((id) => ({ id: String(id), ...flow.userStats(id) })).filter((person) => person.completed > 0)
    : flow.clients();
  let updated = 0;
  for (const person of people) {
    try {
      if (await apply(guild, person)) updated += 1;
    } catch (error) {
      console.error('[ranks] Could not update a client role. Put the bot role above the client roles.', error.message);
    }
  }
  if (!userIds) console.log(`[ranks] checked ${people.length} clients, updated ${updated}`);
}

module.exports = { rolesFor, roleName, badgeColor, topRole, nextRole, rankList, sync, DEAL_ROLE, TIERS };
