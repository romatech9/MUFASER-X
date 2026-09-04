// MUFASER-X — PUBLIC LAUNCHER - FAST VERSION by ROMA-TECH
// Fixed for slow commands
require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const { Boom } = require('@hapi/boom');
const http = require('http');
const https = require('https');

const config = require('./config');
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const logger = pino({ level: 'silent' });
let sock = null;
let reconnectTimer = null;
let isStarting = false;
let activeSession = null;

// FAST AXIOS - KeepAlive + low timeout
const axiosInstance = axios.create({
  timeout: 8000,
  headers: {
    'x-api-key': config.privateApiKey,
    'Content-Type': 'application/json'
  },
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

function getSessionsRoot() { return path.resolve(config.sessionsDir || './sessions'); }
function localSessionExists(sessionDir) {
  if (!sessionDir) return false;
  return fs.existsSync(sessionDir) && fs.existsSync(path.join(sessionDir, 'creds.json'));
}
function cleanSessionId(sessionId) {
  let raw = String(sessionId || '').trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('`') && raw.endsWith('`'))) {
    raw = raw.slice(1, -1).trim();
  }
  raw = raw.replace(/^MUFASER-X\s*:\s*~/i, '').replace(/\s+/g, '');
  return raw;
}
function isProbablyBase64(value) {
  if (!value) return false;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  if (/^[A-Za-z0-9_-]+$/.test(value)) return true;
  return false;
}
function decodeSessionPayload(sessionId) {
  const raw = cleanSessionId(sessionId);
  if (!raw) throw new Error('SESSION_ID is empty.');
  if (!isProbablyBase64(raw)) throw new Error('SESSION_ID invalid Base64');
  let base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4!== 0) base64 += '=';
  let decoded;
  try { decoded = Buffer.from(base64, 'base64'); } catch (e) { throw new Error(`Base64 fail: ${e.message}`); }
  if (!decoded || decoded.length === 0) throw new Error('Empty data');
  const isGzip = decoded.length >= 2 && decoded[0] === 0x1f && decoded[1] === 0x8b;
  let payloadText = '';
  if (isGzip) {
    try { payloadText = zlib.gunzipSync(decoded).toString('utf8'); } catch (e) { throw new Error(`GZIP fail: ${e.message}`); }
  } else { payloadText = decoded.toString('utf8'); }
  if (!payloadText) throw new Error('Empty session data');
  let payload;
  try { payload = JSON.parse(payloadText); } catch (e) { throw new Error('Invalid session JSON'); }
  return payload;
}
function restoreSessionId(sessionId) {
  if (!sessionId) throw new Error('SESSION_ID missing');
  const payload = decodeSessionPayload(sessionId);
  if (!payload || payload.format!== 'MUFASER-X-SESSION') throw new Error('Invalid format');
  if (!Array.isArray(payload.files) || payload.files.length === 0) throw new Error('No auth files');
  const restoredPhone = String(payload.phone || '').replace(/\D/g, '');
  if (!restoredPhone) throw new Error('No phone in SESSION_ID');
  const sessionsRoot = getSessionsRoot();
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const restoredDir = path.join(sessionsRoot, restoredPhone);
  fs.mkdirSync(restoredDir, { recursive: true });
  const root = path.resolve(restoredDir) + path.sep;
  let restoredFiles = 0;
  for (const file of payload.files) {
    if (!file || typeof file.path!== 'string' || typeof file.data!== 'string') continue;
    if (path.isAbsolute(file.path)) continue;
    const target = path.resolve(restoredDir, file.path);
    if (!target.startsWith(root)) continue;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(file.data, 'base64'));
      restoredFiles++;
    } catch {}
  }
  if (restoredFiles === 0) throw new Error('No usable files');
  if (!fs.existsSync(path.join(restoredDir, 'creds.json'))) throw new Error('creds.json not restored');
  console.log(`[Session] RESTORED ${restoredPhone} - ${restoredFiles} files`);
  return { phone: restoredPhone, sessionDir: restoredDir };
}
async function privateRequest(method, endpoint, data = {}) {
  if (!config.privateServerUrl) throw new Error('PRIVATE_SERVER_URL missing');
  const url = config.privateServerUrl.replace(/\/+$/, '') + endpoint;
  const response = await axiosInstance({ method, url, data });
  return response.data;
}
function prepareSession() {
  const sessionsRoot = getSessionsRoot();
  fs.mkdirSync(sessionsRoot, { recursive: true });
  if (activeSession && activeSession.phone && activeSession.sessionDir && localSessionExists(activeSession.sessionDir)) {
    return activeSession;
  }
  let sessionId = String(config.sessionId || '').trim();
  if (!sessionId) {
    const possibleFiles = [path.join(__dirname, 'env'), path.join(__dirname, '.env'), path.join(process.cwd(), 'env'), path.join(process.cwd(), '.env')];
    for (const envPath of possibleFiles) {
      if (!fs.existsSync(envPath)) continue;
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^SESSION_ID\s*=\s*(.+)$/m);
        if (match && match[1]) { sessionId = match[1].trim(); break; }
      } catch {}
    }
  }
  if (!sessionId) throw new Error('SESSION_ID not found');
  const restored = restoreSessionId(sessionId);
  activeSession = restored;
  return restored;
}

async function startBot() {
  if (isStarting) return;
  if (sock && sock.user) return;
  isStarting = true;
  console.log('=== MUFASER-X PUBLIC LAUNCHER FAST ===');
  let restored;
  try { restored = prepareSession(); } catch (error) {
    isStarting = false;
    console.error('[Session] Fail:', error.message);
    return;
  }
  const { phone, sessionDir } = restored;
  let state, saveCreds;
  try {
    const auth = await useMultiFileAuthState(sessionDir);
    state = auth.state;
    saveCreds = auth.saveCreds;
  } catch (error) {
    isStarting = false;
    console.error('[Auth] Fail:', error.message);
    return;
  }

  // FIXED VERSION - No fetchLatestBaileysVersion to save 1 sec
  const version = [2, 3000, 1017546695];

  try {
    sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false, // FAST - was true
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 10000,
      keepAliveIntervalMs: 25000,
      fireInitQueries: true,
      emitOwnEvents: true,
      logger
    });
  } catch (error) {
    sock = null; isStarting = false;
    console.error('[Socket] Fail:', error.message);
    return;
  }
  isStarting = false;
  sock.ev.on('creds.update', async () => { try { await saveCreds(); } catch {} });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'connecting') console.log('[WhatsApp] Connecting...');
    if (connection === 'open') {
      console.log(`[WhatsApp] CONNECTED ${phone}`);
    }
    if (connection === 'close') {
      let statusCode = null;
      try { statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode; } catch {}
      console.log(`[WhatsApp] Closed: ${statusCode}`);
      sock = null;
      if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
        console.error('[WhatsApp] Session invalid - generate new');
        return;
      }
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try { await startBot(); } catch {}
      }, 3000); // was 5000 - faster reconnect
    }
  });

  // ===== FAST MESSAGE HANDLER - PARALLEL =====
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type!== 'notify' && type!== 'append') return;
    await Promise.all(messages.map(async (msg) => {
      try {
        if (!msg?.message) return;
        const jid = msg.key?.remoteJid;
        if (!jid || jid === 'status@broadcast') return;
        const message = msg.message;
        let text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '';
        text = String(text || '').trim();
        if (!text.startsWith(config.prefix)) return;
        const withoutPrefix = text.slice(config.prefix.length).trim();
        if (!withoutPrefix) return;
        const parts = withoutPrefix.split(/\s+/);
        const command = String(parts.shift() || '').toLowerCase();
        const args = parts;
        const sender = msg.key?.participant || msg.key?.remoteJid || '';

        const result = await privateRequest('POST', '/api/command', { command, args, jid, sender, text, accountId: phone });

        if (!result?.success) return;
        const actions = Array.isArray(result.actions)? result.actions : [];

        // Send all at once
        const sendPromises = [];
        if (result.message) {
          sendPromises.push(sock.sendMessage(jid, { text: result.message }));
        }
        for (const action of actions) {
          if (action?.type === 'sendMessage' && action.jid && action.content) {
            sendPromises.push(sock.sendMessage(action.jid, action.content));
          }
          if (action?.type === 'presence' && action.jid && action.presence) {
            sendPromises.push(sock.sendPresenceUpdate(action.presence, action.jid));
          }
        }
        await Promise.all(sendPromises);
      } catch {}
    }));
  });
}

app.get('/health', (req, res) => {
  res.json({ success: true, bot: 'MUFASER-X', status: sock?.user? 'connected' : 'starting', phone: activeSession?.phone || null });
});
app.get('/', (req, res) => { res.send('<h1>MUFASER-X FAST ONLINE ✅</h1>'); });

const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Port ${PORT}`);
  startBot().catch(e => console.error(e));
});
process.on('uncaughtException', e => console.error('[Fatal]', e));
process.on('unhandledRejection', e => console.error('[Unhandled]', e));