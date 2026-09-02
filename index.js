// ============================================================
// MUFASER-X — PUBLIC LAUNCHER
// WhatsApp Multi-Device Bot by ROMA-TECH
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
// RESTORE SESSION ID
// ============================================================

function restoreSessionId(sessionId) {

  if (!sessionId) {
    throw new Error(
      'SESSION_ID is missing.'
    );
  }

  let raw = String(sessionId).trim();

  // Remove MUFASER-X session prefix
  raw = raw.replace(
    /^MUFASER-X:~/i,
    ''
  );

  if (!raw) {
    throw new Error(
      'Invalid SESSION_ID.'
    );
  }

  let decoded;

  try {

    decoded = Buffer.from(
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

  // ==========================================================
  // DECOMPRESS SESSION
  // ==========================================================

  let payloadText;

  try {

    payloadText =
      zlib
        .gunzipSync(decoded)
        .toString('utf8');

  } catch {

    // Fallback for an uncompressed session
    payloadText =
      decoded.toString('utf8');

  }

  // ==========================================================
  // PARSE SESSION
  // ==========================================================

  let payload;

  try {

    payload =
      JSON.parse(payloadText);

  } catch {

    throw new Error(
      'SESSION_ID contains invalid data.'
    );

  }

  // ==========================================================
  // VALIDATE SESSION FORMAT
  // ==========================================================

  if (
    !payload ||
    payload.format !== 'MUFASER-X-SESSION' ||
    !Array.isArray(payload.files)
  ) {

    throw new Error(
      'Invalid MUFASER-X SESSION format.'
    );

  }

  const restoredPhone =
    String(payload.phone || '')
      .replace(/\D/g, '');

  if (!restoredPhone) {

    throw new Error(
      'SESSION_ID does not contain a valid phone number.'
    );

  }

  const sessionsRoot =
    path.resolve(
      config.sessionsDir || './sessions'
    );

  const restoredDir =
    path.join(
      sessionsRoot,
      restoredPhone
    );

  // ==========================================================
  // CREATE SESSION DIRECTORY
  // ==========================================================

  fs.mkdirSync(
    restoredDir,
    {
      recursive: true
    }
  );

  const root =
    path.resolve(restoredDir) +
    path.sep;

  // ==========================================================
  // RESTORE EVERY AUTH FILE
  // ==========================================================

  for (const file of payload.files) {

    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.data !== 'string'
    ) {
      continue;
    }

    const target =
      path.resolve(
        restoredDir,
        file.path
      );

    // Security: prevent path traversal
    if (!target.startsWith(root)) {

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

    fs.writeFileSync(
      target,
      Buffer.from(
        file.data,
        'base64'
      )
    );

  }

  console.log(
    `[Session] ✅ Restored for ${restoredPhone}`
  );

  console.log(
    `[Session] Files restored: ${payload.files.length}`
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

  if (!config.privateServerUrl) {

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
// START WHATSAPP
// ============================================================

async function startBot() {

  // Prevent duplicate sockets
  if (isStarting) {
    return;
  }

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

  // ==========================================================
  // SESSION FROM ENVIRONMENT
  // ==========================================================

  const sessionId =
    String(
      process.env.SESSION_ID ||
      config.sessionId ||
      ''
    ).trim();

  if (!sessionId) {

    isStarting = false;

    console.error(
      '[Session] ❌ SESSION_ID not found.'
    );

    console.error(
      '[Session] Add SESSION_ID to your environment variables.'
    );

    return;

  }

  let restored;

  try {

    restored =
      restoreSessionId(
        sessionId
      );

  } catch (error) {

    isStarting = false;

    console.error(
      '[Session] ❌ Restore failed:',
      error.message
    );

    return;

  }

  activeSession = restored;

  const {
    phone,
    sessionDir
  } = restored;

  // ==========================================================
  // BAILEYS AUTH STATE
  // ==========================================================

  let state;
  let saveCreds;

  try {

    const auth =
      await useMultiFileAuthState(
        sessionDir
      );

    state = auth.state;
    saveCreds = auth.saveCreds;

  } catch (error) {

    isStarting = false;

    console.error(
      '[Session] ❌ Failed to load auth state:',
      error.message
    );

    return;

  }

  // ==========================================================
  // WHATSAPP VERSION
  // ==========================================================

  let version;

  try {

    const {
      version: latestVersion
    } =
      await fetchLatestBaileysVersion();

    version = latestVersion;

    console.log(
      `[WhatsApp] Version: ${version.join('.')}`
    );

  } catch (error) {

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

        // IMPORTANT:
        // Same browser configuration as the
        // old proven working MUFASER-X bot.
        browser: [
          'Ubuntu',
          'Chrome',
          '120.0.0.0'
        ],

        printQRInTerminal: false,

        syncFullHistory: false,

        markOnlineOnConnect: true,

        connectTimeoutMs: 60000,

        defaultQueryTimeoutMs: 30000,

        keepAliveIntervalMs: 25000,

        maxRetries: 5,

        fireInitQueries: false,

        emitOwnEvents: true,

        defaultCongestionControl: 1,

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
          '[Session] Save credentials failed:',
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
          '[WhatsApp] Connecting...'
        );

      }


      // ------------------------------------------------------
      // OPEN
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
      // CLOSE
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

        const loggedOut =
          statusCode ===
          DisconnectReason.loggedOut;

        const badSession =
          statusCode ===
          DisconnectReason.badSession;

        // ----------------------------------------------------
        // DO NOT RECONNECT FOR INVALID SESSION
        // ----------------------------------------------------

        if (
          loggedOut ||
          badSession
        ) {

          console.error(
            '[WhatsApp] ❌ Session is no longer valid.'
          );

          console.error(
            '[WhatsApp] Generate a new SESSION_ID.'
          );

          return;

        }

        // ----------------------------------------------------
        // PREVENT MULTIPLE RECONNECT TIMERS
        // ----------------------------------------------------

        if (reconnectTimer) {
          return;
        }

        console.log(
          '[WhatsApp] Reconnecting in 5 seconds...'
        );

        reconnectTimer =
          setTimeout(
            async () => {

              reconnectTimer = null;

              try {

                await startBot();

              } catch (error) {

                console.error(
                  '[Reconnect]',
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
  // MESSAGE EVENT — PRIVATE COMMAND BRIDGE
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

      for (const msg of messages) {

        try {

          if (!msg?.message) {
            continue;
          }

          const jid =
            msg.key?.remoteJid;

          if (!jid) {
            continue;
          }

          // --------------------------------------------------
          // IGNORE STATUS
          // --------------------------------------------------

          if (
            jid === 'status@broadcast'
          ) {
            continue;
          }

          // --------------------------------------------------
          // IGNORE PROTOCOL / SYSTEM MESSAGES
          // --------------------------------------------------

          const message =
            msg.message;

          // --------------------------------------------------
          // EXTRACT TEXT
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
          // COMMAND CHECK
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
          // SENDER
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
// PUBLIC SERVER — HEALTH
// ============================================================

app.get(
  '/health',
  (req, res) => {

    res.json({

      success: true,

      bot:
        'MUFASER-X',

      launcher:
        'public',

      status:
        sock?.user
          ? 'connected'
          : 'starting',

      sessionConfigured:
        Boolean(
          process.env.SESSION_ID ||
          config.sessionId
        ),

      phone:
        activeSession?.phone ||
        null

    });

  }
);


// ============================================================
// PUBLIC SERVER — HOME
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
        font-family:Arial;
        text-align:center;
        padding:60px;
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
  config.port ||
  process.env.PORT ||
  3000;

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `[Server] Public launcher running on port ${PORT}`
    );

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