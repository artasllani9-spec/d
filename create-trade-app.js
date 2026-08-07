const express = require('express');
const { registerRobloxAuth, getSessionUser } = require('./roblox-auth');
const {
  MAX_STORED_TRADES,
  readStore,
  writeStore,
  canPostTrade,
  createTradeId,
  isTradeParticipant,
} = require('./trade-store');

function resolveUserId(req, fallbackId) {
  const sessionUser = getSessionUser(req);
  if (sessionUser && sessionUser.id) return String(sessionUser.id);
  if (fallbackId == null || fallbackId === '') return null;
  return String(fallbackId);
}

function createTradeApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  registerRobloxAuth(app);

  app.get('/api/trades/posted', async (req, res) => {
    try {
      const store = await readStore();
      let posted = [...store.posted].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
      const userId = req.query.userId ? String(req.query.userId) : '';
      if (userId) {
        posted = posted.filter((trade) => String(trade.postedBy) === userId);
      }
      res.json(posted);
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not load trades.' });
    }
  });

  app.post('/api/trades/posted', async (req, res) => {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
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
        postedBy: String(sessionUser.id),
        offerer: sessionUser.username || sessionUser.name || 'Player',
        offererAvatar: sessionUser.avatarUrl || sessionUser.picture || null,
        offererProfile: sessionUser.profile || null,
        yourSide,
        theirSide,
      };

      const store = await readStore();
      store.posted.unshift(trade);
      store.posted = store.posted.slice(0, MAX_STORED_TRADES);
      await writeStore(store);
      res.status(201).json(trade);
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not post trade.' });
    }
  });

  app.delete('/api/trades/posted/:id', async (req, res) => {
    try {
      const tradeId = Number(req.params.id);
      const userId = resolveUserId(req, req.query.userId);

      if (!userId) {
        res.status(400).json({ message: 'Missing user id.' });
        return;
      }

      const store = await readStore();
      const trade = store.posted.find((item) => item.id === tradeId);
      if (!trade) {
        res.status(404).json({ message: 'Trade not found.' });
        return;
      }

      if (String(trade.postedBy) !== String(userId)) {
        res.status(403).json({ message: 'Not allowed to delete this trade.' });
        return;
      }

      store.posted = store.posted.filter((item) => item.id !== tradeId);
      await writeStore(store);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not delete trade.' });
    }
  });

  app.post('/api/trades/posted/:id/accept', async (req, res) => {
    try {
      const tradeId = Number(req.params.id);
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        res.status(401).json({ message: 'Log in with Roblox to accept a trade.' });
        return;
      }

      const userId = String(sessionUser.id);
      const store = await readStore();
      const tradeIndex = store.posted.findIndex((item) => item.id === tradeId);
      if (tradeIndex === -1) {
        res.status(404).json({ message: 'Trade not found.' });
        return;
      }

      const trade = store.posted[tradeIndex];
      if (String(trade.postedBy) === userId) {
        res.status(403).json({ message: 'You cannot accept your own trade.' });
        return;
      }

      const acceptedTrade = {
        ...trade,
        postedBy: String(trade.postedBy),
        acceptedAt: Date.now(),
        acceptedBy: userId,
      };

      store.posted.splice(tradeIndex, 1);
      store.accepted.unshift(acceptedTrade);
      store.accepted = store.accepted.slice(0, MAX_STORED_TRADES);
      await writeStore(store);
      res.json(acceptedTrade);
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not accept trade.' });
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
        return (b.acceptedAt || b.postedAt) - (a.acceptedAt || a.postedAt);
      });

      res.json(trades);
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not load accepted trades.' });
    }
  });

  app.patch('/api/trades/accepted/:id', async (req, res) => {
    try {
      const tradeId = Number(req.params.id);
      const { failedAt, completedAt } = req.body || {};
      const userId = resolveUserId(req, req.body && req.body.userId);

      if (!userId) {
        res.status(400).json({ message: 'Missing user id.' });
        return;
      }

      const store = await readStore();
      const tradeIndex = store.accepted.findIndex((item) => item.id === tradeId);
      if (tradeIndex === -1) {
        res.status(404).json({ message: 'Trade not found.' });
        return;
      }

      const trade = store.accepted[tradeIndex];
      if (!isTradeParticipant(trade, userId)) {
        res.status(403).json({ message: 'Not allowed to update this trade.' });
        return;
      }

      if (trade.failedAt || trade.completedAt) {
        res.status(400).json({ message: 'Trade is already closed.' });
        return;
      }

      if (failedAt) {
        store.accepted[tradeIndex] = {
          ...trade,
          failedAt: Date.now(),
          failedBy: userId,
        };
      } else if (completedAt) {
        store.accepted[tradeIndex] = {
          ...trade,
          completedAt: Date.now(),
          completedBy: userId,
        };
      } else {
        res.status(400).json({ message: 'No update specified.' });
        return;
      }

      await writeStore(store);
      res.json(store.accepted[tradeIndex]);
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not update trade.' });
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
      });
    } catch (error) {
      res.status(500).json({ message: error.message || 'Could not load profile.' });
    }
  });

  return app;
}

module.exports = { createTradeApp };
