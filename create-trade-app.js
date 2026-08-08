const express = require('express');
const { registerRobloxAuth, getSessionUser } = require('./roblox-auth');
const {
  MAX_STORED_TRADES,
  SITE_OWNER_ID,
  readStore,
  updateStore,
  httpError,
  canPostTrade,
  createTradeId,
  isTradeParticipant,
  isSiteOwner,
  isSiteModerator,
  isBannedUser,
  getBanRecord,
  hasUserBlocked,
  getBlockedIdsForUser,
} = require('./trade-store');

function resolveUserId(req, fallbackId) {
  const sessionUser = getSessionUser(req);
  if (sessionUser && sessionUser.id) return String(sessionUser.id);
  if (fallbackId == null || fallbackId === '') return null;
  return String(fallbackId);
}

function normalizeRobloxId(value) {
  const id = String(value || '').trim();
  if (!id || !/^\d+$/.test(id)) return null;
  return id;
}

function sendError(res, error, fallbackMessage) {
  const status = Number(error && error.status) || 500;
  const payload = { message: (error && error.message) || fallbackMessage };
  if (error && error.banned) payload.banned = true;
  if (error && error.code) payload.code = error.code;
  res.status(status).json(payload);
}

async function fetchRobloxUsername(userId) {
  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.name || data.displayName || null;
  } catch {
    return null;
  }
}

async function enrichModerators(moderatorIds) {
  const ids = (Array.isArray(moderatorIds) ? moderatorIds : [])
    .map((id) => String(id))
    .filter((id) => id && id !== SITE_OWNER_ID);

  return Promise.all(ids.map(async (id) => {
    const username = await fetchRobloxUsername(id);
    return {
      id,
      username: username || null,
    };
  }));
}

async function rejectIfBanned(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) return { sessionUser: null, store: null, banned: false };
  const store = await readStore();
  if (isBannedUser(store, sessionUser.id)) {
    res.status(403).json({ message: 'You are banned from demand.gg.', banned: true });
    return { sessionUser, store, banned: true };
  }
  return { sessionUser, store, banned: false };
}

function createTradeApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  registerRobloxAuth(app);

  app.get('/api/moderation/moderators', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser || !isSiteOwner(sessionUser.id)) {
        res.status(403).json({ message: 'Only the site owner can manage moderators.' });
        return;
      }

      const store = await readStore();
      res.json({
        ownerId: SITE_OWNER_ID,
        moderators: await enrichModerators(store.moderators),
      });
    } catch (error) {
      sendError(res, error, 'Could not load moderators.');
    }
  });

  app.post('/api/moderation/moderators', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser || !isSiteOwner(sessionUser.id)) {
        res.status(403).json({ message: 'Only the site owner can add moderators.' });
        return;
      }

      const userId = normalizeRobloxId(req.body && req.body.userId);
      if (!userId) {
        res.status(400).json({ message: 'Enter a valid Roblox user ID.' });
        return;
      }

      if (isSiteOwner(userId)) {
        res.status(400).json({ message: 'The site owner already has full access.' });
        return;
      }

      const { store } = await updateStore((draft) => {
        if (draft.moderators.includes(userId)) {
          throw httpError(400, 'That user is already a site moderator.');
        }
        draft.moderators.push(userId);
      });

      const moderators = await enrichModerators(store.moderators);
      const added = moderators.find((item) => item.id === userId) || { id: userId, username: null };
      res.status(201).json({
        moderators,
        added,
      });
    } catch (error) {
      sendError(res, error, 'Could not add moderator.');
    }
  });

  app.delete('/api/moderation/moderators/:id', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser || !isSiteOwner(sessionUser.id)) {
        res.status(403).json({ message: 'Only the site owner can remove moderators.' });
        return;
      }

      const userId = normalizeRobloxId(req.params.id);
      if (!userId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      const { store } = await updateStore((draft) => {
        draft.moderators = draft.moderators.filter((id) => String(id) !== userId);
      });
      res.json({
        moderators: await enrichModerators(store.moderators),
      });
    } catch (error) {
      sendError(res, error, 'Could not remove moderator.');
    }
  });

  app.post('/api/moderation/bans', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to ban users.' });
        return;
      }

      const userId = normalizeRobloxId(req.body && req.body.userId);
      if (!userId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      if (isSiteOwner(userId)) {
        res.status(403).json({ message: 'You cannot ban the site owner.' });
        return;
      }

      if (String(userId) === String(sessionUser.id)) {
        res.status(400).json({ message: 'You cannot ban yourself.' });
        return;
      }

      const { result: ban } = await updateStore((draft) => {
        if (!isSiteModerator(draft, sessionUser.id)) {
          throw httpError(403, 'Only site moderators can ban users.');
        }
        if (isSiteModerator(draft, userId) && !isSiteOwner(sessionUser.id)) {
          throw httpError(403, 'Moderators cannot ban other moderators.');
        }
        if (isBannedUser(draft, userId)) {
          throw httpError(400, 'That user is already banned.');
        }

        const nextBan = {
          userId,
          bannedBy: String(sessionUser.id),
          bannedAt: Date.now(),
        };
        draft.bans.unshift(nextBan);
        return nextBan;
      });

      res.status(201).json({ ban });
    } catch (error) {
      sendError(res, error, 'Could not ban user.');
    }
  });

  app.delete('/api/moderation/bans/:id', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to unban users.' });
        return;
      }

      const userId = normalizeRobloxId(req.params.id);
      if (!userId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      await updateStore((draft) => {
        if (!isSiteModerator(draft, sessionUser.id)) {
          throw httpError(403, 'Only site moderators can unban users.');
        }
        if (!isBannedUser(draft, userId)) {
          throw httpError(404, 'That user is not banned.');
        }
        draft.bans = draft.bans.filter((ban) => String(ban.userId) !== userId);
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error, 'Could not unban user.');
    }
  });

  app.get('/api/moderation/blocks', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to view blocked users.' });
        return;
      }

      const store = await readStore();
      res.json({
        blockedIds: getBlockedIdsForUser(store, sessionUser.id),
      });
    } catch (error) {
      sendError(res, error, 'Could not load blocks.');
    }
  });

  app.post('/api/moderation/blocks', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to block users.' });
        return;
      }

      const userId = normalizeRobloxId(req.body && req.body.userId);
      if (!userId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      if (String(userId) === String(sessionUser.id)) {
        res.status(400).json({ message: 'You cannot block yourself.' });
        return;
      }

      const { result: block } = await updateStore((draft) => {
        if (hasUserBlocked(draft, sessionUser.id, userId)) {
          throw httpError(400, 'That user is already blocked.');
        }
        const nextBlock = {
          blockerId: String(sessionUser.id),
          blockedId: userId,
          blockedAt: Date.now(),
        };
        draft.blocks.unshift(nextBlock);
        return nextBlock;
      });
      res.status(201).json({ block });
    } catch (error) {
      sendError(res, error, 'Could not block user.');
    }
  });

  app.delete('/api/moderation/blocks/:id', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to unblock users.' });
        return;
      }

      const userId = normalizeRobloxId(req.params.id);
      if (!userId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      await updateStore((draft) => {
        if (!hasUserBlocked(draft, sessionUser.id, userId)) {
          throw httpError(404, 'That user is not blocked.');
        }
        draft.blocks = draft.blocks.filter(
          (block) => !(
            String(block.blockerId) === String(sessionUser.id) &&
            String(block.blockedId) === userId
          ),
        );
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error, 'Could not unblock user.');
    }
  });

  app.get('/api/moderation/reports', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to view reports.' });
        return;
      }

      const store = await readStore();
      if (!isSiteModerator(store, sessionUser.id)) {
        res.status(403).json({ message: 'Only site moderators can view reports.' });
        return;
      }

      res.json({
        reports: [...store.reports].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      });
    } catch (error) {
      sendError(res, error, 'Could not load reports.');
    }
  });

  app.post('/api/moderation/reports', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in to report users.' });
        return;
      }

      const reportedId = normalizeRobloxId(req.body && req.body.userId);
      const reason = String((req.body && req.body.reason) || '').trim();
      if (!reportedId) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }
      if (!reason) {
        res.status(400).json({ message: 'Enter a reason for the report.' });
        return;
      }
      if (reason.length > 1000) {
        res.status(400).json({ message: 'Report reason is too long.' });
        return;
      }
      if (String(reportedId) === String(sessionUser.id)) {
        res.status(400).json({ message: 'You cannot report yourself.' });
        return;
      }

      let reportedUsername = req.body && req.body.username
        ? String(req.body.username).trim()
        : null;
      if (!reportedUsername) {
        reportedUsername = await fetchRobloxUsername(reportedId);
      }

      const { result: report } = await updateStore((draft) => {
        const nextReport = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          reporterId: String(sessionUser.id),
          reporterUsername: sessionUser.username || sessionUser.name || null,
          reportedId,
          reportedUsername,
          reason,
          createdAt: Date.now(),
        };
        draft.reports.unshift(nextReport);
        draft.reports = draft.reports.slice(0, 500);
        return nextReport;
      });
      res.status(201).json({ report });
    } catch (error) {
      sendError(res, error, 'Could not submit report.');
    }
  });

  app.get('/api/trades/posted', async (req, res) => {
    try {
      const store = await readStore();
      let posted = [...store.posted].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
      const userId = req.query.userId ? String(req.query.userId) : '';
      if (userId) {
        posted = posted.filter((trade) => String(trade.postedBy) === userId);
      } else {
        const sessionUser = getSessionUser(req);
        if (sessionUser) {
          const blockedIds = new Set(getBlockedIdsForUser(store, sessionUser.id));
          if (blockedIds.size) {
            posted = posted.filter((trade) => !blockedIds.has(String(trade.postedBy)));
          }
        }
      }
      res.set('Cache-Control', 'private, no-store');
      res.json(posted);
    } catch (error) {
      sendError(res, error, 'Could not load trades.');
    }
  });

  app.post('/api/trades/posted', async (req, res) => {
    try {
      const access = await rejectIfBanned(req, res);
      if (access.banned) return;
      if (!access.sessionUser) {
        res.status(401).json({ message: 'Log in with Roblox to post a trade.' });
        return;
      }

      const { yourSide = [], theirSide = [] } = req.body || {};

      if (!canPostTrade(yourSide, theirSide)) {
        res.status(400).json({ message: 'Invalid trade sides.' });
        return;
      }

      const trade = {
        id: createTradeId(),
        postedAt: Date.now(),
        postedBy: String(access.sessionUser.id),
        offerer: access.sessionUser.username || access.sessionUser.name || 'Player',
        offererAvatar: access.sessionUser.avatarUrl || access.sessionUser.picture || null,
        offererProfile: access.sessionUser.profile || null,
        yourSide,
        theirSide,
      };

      await updateStore((draft) => {
        draft.posted.unshift(trade);
        draft.posted = draft.posted.slice(0, MAX_STORED_TRADES);
      });
      res.status(201).json(trade);
    } catch (error) {
      sendError(res, error, 'Could not post trade.');
    }
  });

  app.delete('/api/trades/posted/:id', async (req, res) => {
    try {
      const access = await rejectIfBanned(req, res);
      if (access.banned) return;

      const tradeId = Number(req.params.id);
      const sessionUser = access.sessionUser || getSessionUser(req);
      const userId = sessionUser && sessionUser.id
        ? String(sessionUser.id)
        : resolveUserId(req, req.query.userId);

      if (!userId) {
        res.status(400).json({ message: 'Missing user id.' });
        return;
      }

      await updateStore((draft) => {
        const trade = draft.posted.find((item) => item.id === tradeId);
        if (!trade) {
          throw httpError(404, 'Trade not found.');
        }

        const isPoster = String(trade.postedBy) === String(userId);
        const isModerator = isSiteModerator(draft, userId);
        if (!isPoster && !isModerator) {
          throw httpError(403, 'Not allowed to delete this trade.');
        }

        draft.posted = draft.posted.filter((item) => item.id !== tradeId);
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error, 'Could not delete trade.');
    }
  });

  app.post('/api/trades/posted/:id/accept', async (req, res) => {
    try {
      const access = await rejectIfBanned(req, res);
      if (access.banned) return;
      if (!access.sessionUser) {
        res.status(401).json({ message: 'Log in with Roblox to accept a trade.' });
        return;
      }

      const tradeId = Number(req.params.id);
      const userId = String(access.sessionUser.id);

      const { result: acceptedTrade } = await updateStore((draft) => {
        const tradeIndex = draft.posted.findIndex((item) => item.id === tradeId);
        if (tradeIndex === -1) {
          throw httpError(404, 'Trade not found.');
        }

        const trade = draft.posted[tradeIndex];
        if (String(trade.postedBy) === userId) {
          throw httpError(403, 'You cannot accept your own trade.');
        }

        if (hasUserBlocked(draft, trade.postedBy, userId)) {
          throw httpError(403, 'You cannot accept this trade.');
        }

        if (hasUserBlocked(draft, userId, trade.postedBy)) {
          throw httpError(403, 'You blocked this user. Unblock them to accept their trades.');
        }

        const nextAccepted = {
          ...trade,
          postedBy: String(trade.postedBy),
          acceptedAt: Date.now(),
          acceptedBy: userId,
          accepterUsername: access.sessionUser.username || access.sessionUser.name || 'Player',
          accepterAvatar: access.sessionUser.avatarUrl || access.sessionUser.picture || null,
          accepterProfile: access.sessionUser.profile || null,
        };

        draft.posted.splice(tradeIndex, 1);
        draft.accepted.unshift(nextAccepted);
        draft.accepted = draft.accepted.slice(0, MAX_STORED_TRADES);
        return nextAccepted;
      });

      res.json(acceptedTrade);
    } catch (error) {
      sendError(res, error, 'Could not accept trade.');
    }
  });

  app.get('/api/trades/accepted', async (req, res) => {
    try {
      const userId = resolveUserId(req, req.query.userId);
      if (!userId) {
        res.status(400).json({ message: 'Missing user id.' });
        return;
      }

      const store = await readStore();
      const trades = store.accepted.filter((trade) => isTradeParticipant(trade, userId));

      trades.sort((a, b) => {
        const rank = (trade) => {
          if (trade.failedAt) return 2;
          if (trade.completedAt) return 1;
          return 0;
        };
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) return rankDiff;
        return (b.acceptedAt || b.postedAt) - (a.acceptedAt || a.postedAt || 0);
      });

      res.set('Cache-Control', 'private, no-store');
      res.json(trades);
    } catch (error) {
      sendError(res, error, 'Could not load accepted trades.');
    }
  });

  app.patch('/api/trades/accepted/:id', async (req, res) => {
    try {
      const access = await rejectIfBanned(req, res);
      if (access.banned) return;

      const tradeId = Number(req.params.id);
      const { failedAt, completedAt } = req.body || {};
      const userId = resolveUserId(req, req.body && req.body.userId);

      if (!userId) {
        res.status(400).json({ message: 'Missing user id.' });
        return;
      }

      if (!failedAt && !completedAt) {
        res.status(400).json({ message: 'No update specified.' });
        return;
      }

      const { result: updated } = await updateStore((draft) => {
        const tradeIndex = draft.accepted.findIndex((item) => item.id === tradeId);
        if (tradeIndex === -1) {
          throw httpError(404, 'Trade not found.');
        }

        const trade = draft.accepted[tradeIndex];
        if (!isTradeParticipant(trade, userId)) {
          throw httpError(403, 'Not allowed to update this trade.');
        }

        if (trade.failedAt || trade.completedAt) {
          throw httpError(400, 'Trade is already closed.');
        }

        if (failedAt) {
          draft.accepted[tradeIndex] = {
            ...trade,
            failedAt: Date.now(),
            failedBy: userId,
          };
        } else {
          draft.accepted[tradeIndex] = {
            ...trade,
            completedAt: Date.now(),
            completedBy: userId,
          };
        }

        return draft.accepted[tradeIndex];
      });

      res.json(updated);
    } catch (error) {
      sendError(res, error, 'Could not update trade.');
    }
  });

  app.get('/api/users/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id || !/^\d+$/.test(id)) {
        res.status(400).json({ message: 'Invalid user id.' });
        return;
      }

      const store = await readStore();
      const relatedTrades = [...store.posted, ...store.accepted].filter(
        (trade) => String(trade.postedBy) === id,
      );
      relatedTrades.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
      const latest = relatedTrades[0] || null;

      let username = latest?.offerer || null;
      let avatarUrl = latest?.offererAvatar || null;

      try {
        const robloxResponse = await fetch(`https://users.roblox.com/v1/users/${id}`);
        if (robloxResponse.ok) {
          const data = await robloxResponse.json();
          username = data.name || data.displayName || username;
        }
      } catch {
        // Keep trade-derived username if Roblox lookup fails.
      }

      if (!avatarUrl) {
        avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(id)}&width=150&height=150&format=png`;
      }

      const sessionUser = getSessionUser(req);
      const viewerIsModerator = sessionUser ? isSiteModerator(store, sessionUser.id) : false;
      const ban = getBanRecord(store, id);
      const blockedByViewer = sessionUser
        ? hasUserBlocked(store, sessionUser.id, id)
        : false;

      res.set('Cache-Control', 'private, no-store');
      res.json({
        user: {
          id,
          username: username || 'Player',
          name: username || 'Player',
          avatarUrl,
          picture: avatarUrl,
          profile: `https://www.roblox.com/users/${encodeURIComponent(id)}/profile`,
        },
        stats: {
          posted: relatedTrades.length,
          completed: store.accepted.filter(
            (trade) => (
              (String(trade.postedBy) === id || String(trade.acceptedBy) === id) &&
              Boolean(trade.completedAt)
            ),
          ).length,
          failed: store.accepted.filter(
            (trade) => (
              (String(trade.postedBy) === id || String(trade.acceptedBy) === id) &&
              Boolean(trade.failedAt)
            ),
          ).length,
        },
        relationship: sessionUser
          ? {
              blockedByViewer,
              isSelf: String(sessionUser.id) === String(id),
            }
          : null,
        moderation: viewerIsModerator
          ? {
              isBanned: Boolean(ban),
              isOwner: isSiteOwner(id),
              isModerator: isSiteModerator(store, id),
              ban: ban || null,
            }
          : null,
      });
    } catch (error) {
      sendError(res, error, 'Could not load profile.');
    }
  });

  return app;
}

module.exports = { createTradeApp };
