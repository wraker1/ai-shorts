// Usage: npm run voices
// Lists voices on your ElevenLabs account (premade voices work on the free tier) and writes out/voices.md
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const res = await fetch('https://api.elevenlabs.io/v1/voices', {headers: {'xi-api-key': process.env.ELEVENLABS_API_KEY}});
if (!res.ok) {
  console.error(`ElevenLabs ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const {voices} = await res.json();
const rank = (v) => (v.labels?.age === 'young' ? 0 : v.labels?.age === 'middle_aged' ? 1 : 2);
voices.sort((a, b) => rank(a) - rank(b));
const lines = ['# ElevenLabs voices (young first)', '', 'Test one: npm run make -- stories/template-test.json --voice <id>', ''];
for (const v of voices) {
  const l = v.labels || {};
  lines.push(`- **${v.name}** | id: \`${v.voice_id}\` | ${[l.gender, l.age, l.accent, l.descriptive || l.description, l.use_case].filter(Boolean).join(', ')}`);
  if (v.preview_url) lines.push(`  - Listen: ${v.preview_url}`);
}
fs.mkdirSync(path.join(root, 'out'), {recursive: true});
const file = path.join(root, 'out', 'voices.md');
fs.writeFileSync(file, lines.join('\n'));
console.log(`Wrote ${file} (${voices.length} voices)`);
