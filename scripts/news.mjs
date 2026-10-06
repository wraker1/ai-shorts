// Usage: npm run news
// Pulls today's top gaming posts from Reddit and writes out/news-YYYY-MM-DD.md
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SUBS = ['Games', 'gaming', 'pcgaming', 'PS5', 'XboxSeriesX', 'NintendoSwitch'];
const UA = 'Mozilla/5.0 (compatible; gaming-shorts/0.1)';

async function top(sub) {
  const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=15`, {headers: {'User-Agent': UA}});
  if (!res.ok) throw new Error(`r/${sub}: HTTP ${res.status}`);
  const j = await res.json();
  return j.data.children
    .map((c) => c.data)
    .filter((p) => !p.stickied && !p.over_18)
    .map((p) => ({
      sub,
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      thread: `https://www.reddit.com${p.permalink}`,
      link: p.is_self ? '' : p.url,
      flair: p.link_flair_text || '',
    }));
}

const all = [];
for (const sub of SUBS) {
  try {
    all.push(...(await top(sub)));
  } catch (e) {
    console.warn(String(e.message || e));
  }
}
if (!all.length) {
  console.error('No posts fetched. Reddit may be blocking this request; try again later or from another network.');
  process.exit(1);
}
all.sort((a, b) => b.score - a.score);

const day = new Date().toISOString().slice(0, 10);
const lines = [`# Gaming news candidates ${day}`, '', 'Verify every claim at the source before making a short.', ''];
for (const p of all.slice(0, 40)) {
  lines.push(`- **${p.title}** (r/${p.sub}${p.flair ? ', ' + p.flair : ''}, ${p.score} pts, ${p.comments} comments)`);
  lines.push(`  - Thread: ${p.thread}`);
  if (p.link) lines.push(`  - Article: ${p.link}`);
}
fs.mkdirSync(path.join(root, 'out'), {recursive: true});
const file = path.join(root, 'out', `news-${day}.md`);
fs.writeFileSync(file, lines.join('\n'));
console.log(`Wrote ${file} (${all.length} posts)`);
