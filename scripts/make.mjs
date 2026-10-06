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
  let configVoice = '';
  try { configVoice = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).voice || ''; } catch {}
  const voice = voiceOverride || story.voice || configVoice || process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';
  if (!key) throw new Error('ELEVENLABS_API_KEY missing (set it in .env or as a GitHub secret)');
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'};

async function download(url, n) {
  const existing = fs.readdirSync(pubDir).find((f) => f.startsWith(`img${n}.`));
  if (existing) return existing;
  const r = await fetch(url, {
    headers: {'User-Agent': UA, Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8', Referer: new URL(url).origin + '/'},
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error(`unsupported type ${type || 'unknown'}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 8000) throw new Error('image too small (probably a placeholder or block page)');
  const name = `img${n}${ext}`;
  fs.writeFileSync(path.join(pubDir, name), buf);
  return name;
}

// "steam:<name or appid>" expands to the game's official key art and screenshots from its Steam store page
async function expandImages(list) {
  const out = [];
  for (const item of list) {
    if (!item.startsWith('steam:')) {
      out.push(item);
      continue;
    }
    try {
      const term = item.slice(6).trim();
      let appid = /^\d+$/.test(term) ? term : '';
      if (!appid) {
        const sr = await (await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=us`, {headers: {'User-Agent': UA}})).json();
        appid = String(sr.items?.[0]?.id || '');
        console.log(`Steam search "${term}" -> ${sr.items?.[0]?.name || 'nothing'} (${appid})`);
      }
      const d = await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, {headers: {'User-Agent': UA}})).json();
      const data = d[appid]?.data;
      if (!data) throw new Error('no store data');
      const found = [];
      if (data.background_raw) found.push(data.background_raw.split('?')[0]);
      for (const sh of data.screenshots || []) found.push(sh.path_full.split('?')[0]);
      console.log(`Steam "${data.name}": ${found.length} images found`);
      out.push(...found.slice(0, 4));
    } catch (e) {
      console.warn(`Steam lookup failed for "${item}": ${e.message}`);
    }
  }
  return out;
}

async function fetchImages() {
  const out = [];
  let n = 0;
  for (const img of await expandImages(story.images || [])) {
    n++;
    if (/^https?:\/\//i.test(img)) {
      try {
        const name = await download(img, n);
        console.log(`Image ${n} OK: ${img}`);
        out.push(`stories/${id}/${name}`);
      } catch (e) {
        console.warn(`Image ${n} FAILED (${e.message}): ${img}`);
      }
    } else {
      // plain file name: expected in public/stories/<id>/
      if (!fs.existsSync(path.join(pubDir, img))) {
        console.warn(`Image ${n} missing file public/stories/${id}/${img}`);
        continue;
      }
      out.push(`stories/${id}/${img}`);
    }
  }
  if ((story.images || []).length && !out.length) console.warn('No images could be loaded, using placeholder backgrounds.');
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
