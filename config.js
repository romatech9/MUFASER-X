// ============================================================
// MUFASER-X Configuration
// WhatsApp Multi-Account Bot by ROMA-TECH
// ============================================================
require('dotenv').config();

module.exports = {
  botName: 'MUFASER-X',
  developer: 'ROMA-TECH',
  version: '1.0.0',
  prefix: '.',
  port: process.env.PORT || 3000,
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  sessionId: process.env.SESSION_ID || '',
  sessionsDir: './sessions',
  autoReconnect: true
};
