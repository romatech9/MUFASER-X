// ============================================================
// MUFASER-X — PUBLIC LAUNCHER
// WhatsApp Multi-Device Bot by ROMA-TECH
//
// PURPOSE:
// - Read SESSION_ID from environment variables
// - Restore Baileys session automatically
// - Run MUFASER-X on any supported hosting panel
// - Reconnect using the locally restored session
// - Forward commands to the private command server
// ============================================================

require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const { Boom } = require('@hapi/boom');

const config = require('./config');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// LOGGER
// ============================================================

const logger = pino({
  level: 'silent'
});

// ============================================================
// BOT STATE
// ============================================================

let sock = null;
let reconnectTimer = null;
let isStarting = false;
let activeSession = null;

// ============================================================
// ENVIRONMENT
// ============================================================

const ENV_OWNER_NUMBER =
  String(process.env.OWNER_NUMBER || '')
    .replace(/\D/g, '');

// ============================================================
// SESSION HELPERS
// ============================================================

function getSessionsRoot() {
  return path.resolve(
    config.sessionsDir || './sessions'
  );
}

// ------------------------------------------------------------
// Check whether a usable local session already exists
// ------------------------------------------------------------

function localSessionExists(sessionDir) {

  if (!sessionDir) {
    return false;
  }

  const credsPath =
    path.join(
      sessionDir,
      'creds.json'
    );

  return (
    fs.existsSync(sessionDir) &&
    fs.existsSync(credsPath)
  );
}

// ============================================================
// RESTORE SESSION ID
// ============================================================

function restoreSessionId(sessionId) {

  if (!sessionId) {
    throw new Error(
      'SESSION_ID is missing.'
    );
  }

  let raw =
    String(sessionId).trim();

  // ----------------------------------------------------------
  // Remove MUFASER-X prefix
  // ----------------------------------------------------------

  raw =
    raw.replace(
      /^MUFASER-X:~/i,
      ''
    );

  if (!raw) {
    throw new Error(
      'Invalid SESSION_ID.'
    );
  }

  // ----------------------------------------------------------
  // Decode Base64
  // ----------------------------------------------------------

  let decoded;

  try {

    decoded =
      Buffer.from(
        raw,
        'base64'
      );

  } catch {

    throw new Error(
      'Invalid SESSION_ID encoding.'
    );

  }

  if (!decoded.length) {

    throw new Error(
      'SESSION_ID decoded to empty data.'
    );

  }

  // ----------------------------------------------------------
  // Decompress
  // ----------------------------------------------------------

  let payloadText;

  try {

    payloadText =
      zlib
        .gunzipSync(decoded)
        .toString('utf8');

  } catch {

    // Support uncompressed session data too
    try {

      payloadText =
        decoded.toString('utf8');

    } catch {

      throw new Error(
        'Unable to decode SESSION_ID data.'
      );

    }

  }

  // ----------------------------------------------------------
  // Parse JSON
  // ----------------------------------------------------------

  let payload;

  try {

    payload =
      JSON.parse(payloadText);

  } catch {

    throw new Error(
      'SESSION_ID contains invalid data.'
    );

  }

  // ----------------------------------------------------------
  // Validate format
  // ----------------------------------------------------------

  if (
    !payload ||
    payload.format !== 'MUFASER-X-SESSION' ||
    !Array.isArray(payload.files)
  ) {

    throw new Error(
      'Invalid MUFASER-X SESSION format.'
    );

  }

  // ----------------------------------------------------------
  // Restore phone
  // ----------------------------------------------------------

  const restoredPhone =
    String(payload.phone || '')
      .replace(/\D/g, '');

  if (!restoredPhone) {

    throw new Error(
      'SESSION_ID does not contain a valid phone number.'
    );

  }

  // ----------------------------------------------------------
  // Session directory
  // ----------------------------------------------------------

  const sessionsRoot =
    getSessionsRoot();

  const restoredDir =
    path.join(
      sessionsRoot,
      restoredPhone
    );

  // ----------------------------------------------------------
  // Create directory
  // ----------------------------------------------------------

  fs.mkdirSync(
    restoredDir,
    {
      recursive: true
    }
  );

  const root =
    path.resolve(
      restoredDir
    ) + path.sep;

  // ----------------------------------------------------------
  // Restore authentication files
  // ----------------------------------------------------------

  let restoredFiles = 0;

  for (
    const file of payload.files
  ) {

    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.data !== 'string'
    ) {
      continue;
    }

    // Prevent absolute paths
    if (
      path.isAbsolute(file.path)
    ) {

      console.warn(
        `[Session] Skipping absolute path: ${file.path}`
      );

      continue;

    }

    const target =
      path.resolve(
        restoredDir,
        file.path
      );

    // Security: prevent path traversal
    if (
      !target.startsWith(root)
    ) {

      console.warn(
        `[Session] Skipping unsafe file: ${file.path}`
      );

      continue;

    }

    fs.mkdirSync(
      path.dirname(target),
      {
        recursive: true
      }
    );

    try {

      fs.writeFileSync(
        target,
        Buffer.from(
          file.data,
          'base64'
        )
      );

      restoredFiles++;

    } catch (error) {

      console.error(
        `[Session] Failed to restore ${file.path}:`,
        error.message
      );

    }

  }

  if (!restoredFiles) {

    throw new Error(
      'SESSION_ID contains no usable authentication files.'
    );

  }

  console.log(
    `[Session] ✅ Restored for ${restoredPhone}`
  );

  console.log(
    `[Session] Files restored: ${restoredFiles}`
  );

  return {
    phone: restoredPhone,
    sessionDir: restoredDir
  };

}

// ============================================================
// PRIVATE SERVER REQUEST
// ============================================================

async function privateRequest(
  method,
  endpoint,
  data = {}
) {

  if (
    !config.privateServerUrl
  ) {

    throw new Error(
      'PRIVATE_SERVER_URL is missing.'
    );

  }

  const url =
    config.privateServerUrl.replace(
      /\/+$/,
      ''
    ) + endpoint;

  const response =
    await axios({

      method,

      url,

      data,

      headers: {

        'x-api-key':
          config.privateApiKey,

        'Content-Type':
          'application/json'

      },

      timeout: 30000

    });

  return response.data;

}

// ============================================================
// RESTORE SESSION IF REQUIRED
// ============================================================

function prepareSession() {

  const sessionsRoot =
    getSessionsRoot();

  fs.mkdirSync(
    sessionsRoot,
    {
      recursive: true
    }
  );

  // ----------------------------------------------------------
  // If we already know the active session and its files exist,
  // keep using them.
  // ----------------------------------------------------------

  if (
    activeSession &&
    activeSession.phone &&
    activeSession.sessionDir &&
    localSessionExists(
      activeSession.sessionDir
    )
  ) {

    console.log(
      `[Session] ♻️ Using existing local session for ${activeSession.phone}`
    );

    return activeSession;

  }

  // ----------------------------------------------------------
  // SESSION_ID must come from ENV/config for a fresh startup.
  // ----------------------------------------------------------

  const sessionId =
    config.sessionId;

  if (!sessionId) {

    throw new Error(
      'SESSION_ID not found in environment variables.'
    );

  }

  console.log(
    '[Session] 🔐 SESSION_ID found in environment.'
  );

  const restored =
    restoreSessionId(
      sessionId
    );

  activeSession =
    restored;

  return restored;

}

// ============================================================
// START WHATSAPP BOT
// ============================================================

async function startBot() {

  // ----------------------------------------------------------
  // Prevent duplicate startup
  // ----------------------------------------------------------

  if (isStarting) {

    console.log(
      '[WhatsApp] Startup already in progress.'
    );

    return;

  }

  // ----------------------------------------------------------
  // Already connected
  // ----------------------------------------------------------

  if (
    sock &&
    sock.user
  ) {

    console.log(
      '[WhatsApp] Socket is already connected.'
    );

    return;

  }

  isStarting = true;

  console.log('');
  console.log(
    '============================================'
  );
  console.log(
    '       MUFASER-X PUBLIC LAUNCHER'
  );
  console.log(
    '       Developer: ROMA-TECH'
  );
  console.log(
    '============================================'
  );

  let restored;

  try {

    // ========================================================
    // SESSION PREPARATION
    // ========================================================

    restored =
      prepareSession();

  } catch (error) {

    isStarting = false;

    console.error('');
    console.error(
      '[Session] ❌ Session preparation failed:',
      error.message
    );

    console.error(
      '[Session] Add a valid SESSION_ID to your panel environment variables.'
    );

    console.error('');

    return;

  }

  const {
    phone,
    sessionDir
  } = restored;

  console.log(
    `[Session] 📱 Number: ${phone}`
  );

  console.log(
    `[Session] 📁 Directory: ${sessionDir}`
  );

  // ==========================================================
  // LOAD BAILEYS AUTH
  // ==========================================================

  let state;
  let saveCreds;

  try {

    const auth =
      await useMultiFileAuthState(
        sessionDir
      );

    state =
      auth.state;

    saveCreds =
      auth.saveCreds;

  } catch (error) {

    isStarting = false;

    console.error(
      '[Session] ❌ Failed to load Baileys auth:',
      error.message
    );

    return;

  }

  // ==========================================================
  // FETCH WHATSAPP VERSION
  // ==========================================================

  let version;

  try {

    const {
      version: latestVersion
    } =
      await fetchLatestBaileysVersion();

    version =
      latestVersion;

    console.log(
      `[WhatsApp] Version: ${version.join('.')}`
    );

  } catch {

    console.log(
      '[WhatsApp] ⚠️ Using fallback WhatsApp version.'
    );

    version = [
      2,
      3000,
      1017546695
    ];

  }

  // ==========================================================
  // CREATE SOCKET
  // ==========================================================

  try {

    sock =
      makeWASocket({

        version,

        auth: {

          creds:
            state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              logger
            )

        },

        browser: [
          'Ubuntu',
          'Chrome',
          '120.0.0.0'
        ],

        printQRInTerminal:
          false,

        syncFullHistory:
          false,

        markOnlineOnConnect:
          true,

        connectTimeoutMs:
          60000,

        defaultQueryTimeoutMs:
          30000,

        keepAliveIntervalMs:
          25000,

        maxRetries:
          5,

        fireInitQueries:
          false,

        emitOwnEvents:
          true,

        defaultCongestionControl:
          1,

        logger

      });

  } catch (error) {

    sock = null;
    isStarting = false;

    console.error(
      '[WhatsApp] ❌ Socket creation failed:',
      error.message
    );

    return;

  }

  isStarting = false;

  // ==========================================================
  // SAVE CREDENTIALS
  // ==========================================================

  sock.ev.on(
    'creds.update',
    async () => {

      try {

        await saveCreds();

      } catch (error) {

        console.error(
          '[Session] ❌ Save credentials failed:',
          error.message
        );

      }

    }
  );

  // ==========================================================
  // CONNECTION UPDATE
  // ==========================================================

  sock.ev.on(
    'connection.update',
    async ({
      connection,
      lastDisconnect
    }) => {

      // ------------------------------------------------------
      // CONNECTING
      // ------------------------------------------------------

      if (
        connection === 'connecting'
      ) {

        console.log(
          '[WhatsApp] 🔄 Connecting...'
        );

      }

      // ------------------------------------------------------
      // CONNECTED
      // ------------------------------------------------------

      if (
        connection === 'open'
      ) {

        console.log('');
        console.log(
          '============================================'
        );
        console.log(
          '       MUFASER-X CONNECTED ✅'
        );
        console.log(
          '============================================'
        );

        console.log(
          `[WhatsApp] Number: ${phone}`
        );

        console.log(
          '[WhatsApp] Public launcher is ready.'
        );

      }

      // ------------------------------------------------------
      // CONNECTION CLOSED
      // ------------------------------------------------------

      if (
        connection === 'close'
      ) {

        const statusCode =
          new Boom(
            lastDisconnect?.error
          )
            ?.output
            ?.statusCode;

        console.log(
          `[WhatsApp] Connection closed: ${statusCode}`
        );

        sock = null;

        // ----------------------------------------------------
        // INVALID / LOGGED OUT SESSION
        // ----------------------------------------------------

        const loggedOut =
          statusCode ===
          DisconnectReason.loggedOut;

        const badSession =
          statusCode ===
          DisconnectReason.badSession;

        if (
          loggedOut ||
          badSession
        ) {

          console.error(
            '[WhatsApp] ❌ Session is no longer valid.'
          );

          console.error(
            '[WhatsApp] Generate a new SESSION_ID and redeploy.'
          );

          return;

        }

        // ----------------------------------------------------
        // Prevent duplicate reconnect timers
        // ----------------------------------------------------

        if (
          reconnectTimer
        ) {

          return;

        }

        console.log(
          '[WhatsApp] 🔄 Reconnecting in 5 seconds...'
        );

        reconnectTimer =
          setTimeout(
            async () => {

              reconnectTimer =
                null;

              try {

                await startBot();

              } catch (error) {

                console.error(
                  '[Reconnect] ❌',
                  error.message
                );

              }

            },
            5000
          );

      }

    }
  );

  // ==========================================================
  // MESSAGE EVENT
  // PRIVATE COMMAND BRIDGE
  // ==========================================================

  sock.ev.on(
    'messages.upsert',
    async ({
      messages,
      type
    }) => {

      if (
        type !== 'notify' &&
        type !== 'append'
      ) {

        return;

      }

      for (
        const msg of messages
      ) {

        try {

          if (
            !msg?.message
          ) {

            continue;

          }

          const jid =
            msg.key?.remoteJid;

          if (!jid) {

            continue;

          }

          // --------------------------------------------------
          // Ignore WhatsApp Status
          // --------------------------------------------------

          if (
            jid === 'status@broadcast'
          ) {

            continue;

          }

          const message =
            msg.message;

          // --------------------------------------------------
          // Extract text
          // --------------------------------------------------

          let text = '';

          if (
            typeof message.conversation ===
            'string'
          ) {

            text =
              message.conversation;

          }

          else if (
            typeof message
              .extendedTextMessage
              ?.text === 'string'
          ) {

            text =
              message
                .extendedTextMessage
                .text;

          }

          else if (
            typeof message
              .imageMessage
              ?.caption === 'string'
          ) {

            text =
              message
                .imageMessage
                .caption;

          }

          else if (
            typeof message
              .videoMessage
              ?.caption === 'string'
          ) {

            text =
              message
                .videoMessage
                .caption;

          }

          text =
            String(
              text || ''
            ).trim();

          // --------------------------------------------------
          // Command check
          // --------------------------------------------------

          if (
            !text.startsWith(
              config.prefix
            )
          ) {

            continue;

          }

          const withoutPrefix =
            text
              .slice(
                config.prefix.length
              )
              .trim();

          if (!withoutPrefix) {

            continue;

          }

          const parts =
            withoutPrefix.split(
              /\s+/
            );

          const command =
            String(
              parts.shift() || ''
            ).toLowerCase();

          const args =
            parts;

          // --------------------------------------------------
          // Sender
          // --------------------------------------------------

          const sender =
            msg.key?.participant ||
            msg.key?.remoteJid ||
            '';

          // --------------------------------------------------
          // SEND COMMAND TO PRIVATE SERVER
          // --------------------------------------------------

          console.log(
            `[Command] Sending .${command} to private server...`
          );

          const result =
            await privateRequest(
              'POST',
              '/api/command',
              {

                command,

                args,

                jid,

                sender,

                text,

                accountId:
                  phone

              }
            );

          console.log(
            `[Private] .${command} response:`,
            result?.success
              ? 'OK'
              : 'FAILED'
          );

          // --------------------------------------------------
          // PRIVATE SERVER RESPONSE
          // --------------------------------------------------

          if (
            result?.success &&
            result?.message
          ) {

            await sock.sendMessage(
              jid,
              {
                text:
                  result.message
              }
            );

          }

        } catch (error) {

          console.error(
            '[Private Command Bridge]',
            error.message
          );

        }

      }

    }
  );

}

// ============================================================
// HEALTH
// ============================================================

app.get(
  '/health',
  (req, res) => {

    res.json({

      success:
        true,

      bot:
        'MUFASER-X',

      developer:
        'ROMA-TECH',

      launcher:
        'public',

      status:
        sock?.user
          ? 'connected'
          : 'starting',

      sessionConfigured:
        Boolean(
          config.sessionId
        ),

      phone:
        activeSession?.phone ||
        null

    });

  }
);

// ============================================================
// HOME
// ============================================================

app.get(
  '/',
  (req, res) => {

    res.send(`
      <!DOCTYPE html>

      <html>

      <head>

        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >

        <title>MUFASER-X</title>

      </head>

      <body style="
        background:#000;
        color:#00ff99;
        font-family:Arial,sans-serif;
        text-align:center;
        padding:60px 20px;
      ">

        <h1>MUFASER-X</h1>

        <p>
          Public Launcher Online ✅
        </p>

        <p>
          ROMA-TECH
        </p>

      </body>

      </html>
    `);

  }
);

// ============================================================
// START EXPRESS
// ============================================================

const PORT =
  process.env.PORT ||
  config.port ||
  3000;

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `[Server] Public launcher running on port ${PORT}`
    );

    // --------------------------------------------------------
    // START BOT
    // --------------------------------------------------------

    startBot()
      .catch(
        error => {

          console.error(
            '[Startup]',
            error
          );

        }
      );

  }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
  'uncaughtException',
  error => {

    console.error(
      '[Fatal]',
      error
    );

  }
);

process.on(
  'unhandledRejection',
  error => {

    console.error(
      '[Unhandled]',
      error
    );

  }
);