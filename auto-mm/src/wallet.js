const ecc = require('@bitcoinerlab/secp256k1');
const { BIP32Factory } = require('bip32');
const bip39 = require('bip39');
const bitcoin = require('bitcoinjs-lib');
const { derivePath } = require('ed25519-hd-key');
const { HDNodeWallet } = require('ethers');
const { Keypair } = require('@solana/web3.js');
const config = require('./config');
const { getAsset } = require('./assets');

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const LITECOIN = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

let seed;
let utxoRoot;
let phrase;

function load() {
  if (seed) return;
  phrase = config.mnemonic.normalize('NFKD').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!bip39.validateMnemonic(phrase)) {
    const error = new Error(
      'WALLET_MNEMONIC is not a valid 12 or 24 word recovery phrase. Check the words and spaces in .env, then save the file as UTF-8.'
    );
    error.public = true;
    throw error;
  }
  seed = bip39.mnemonicToSeedSync(phrase);
  utxoRoot = bip32.fromSeed(seed);
}

function networkFor(assetKey) {
  return assetKey === 'LTC' ? LITECOIN : bitcoin.networks.bitcoin;
}

function utxoNode(assetKey, index) {
  load();
  const path = assetKey === 'LTC' ? `m/84'/2'/0'/0/${index}` : `m/84'/0'/0'/0/${index}`;
  return utxoRoot.derivePath(path);
}

function utxoPayment(assetKey, index) {
  const node = utxoNode(assetKey, index);
  return bitcoin.payments.p2wpkh({
    pubkey: node.publicKey,
    network: networkFor(assetKey),
  });
}

function evmWallet(index) {
  load();
  return HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${index}`);
}

function solanaKeypair(index) {
  load();
  const derived = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex'));
  return Keypair.fromSeed(derived.key);
}

function address(assetKey, index) {
  const asset = getAsset(assetKey);
  if (asset.family === 'btc' || asset.family === 'ltc') return utxoPayment(assetKey, index).address;
  if (asset.family === 'evm') return evmWallet(index).address;
  return solanaKeypair(index).publicKey.toBase58();
}

module.exports = {
  LITECOIN,
  load,
  networkFor,
  utxoNode,
  utxoPayment,
  evmWallet,
  solanaKeypair,
  address,
};
