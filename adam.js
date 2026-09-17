// ============================================================
// MUFASER-X — ADAM VOICE
// ROMA-TECH
//
// Google TTS → MP3
// → pitch down 2 semitones
// → OGG OPUS
// → WhatsApp voice note
// ============================================================

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const googleTTS = require('google-tts-api');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

// ============================================================
// TEMP DIRECTORY
// ============================================================

const TEMP_DIR = path.join(
  process.cwd(),
  'tmp',
  'adam'
);

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, {
    recursive: true
  });
}

// ============================================================
// SPLIT LONG TEXT
//
// Google TTS has a short-text limit.
// We split automatically so long messages work.
// ============================================================

function splitText(text, maxLength = 180) {

  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  const chunks = [];
  let current = '';

  for (const word of words) {

    const test =
      `${current} ${word}`.trim();

    if (test.length > maxLength) {

      if (current.trim()) {
        chunks.push(current.trim());
      }

      current = word;

    } else {

      current = test;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ============================================================
// DOWNLOAD GOOGLE TTS AUDIO
// ============================================================

async function downloadTTS(
  text,
  outputFile
) {

  const url =
    googleTTS.getAudioUrl(
      text,
      {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com'
      }
    );

  const response =
    await axios.get(
      url,
      {
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );

  fs.writeFileSync(
    outputFile,
    Buffer.from(response.data)
  );
}

// ============================================================
// GOOGLE VOICE → ADAM
//
// −2 semitones
// No extreme pitch shifting.
// Keeps the voice natural.
// ============================================================

function createAdamVoice(
  input,
  output
) {

  return new Promise(
    (resolve, reject) => {

      // 2 semitones down
      const factor =
        Math.pow(
          2,
          -2 / 12
        );

      ffmpeg(input)

        // Lower the fundamental frequency
        .audioFilters([
          `asetrate=44100*${factor}`,
          'aresample=44100',
          `atempo=${1 / factor}`,

          // Clean the sound
          'highpass=f=70',
          'lowpass=f=15000',

          // Normalize volume
          'loudnorm=I=-16:TP=-1.5:LRA=11'
        ])

        .audioCodec('libopus')

        .audioChannels(1)

        .audioFrequency(48000)

        .audioBitrate('64k')

        .format('ogg')

        .on('end', resolve)

        .on('error', reject)

        .save(output);
    }
  );
}

// ============================================================
// GET TEXT FROM REPLY
// ============================================================

function getQuotedText(msg) {

  const context =
    msg?.message
      ?.extendedTextMessage
      ?.contextInfo;

  const quoted =
    context?.quotedMessage;

  if (!quoted) {
    return '';
  }

  return (
    quoted.conversation ||

    quoted.extendedTextMessage?.text ||

    quoted.imageMessage?.caption ||

    quoted.videoMessage?.caption ||

    quoted.documentMessage?.caption ||

    quoted.buttonsResponseMessage
      ?.selectedDisplayText ||

    quoted.listResponseMessage
      ?.title ||

    ''
  );
}

// ============================================================
// COMMAND
// ============================================================

module.exports = {

  name: 'adam',

  aliases: [
    'adams',
    'adamvoice'
  ],

  desc:
    'Generate the Adam male-style voice',

  category: 'AI',

  usage:
    '.adam <text>',

  async execute(
    sock,
    msg,
    jid,
    args,
    sender,
    account
  ) {

    const generatedFiles = [];

    try {

      // ------------------------------------------------------
      // TEXT AFTER COMMAND
      // ------------------------------------------------------

      let text =
        Array.isArray(args)
          ? args.join(' ').trim()
          : '';

      // ------------------------------------------------------
      // REPLIED MESSAGE
      // ------------------------------------------------------

      if (!text) {
        text = getQuotedText(msg);
      }

      text = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();

      // ------------------------------------------------------
      // EMPTY
      // ------------------------------------------------------

      if (!text) {

        return sock.sendMessage(
          jid,
          {
            text:
              `👨🎙️ *ADAM VOICE*\n\n` +
              `Send text after the command or ` +
              `reply to a message.\n\n` +
              `Example:\n` +
              `.adam Hello everyone, welcome to MUFASER-X.`
          },
          {
            quoted: msg
          }
        );
      }

      // ------------------------------------------------------
      // SPLIT LONG TEXT
      // ------------------------------------------------------

      const chunks =
        splitText(
          text,
          180
        );

      await sock.sendMessage(
        jid,
        {
          text:
            `👨🎙️ *ADAM VOICE*\n\n` +
            `Generating ${chunks.length} voice ` +
            `${chunks.length === 1 ? 'note' : 'notes'}...`
        },
        {
          quoted: msg
        }
      );

      // ------------------------------------------------------
      // GENERATE EACH PART
      // ------------------------------------------------------

      for (
        let i = 0;
        i < chunks.length;
        i++
      ) {

        const id =
          `${Date.now()}-${i}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        const mp3 =
          path.join(
            TEMP_DIR,
            `${id}.mp3`
          );

        const ogg =
          path.join(
            TEMP_DIR,
            `${id}.ogg`
          );

        try {

          // Google TTS
          await downloadTTS(
            chunks[i],
            mp3
          );

          // Google → Adam
          await createAdamVoice(
            mp3,
            ogg
          );

          generatedFiles.push({
            mp3,
            ogg
          });

        } catch (error) {

          // Clean this chunk before stopping
          try {
            if (fs.existsSync(mp3)) {
              fs.unlinkSync(mp3);
            }
          } catch {}

          try {
            if (fs.existsSync(ogg)) {
              fs.unlinkSync(ogg);
            }
          } catch {}

          throw error;
        }
      }

      // ------------------------------------------------------
      // SEND VOICE NOTES
      // ------------------------------------------------------

      for (
        const file of generatedFiles
      ) {

        await sock.sendMessage(
          jid,
          {
            audio: {
              url: file.ogg
            },

            mimetype:
              'audio/ogg; codecs=opus',

            ptt: true
          },
          {
            quoted: msg
          }
        );
      }

    } catch (error) {

      console.error(
        '[MUFASER-X ADAM ERROR]',
        error
      );

      try {

        await sock.sendMessage(
          jid,
          {
            text:
              `❌ *ADAM VOICE FAILED*\n\n` +
              `${error?.message || 'Unknown error'}`
          },
          {
            quoted: msg
          }
        );

      } catch {}

    } finally {

      // ------------------------------------------------------
      // CLEAN EVERYTHING
      // ------------------------------------------------------

      for (
        const file of generatedFiles
      ) {

        try {

          if (
            file.mp3 &&
            fs.existsSync(file.mp3)
          ) {
            fs.unlinkSync(file.mp3);
          }

        } catch {}

        try {

          if (
            file.ogg &&
            fs.existsSync(file.ogg)
          ) {
            fs.unlinkSync(file.ogg);
          }

        } catch {}
      }
    }
  }
};