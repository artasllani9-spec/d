const path = require('path');
const express = require('express');
const { createTradeApp } = require('./create-trade-app');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const app = createTradeApp();

app.use(express.static(ROOT_DIR));

app.listen(PORT, () => {
  console.log(`demand.gg running at http://localhost:${PORT}`);
});
