// Usage: node scripts/news.mjs
// Collects today's gaming news from Reddit and from gaming site feeds, with image candidates.
// Writes news/YYYY-MM-DD.md (to read) and news/YYYY-MM-DD.json (for tools).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SUBS = ['Games', 'gaming', 'pcgaming', 'PS5', 'XboxSeriesX', 'NintendoSwitch', 'GamingLeaksAndRumours'];
const FEEDS = [
  ['IGN', 'https://feeds.feedburner.com/ign/games-all'],
  ['PC Gamer', 'https://www.pcgamer.com/rss/'],
  ['Eurogamer', 'https://www.eurogamer.net/feed'],
  ['GameSpot', 'https://www.gamespot.com/feeds/news/'],
  ['Polygon', 'https://www.polygon.com/rss/index.xml'],
  ['VGC', 'https://www.videogameschronicle.com/feed/'],
  ['Rock Paper Shotgun', 'https://www.rockpapershotgun.com/feed'],
  ['GamesRadar', 'https://www.gamesradar.com/rss/'],
];

const status = [];
const note = (name, ok, detail) => {
  status.push({name, ok, detail});
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`);
};

async function get(url, accept = '*/*', timeout = 15000) {
  const r = await fetch(url, {
    headers: {'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9'},
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

const decode = (t = '') =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .trim();

const isImageUrl = (u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u) || /(i\.redd\.it|preview\.redd\.it|i\.imgur\.com)/i.test(u);

async function ogImage(url) {
  try {
    const html = await (await get(url, 'text/html', 10000)).text();
    const head = html.slice(0, 200000);
    const m =
      head.match(/<meta[^>]+(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/i) ||
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i) ||
      head.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    return m ? new URL(decode(m[1]), url).href : '';
  } catch {
    return '';
  }
}

// ---------- Reddit ----------
function redditImages(p) {
  const imgs = [];
  const add = (u) => {
    if (u && !imgs.includes(u)) imgs.push(u);
  };
  if (p.is_gallery && p.media_metadata) {
    for (const item of p.gallery_data?.items || []) {
      const m = p.media_metadata[item.media_id];
      if (m?.s?.u) add(decode(m.s.u));
      else if (m?.s?.gif) add(decode(m.s.gif));
    }
  }
  const direct = p.url_overridden_by_dest || p.url;
  if (direct && isImageUrl(direct)) add(direct);
  const prev = p.preview?.images?.[0]?.source?.url;
  if (prev) add(decode(prev));
  return imgs.slice(0, 4);
}

async function redditJson(sub) {
  const urls = [
    `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25&raw_json=1`,
    `https://old.reddit.com/r/${sub}/top.json?t=day&limit=25&raw_json=1`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const j = await (await get(u, 'application/json')).json();
      return j.data.children.map((c) => c.data);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function redditRss(sub) {
  const xml = await (await get(`https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=25`, 'application/atom+xml')).text();
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const title = decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const thread = (e.match(/<link href="([^"]+)"/) || [])[1];
    const content = decode((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1]);
    const ext = (content.match(/<a href="([^"]+)">\[link\]<\/a>/) || [])[1];
    const thumb = (content.match(/<img src="([^"]+)"/) || [])[1];
    return {title, permalink: thread ? new URL(thread).pathname : '', url: ext || '', thumbnailFromRss: thumb || '', score: 0, num_comments: 0, rss: true};
  });
}

const items = [];

for (const sub of SUBS) {
  let posts;
  try {
    posts = await redditJson(sub);
    note(`reddit r/${sub}`, true, `json ${posts.length} posts`);
  } catch (e1) {
    try {
      posts = await redditRss(sub);
      note(`reddit r/${sub}`, true, `rss ${posts.length} posts (json failed: ${e1.message})`);
    } catch (e2) {
      note(`reddit r/${sub}`, false, `json: ${e1.message}, rss: ${e2.message}`);
      continue;
    }
  }
  for (const p of posts) {
    if (p.stickied || p.over_18) continue;
    const link = p.is_self ? '' : p.url_overridden_by_dest || p.url || '';
    items.push({
      kind: 'reddit',
      source: `r/${sub}`,
      title: p.title,
      score: p.score || 0,
      comments: p.num_comments || 0,
      thread: p.permalink ? `https://www.reddit.com${p.permalink}` : '',
      link: link && !/reddit\.com|redd\.it/.test(link) ? link : '',
      flair: p.link_flair_text || '',
      images: p.rss ? [] : redditImages(p),
      date: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : '',
    });
  }
}

// ---------- Site feeds ----------
function parseFeed(xml) {
  const blocks = xml.includes('<item') ? xml.split(/<item[ >]/).slice(1) : xml.split(/<entry[ >]/).slice(1);
  return blocks.map((b) => {
    const title = decode((b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const link =
      decode((b.match(/<link>([^<]+)<\/link>/) || [])[1]) ||
      (b.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/) || b.match(/<link[^>]+href="([^"]+)"/) || [])[1] ||
      '';
    const date = decode((b.match(/<(?:pubDate|published|updated)>([^<]+)</) || [])[1]);
    const img =
      (b.match(/<media:(?:content|thumbnail)[^>]+url="([^"]+)"/) || [])[1] ||
      (b.match(/<enclosure[^>]+url="([^"]+)"[^>]+type="image/) || [])[1] ||
      (decode(b).match(/<img[^>]+src="([^"]+)"/) || [])[1] ||
      '';
    return {title, link, date, img: decode(img)};
  });
}

for (const [name, url] of FEEDS) {
  try {
    const xml = await (await get(url, 'application/rss+xml, application/xml, text/xml')).text();
    const entries = parseFeed(xml).filter((e) => e.title && e.link);
    note(`feed ${name}`, true, `${entries.length} items`);
    for (const e of entries.slice(0, 12)) {
      items.push({
        kind: 'site',
        source: name,
        title: e.title,
        score: 0,
        comments: 0,
        thread: '',
        link: e.link,
        flair: '',
        images: e.img ? [e.img] : [],
        date: e.date ? new Date(e.date).toISOString() : '',
      });
    }
  } catch (e) {
    note(`feed ${name}`, false, e.message);
  }
}

if (!items.length) {
  console.error('No items collected from any source.');
  process.exit(1);
}

// Fill in missing images from the article page itself (og:image), for the most relevant items only
const pickTop = [...items.filter((i) => i.kind === 'reddit').sort((a, b) => b.score - a.score).slice(0, 25), ...items.filter((i) => i.kind === 'site')];
let filled = 0;
for (const it of pickTop) {
  if (!it.link || it.images.some((u) => !/redd\.it/.test(u))) continue;
  const og = await ogImage(it.link);
  if (og) {
    it.images.unshift(og);
    filled++;
  }
}
console.log(`Added og:image to ${filled} items`);

// ---------- Output ----------
const day = new Date().toISOString().slice(0, 10);
const outDir = path.join(root, 'news');
fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, `${day}.json`), JSON.stringify({day, status, items}, null, 2));

const L = [`# Gaming news candidates ${day}`, '', '## Source status', ''];
for (const s of status) L.push(`- ${s.ok ? 'OK' : 'FAILED'}: ${s.name} (${s.detail})`);
const reddit = items.filter((i) => i.kind === 'reddit').sort((a, b) => b.score - a.score).slice(0, 40);
const site = items.filter((i) => i.kind === 'site');
const render = (i) => {
  const out = [`- **${i.title}** (${i.source}${i.flair ? ', ' + i.flair : ''}${i.score ? `, ${i.score} pts, ${i.comments} comments` : ''}${i.date ? ', ' + i.date.slice(0, 16) : ''})`];
  if (i.thread) out.push(`  - Thread: ${i.thread}`);
  if (i.link) out.push(`  - Article: ${i.link}`);
  for (const u of i.images) out.push(`  - Image: ${u}`);
  return out.join('\n');
};
L.push('', '## Reddit, top of the day', '', ...reddit.map(render), '', '## Gaming sites, latest', '', ...site.map(render));
fs.writeFileSync(path.join(outDir, `${day}.md`), L.join('\n'));
console.log(`Wrote news/${day}.md (${items.length} items)`);
