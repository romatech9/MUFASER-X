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

  sessionId: String(
    process.env.SESSION_ID || ''
  ).trim(),

  privateServerUrl:
    String(
      process.env.PRIVATE_SERVER_URL || ''
    ).trim(),

  privateApiKey:
    String(
      process.env.PRIVATE_API_KEY || ''
    ).trim(),

  sessionsDir: './sessions',

  autoReconnect: true
};