// Usage: npm run make -- stories/my-story.json
// story file: { id, headline, source, script, images: [url or filename in public/stories/<id>/], music?: "music/track.mp3" }
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

// minimal .env loader
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const storyArg = process.argv[2];
if (!storyArg) {
  console.error('Usage: npm run make -- stories/my-story.json');
  process.exit(1);
}
const story = JSON.parse(fs.readFileSync(path.resolve(root, storyArg), 'utf8'));
const id = story.id;
const pubDir = path.join(root, 'public', 'stories', id);
fs.mkdirSync(pubDir, {recursive: true});
fs.mkdirSync(path.join(root, 'out'), {recursive: true});

const vIdx = process.argv.indexOf('--voice');
const voiceOverride = vIdx > -1 ? process.argv[vIdx + 1] : '';
const suffix = voiceOverride ? `-${voiceOverride.slice(0, 6)}` : '';
const audioPath = path.join(pubDir, `voice${suffix}.mp3`);
const wordsPath = path.join(pubDir, `words${suffix}.json`);

async function makeVoice() {
  if (fs.existsSync(audioPath) && fs.existsSync(wordsPath) && !process.argv.includes('--new-voice')) {
    console.log('Voice exists, reusing (pass --new-voice to regenerate).');
    return JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  }
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = voiceOverride || process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';
  if (!key) throw new Error('ELEVENLABS_API_KEY missing in .env');
  console.log('Generating voice with ElevenLabs...');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {'xi-api-key': key, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      text: story.script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true},
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = await res.json();
  fs.writeFileSync(audioPath, Buffer.from(data.audio_base64, 'base64'));

  const {characters: ch, character_start_times_seconds: st, character_end_times_seconds: en} = data.alignment;
  const words = [];
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) {
      if (cur) { words.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = {text: '', start: st[i], end: en[i]};
    cur.text += ch[i];
    cur.end = en[i];
  }
  if (cur) words.push(cur);
  fs.writeFileSync(wordsPath, JSON.stringify(words, null, 2));
  return words;
}

async function fetchImages() {
  const out = [];
  let n = 0;
  for (const img of story.images || []) {
    n++;
    if (/^https?:\/\//i.test(img)) {
      const ext = (new URL(img).pathname.match(/\.(png|jpe?g|webp)$/i)?.[0] || '.jpg').toLowerCase();
      const name = `img${n}${ext}`;
      const dest = path.join(pubDir, name);
      if (!fs.existsSync(dest)) {
        console.log(`Downloading image ${n}...`);
        const r = await fetch(img);
        if (!r.ok) throw new Error(`Image ${n} failed: ${r.status}`);
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      }
      out.push(`stories/${id}/${name}`);
    } else {
      // plain file name: expected in public/stories/<id>/
      if (!fs.existsSync(path.join(pubDir, img))) throw new Error(`Missing image file public/stories/${id}/${img}`);
      out.push(`stories/${id}/${img}`);
    }
  }
  return out;
}

const words = await makeVoice();
const last = words[words.length - 1];
const durationSec = Math.ceil((last.end + 0.6) * 10) / 10;
if (durationSec > 33) console.warn(`WARNING: ${durationSec}s is over the 30s target. Shorten the script.`);

const images = await fetchImages();
const props = {
  headline: story.headline,
  source: story.source || '',
  audio: `stories/${id}/voice${suffix}.mp3`,
  words,
  durationSec,
  images,
  music: story.music || '',
};
const propsPath = path.join(root, 'out', `${id}${suffix}.props.json`);
fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

console.log(`Rendering ${durationSec}s video...`);
const outFile = path.join('out', `${id}${suffix}.mp4`);
const r = spawnSync('npx', ['remotion', 'render', 'src/index.ts', 'Short', outFile, `--props=${propsPath}`], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`\nDone: ${path.join(root, outFile)}`);
