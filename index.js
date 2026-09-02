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
// ACCOUNT
// ============================================================

const phone =
  String(config.ownerNumber || '')
    .replace(/\D/g, '');

const sessionDir =
  path.join(
    config.sessionsDir,
    phone || 'default'
  );


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

  let payloadText;

  try {

    payloadText =
      zlib
        .gunzipSync(decoded)
        .toString('utf8');

  } catch {

    payloadText =
      decoded.toString('utf8');

  }

  let payload;

  try {

    payload =
      JSON.parse(payloadText);

  } catch {

    throw new Error(
      'SESSION_ID contains invalid data.'
    );

  }

  if (
    !payload ||
    payload.format !==
      'MUFASER-X-SESSION' ||
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

  const restoredDir =
    path.join(
      config.sessionsDir,
      restoredPhone
    );

  fs.mkdirSync(
    restoredDir,
    {
      recursive: true
    }
  );

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

    const target =
      path.resolve(
        restoredDir,
        file.path
      );

    const root =
      path.resolve(
        restoredDir
      ) + path.sep;

    if (
      !target.startsWith(root)
    ) {
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
    `[Session] Restored for ${restoredPhone}`
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
// WHATSAPP CONNECTION
// ============================================================

async function startBot() {

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

  if (!config.sessionId) {

    console.log(
      '[Session] SESSION_ID not found.'
    );

    console.log(
      '[Session] Add SESSION_ID to Render Environment Variables.'
    );

    return;

  }

  let restored;

  try {

    restored =
      restoreSessionId(
        config.sessionId
      );

  } catch (error) {

    console.error(
      '[Session] Restore failed:',
      error.message
    );

    return;

  }

  const {
    sessionDir
  } = restored;

  const {
    state,
    saveCreds
  } =
    await useMultiFileAuthState(
      sessionDir
    );

  let version;

  try {

    const latest =
      await fetchLatestBaileysVersion();

    version =
      latest.version;

  } catch {

    version = [
      2,
      3000,
      1017546695
    ];

  }

  const sock =
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
        'MUFASER-X',
        'Chrome',
        '120.0.0.0'
      ],

      printQRInTerminal: false,

      syncFullHistory: false,

      markOnlineOnConnect: true,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 30000,

      keepAliveIntervalMs: 25000,

      logger

    });


  // ==========================================================
  // SAVE CREDENTIALS
  // ==========================================================

  sock.ev.on(
    'creds.update',
    saveCreds
  );


  // ==========================================================
  // CONNECTION
  // ==========================================================

  sock.ev.on(
    'connection.update',
    async ({
      connection,
      lastDisconnect
    }) => {

      if (
        connection === 'connecting'
      ) {

        console.log(
          '[WhatsApp] Connecting...'
        );

      }


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
          `[WhatsApp] Number: ${restored.phone}`
        );

      }


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

        if (
          statusCode !==
            DisconnectReason.loggedOut &&
          statusCode !==
            DisconnectReason.badSession
        ) {

          console.log(
            '[WhatsApp] Reconnecting in 5 seconds...'
          );

          setTimeout(
            () => {

              startBot()
                .catch(
                  error =>
                    console.error(
                      '[Reconnect]',
                      error.message
                    )
                );

            },
            5000
          );

        } else {

          console.log(
            '[WhatsApp] Session is no longer valid.'
          );

        }

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

          // ----------------------------------------------------
          // IGNORE STATUS / BROADCAST EVENTS
          // ----------------------------------------------------

          if (
            jid === 'status@broadcast'
          ) {
            continue;
          }

          // ----------------------------------------------------
          // EXTRACT TEXT
          // ----------------------------------------------------

          const message =
            msg.message;

          let text = '';

          if (
            typeof message.conversation === 'string'
          ) {

            text =
              message.conversation;

          } else if (
            typeof message.extendedTextMessage?.text === 'string'
          ) {

            text =
              message.extendedTextMessage.text;

          } else if (
            typeof message.imageMessage?.caption === 'string'
          ) {

            text =
              message.imageMessage.caption;

          } else if (
            typeof message.videoMessage?.caption === 'string'
          ) {

            text =
              message.videoMessage.caption;

          }

          text =
            String(text || '').trim();

          // ----------------------------------------------------
          // COMMAND CHECK
          // ----------------------------------------------------

          if (
            !text.startsWith(config.prefix)
          ) {
            continue;
          }

          const withoutPrefix =
            text
              .slice(config.prefix.length)
              .trim();

          if (!withoutPrefix) {
            continue;
          }

          const parts =
            withoutPrefix.split(/\s+/);

          const command =
            String(parts.shift() || '')
              .toLowerCase();

          const args =
            parts;

          // ----------------------------------------------------
          // SENDER
          // ----------------------------------------------------

          const sender =
            msg.key?.participant ||
            msg.key?.remoteJid ||
            '';

          // ----------------------------------------------------
          // SEND COMMAND TO PRIVATE SERVER
          // ----------------------------------------------------

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
                  restored.phone
              }
            );

          console.log(
            `[Private] .${command} response:`,
            result?.message ||
            result?.success
              ? 'OK'
              : 'FAILED'
          );

          // ----------------------------------------------------
          // TEMPORARY TEST RESPONSE
          // ----------------------------------------------------

          if (
            result?.success &&
            result?.message
          ) {

            await sock.sendMessage(
              jid,
              {
                text:
                  `╭━━〔 MUFASER-X 〕━━╮\n\n` +
                  `✅ Private server received:\n` +
                  `.${command}\n\n` +
                  `🔐 Private command bridge is working.\n\n` +
                  `╰━━━━━━━━━━━━━━━━━━╯`
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

// ============================================================
// PUBLIC SERVER
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
        'online',

      sessionConfigured:
        Boolean(
          config.sessionId
        )

    });

  }
);


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
  config.port;

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