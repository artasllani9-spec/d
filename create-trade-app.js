const express = require('express');
const { registerRobloxAuth, getSessionUser } = require('./roblox-auth');
const {
  MAX_STORED_TRADES,
  readStore,
  writeStore,
  canPostTrade,
  createTradeId,
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

  app.get('/api/trades/posted', (req, res) => {
    const store = readStore();
    const posted = [...store.posted].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    res.json(posted);
  });

  app.post('/api/trades/posted', (req, res) => {
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

    const store = readStore();
    store.posted.unshift(trade);
    store.posted = store.posted.slice(0, MAX_STORED_TRADES);
    writeStore(store);
    res.status(201).json(trade);
  });

  app.delete('/api/trades/posted/:id', (req, res) => {
    const tradeId = Number(req.params.id);
    const userId = resolveUserId(req, req.query.userId);

    if (!userId) {
      res.status(400).json({ message: 'Missing user id.' });
      return;
    }

    const store = readStore();
    const trade = store.posted.find((item) => item.id === tradeId);
    if (!trade) {
      res.status(404).json({ message: 'Trade not found.' });
      return;
    }

    if (trade.postedBy !== userId) {
      res.status(403).json({ message: 'Not allowed to delete this trade.' });
      return;
    }

    store.posted = store.posted.filter((item) => item.id !== tradeId);
    writeStore(store);
    res.status(204).end();
  });

  app.post('/api/trades/posted/:id/accept', (req, res) => {
    const tradeId = Number(req.params.id);
    const userId = resolveUserId(req, req.body && req.body.userId);

    if (!userId) {
      res.status(400).json({ message: 'Missing user id.' });
      return;
    }

    const store = readStore();
    const tradeIndex = store.posted.findIndex((item) => item.id === tradeId);
    if (tradeIndex === -1) {
      res.status(404).json({ message: 'Trade not found.' });
      return;
    }

    const trade = store.posted[tradeIndex];
    if (trade.postedBy === userId) {
      res.status(403).json({ message: 'You cannot accept your own trade.' });
      return;
    }

    const acceptedTrade = {
      ...trade,
      acceptedAt: Date.now(),
      acceptedBy: userId,
    };

    store.posted.splice(tradeIndex, 1);
    store.accepted.unshift(acceptedTrade);
    store.accepted = store.accepted.slice(0, MAX_STORED_TRADES);
    writeStore(store);
    res.json(acceptedTrade);
  });

  app.get('/api/trades/accepted', (req, res) => {
    const userId = resolveUserId(req, req.query.userId);
    if (!userId) {
      res.status(400).json({ message: 'Missing user id.' });
      return;
    }

    const store = readStore();
    const trades = store.accepted.filter(
      (trade) => trade.postedBy === userId || trade.acceptedBy === userId,
    );

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
  });

  app.patch('/api/trades/accepted/:id', (req, res) => {
    const tradeId = Number(req.params.id);
    const { failedAt, completedAt } = req.body || {};
    const userId = resolveUserId(req, req.body && req.body.userId);

    if (!userId) {
      res.status(400).json({ message: 'Missing user id.' });
      return;
    }

    const store = readStore();
    const tradeIndex = store.accepted.findIndex((item) => item.id === tradeId);
    if (tradeIndex === -1) {
      res.status(404).json({ message: 'Trade not found.' });
      return;
    }

    const trade = store.accepted[tradeIndex];
    const isParticipant = trade.postedBy === userId || trade.acceptedBy === userId;
    if (!isParticipant) {
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

    writeStore(store);
    res.json(store.accepted[tradeIndex]);
  });

  return app;
}

module.exports = { createTradeApp };
