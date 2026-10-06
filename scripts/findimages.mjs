// Finds candidate images for each search line, downloads them (so we know they are reachable),
// and makes a numbered contact sheet per search. Output: candidates/<NAME>/
// Search line types:
//   plain text          web image search (Bing, DuckDuckGo as backup)
//   steam:Game Name     official key art and screenshots from the Steam store page
//   wiki:Search terms   Wikimedia Commons
//   page:https://...    the pictures used on an article page
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const queries = (process.env.QUERIES || process.argv.slice(2).join('\n')).split('\n').map((s) => s.trim()).filter(Boolean);
const name = (process.env.NAME || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')).replace(/[^a-zA-Z0-9_-]/g, '-');
const outDir = path.join(root, 'candidates', name);
fs.mkdirSync(outDir, {recursive: true});
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-'));

const decode = (t = '') => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const get = (url, opts = {}) =>
  fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {})}, signal: AbortSignal.timeout(opts.timeout || 15000), redirect: 'follow'});

async function bing(q) {
  const r = await get(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC3&first=1&qft=+filterui:imagesize-large&adlt=off`);
  if (!r.ok) throw new Error(`bing HTTP ${r.status}`);
  const html = await r.text();
  const out = [];
  for (const m of html.matchAll(/\sm="(\{[^"]+\})"/g)) {
    try {
      const j = JSON.parse(decode(m[1]));
      if (j.murl) out.push({url: j.murl, page: j.purl || '', title: j.t || ''});
    } catch {}
  }
  if (!out.length) throw new Error('bing returned no results (blocked or changed)');
  return out;
}

async function ddg(q) {
  const first = await (await get(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`)).text();
  const vqd = (first.match(/vqd=["']?([\d-]+)/) || [])[1];
  if (!vqd) throw new Error('ddg: no token');
  const r = await get(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,,,&p=1`, {headers: {Referer: 'https://duckduckgo.com/'}});
  if (!r.ok) throw new Error(`ddg HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).map((x) => ({url: x.image, page: x.url, title: x.title}));
}

async function steam(term) {
  let appid = /^\d+$/.test(term) ? term : '';
  if (!appid) {
    const sr = await (await get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=us`)).json();
    appid = String(sr.items?.[0]?.id || '');
  }
  const d = await (await get(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`)).json();
  const data = d[appid]?.data;
  if (!data) throw new Error('no steam store data');
  const out = [];
  if (data.background_raw) out.push({url: data.background_raw.split('?')[0], page: `steam ${data.name}`, title: 'key art'});
  for (const s of data.screenshots || []) out.push({url: s.path_full.split('?')[0], page: `steam ${data.name}`, title: 'screenshot'});
  return out;
}

async function wiki(q) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|size&iiurlwidth=1600&format=json`;
  const j = await (await get(u)).json();
  return Object.values(j.query?.pages || {}).map((p) => ({url: p.imageinfo?.[0]?.thumburl, page: `https://commons.wikimedia.org/wiki/${p.title}`, title: p.title})).filter((x) => x.url);
}

async function pageImages(url) {
  const html = (await (await get(url)).text()).slice(0, 400000);
  const out = [];
  const og = (html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1];
  if (og) out.push({url: new URL(decode(og), url).href, page: url, title: 'og:image'});
  for (const m of html.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)) {
    const u = decode(m[1]);
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(u)) continue;
    if (/logo|icon|avatar|sprite|pixel|badge|author|emoji/i.test(u)) continue;
    try { out.push({url: new URL(u, url).href, page: url, title: 'article image'}); } catch {}
  }
  return out;
}

async function search(q) {
  if (q.startsWith('steam:')) return steam(q.slice(6).trim());
  if (q.startsWith('wiki:')) return wiki(q.slice(5).trim());
  if (q.startsWith('page:')) return pageImages(q.slice(5).trim());
  try {
    return await bing(q);
  } catch (e1) {
    console.warn(`  ${e1.message}, trying DuckDuckGo`);
    return await ddg(q);
  }
}

const EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'};
async function fetchCandidate(c, file) {
  const r = await get(c.url, {timeout: 12000, headers: {Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8', Referer: new URL(c.url).origin + '/'}});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error(`type ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 15000) throw new Error('too small');
  const f = file + ext;
  fs.writeFileSync(f, buf);
  const dims = execFileSync('identify', ['-format', '%w %h', `${f}[0]`]).toString().trim().split(' ').map(Number);
  return {file: f, w: dims[0], h: dims[1], bytes: buf.length};
}

const report = [];
for (let qi = 0; qi < queries.length; qi++) {
  const q = queries[qi];
  console.log(`\n[${qi + 1}] ${q}`);
  let cands = [];
  try {
    cands = await search(q);
  } catch (e) {
    console.warn(`  search failed: ${e.message}`);
  }
  const seen = new Set();
  cands = cands.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url)).slice(0, 24);
  const kept = [];
  for (let i = 0; i < cands.length && kept.length < 10; i += 6) {
    const batch = cands.slice(i, i + 6);
    const res = await Promise.allSettled(batch.map((c, k) => fetchCandidate(c, path.join(work, `q${qi}_${i + k}`))));
    res.forEach((r, k) => {
      if (r.status === 'fulfilled' && r.value.w >= 640 && r.value.h >= 360 && kept.length < 10) kept.push({...batch[k], ...r.value});
    });
  }
  console.log(`  ${cands.length} found, ${kept.length} usable`);
  const entry = {query: q, results: kept.map((k, i) => ({n: i + 1, url: k.url, page: k.page, title: k.title, w: k.w, h: k.h}))};
  if (kept.length) {
    const args = [];
    kept.forEach((k, i) => args.push('-label', String(i + 1), `${k.file}[0]`));
    args.push('-tile', '5x2', '-geometry', '320x200+4+4', '-background', '#111111', '-fill', 'white', '-pointsize', '26',
      '-font', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', path.join(outDir, `q${qi + 1}.jpg`));
    try {
      execFileSync('montage', args);
    } catch (e) {
      console.warn(`  montage failed: ${e.message}`);
    }
  }
  report.push(entry);
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2));
const md = [`# Image candidates ${name}`, ''];
report.forEach((e, i) => {
  md.push(`## [${i + 1}] ${e.query}`, '', `Sheet: q${i + 1}.jpg`, '');
  for (const r of e.results) md.push(`- ${r.n}: ${r.url} (${r.w}x${r.h}) ${r.title ? '| ' + r.title.slice(0, 80) : ''}`);
  md.push('');
});
fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'));
console.log('\nDone.');
