require('dotenv').config({
  path: '.env'
});

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// ============================================================
// MUFASER-X — CONFIG
// ============================================================

// ------------------------------------------------------------
// Load env files
// ------------------------------------------------------------

const envFiles = [
  path.join(__dirname, '.env'),
  path.join(__dirname, 'env'),
  path.join(__dirname, 'session.env'),
  path.join(__dirname, 'config.env'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'env')
];

for (const file of envFiles) {

  if (!fs.existsSync(file)) {
    continue;
  }

  try {

    dotenv.config({
      path: file,
      override: false
    });

    console.log(
      `[CONFIG] ✅ Loaded ${file}`
    );

  } catch (error) {

    console.error(
      `[CONFIG] ❌ Failed loading ${file}:`,
      error.message
    );

  }

}

// ============================================================
// VALUES
// ============================================================

const sessionId =
  String(
    process.env.SESSION_ID || ''
  ).trim();

const ownerNumber =
  String(
    process.env.OWNER_NUMBER || ''
  )
    .replace(/\D/g, '');

const port =
  process.env.PORT ||
  3000;

// ============================================================
// SESSION CHECK
// ============================================================

console.log('');
console.log('============================================');
console.log('       MUFASER-X CONFIG CHECK');
console.log('============================================');

console.log(
  '[CONFIG] SESSION_ID:',
  sessionId
    ? 'FOUND ✅'
    : 'NOT FOUND ❌'
);

console.log(
  '[CONFIG] OWNER_NUMBER:',
  ownerNumber
    ? 'FOUND ✅'
    : 'EMPTY'
);

console.log(
  '[CONFIG] PORT:',
  port
);

console.log('============================================');
console.log('');

module.exports = {

  botName: 'MUFASER-X',

  developer: 'ROMA-TECH',

  version: '1.0.0',

  prefix: '.',

  port,

  ownerNumber,

  sessionId,

  privateServerUrl:
  'https://mufaser-x-nje7.onrender.com',

privateApiKey:
  'MFX_BRIDGE_9K7X2P4Q8N6R1T5Y_PRIVATE_2026',

  sessionsDir:
    './sessions',

  autoReconnect:
    true

};