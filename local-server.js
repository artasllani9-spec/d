const path = require('path');
const express = require('express');
const { createTradeApp } = require('./create-trade-app');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const app = createTradeApp();

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`demand.gg running at http://localhost:${PORT}`);
});
