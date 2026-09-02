// ============================================================
// MUFASER-X — PUBLIC BOT CONFIG
// WhatsApp Multi-Device Bot by ROMA-TECH
// ============================================================

require('dotenv').config();

module.exports = {
  botName: 'MUFASER-X',
  developer: 'ROMA-TECH',
  version: '1.0.0',

  prefix: '.',

  port: process.env.PORT || 3000,

  ownerNumber: String(
    process.env.OWNER_NUMBER || ''
  ).replace(/\D/g, ''),

  // Session ID supplied through Render Environment Variables
  sessionId: process.env.SESSION_ID || '',

  // Private MUFASER-X server
  privateServerUrl:
    process.env.PRIVATE_SERVER_URL || '',

  // Private server authentication
  privateApiKey:
    process.env.PRIVATE_API_KEY || '',

  sessionsDir: './sessions',

  autoReconnect: true
};