'use strict';
// ============================================================================
// NZBio Scraper C — nzb.su, abNZB, Digital Carnage, omgwtfnzbs
// node scraper-c.js  →  http://localhost:3003/search?q=Inception+2010
// ============================================================================

const https = require('https');
const http  = require('http');
const PORT  = process.env.PORT || 3003;

const INDEXERS = [
  { name: 'nzb.su',         url: 'https://api.nzb.su/api',           apiKey: '5cffe891450e6bc6fd4f5bb2741161af' },
  { name: 'abNZB',          url: 'https://abnzb.com/api',            apiKey: 'e05d6edcb41366b339e3998fc74727fb' },
  { name: 'Digital Carnage',url: 'https://digitalcarnage.info/api',  apiKey: '1c601ea8a3ea564768084ada7edeb190' },
  { name: 'omgwtfnzbs',     url: 'https://api.omgwtfnzbs.org/api',   apiKey: 'u6akXNfTCKumrHQ6T4nM1cM0ca9uwVwq' },
];

const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_SIZE = 50 * 1024 * 1024;
const TIMEOUT  = 12000;

// These indexers need referer/origin headers to avoid 403s
function headersFor(name) {
  const h = { 'User-Agent': UA, 'Accept': 'application/xml,text/xml', 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en-GB,en;q=0.9', 'DNT': '1' };
  if (/omgwtf/i.test(name))           { h['Referer'] = 'https://omgwtfnzbs.org/';      h['Origin'] = 'https://omgwtfnzbs.org'; }
  if (/abnzb/i.test(name))            { h['Referer'] = 'https://abnzb.com/';           h['Origin'] = 'https://abnzb.com'; }
  if (/nzb\.su/i.test(name))          { h['Referer'] = 'https://nzb.su/';              h['Origin'] = 'https://nzb.su'; }
  if (/digital.?carnage/i.test(name)) { h['Referer'] = 'https://digitalcarnage.info/'; h['Origin'] = 'https://digitalcarnage.info'; }
  return h;
}

function nodeFetch(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: () => Buffer.concat(chunks).toString('utf8') }));
    });
    const t = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, TIMEOUT);
    req.on('error', e => { clearTimeout(t); reject(e); });
    req.on('response', () => clearTimeout(t));
  });
}

async function searchIndexer(indexer, query) {
  try {
    let res = await nodeFetch(`${indexer.url}?apikey=${indexer.apiKey}&t=search&q=${encodeURIComponent(query)}&extended=1`, headersFor(indexer.name));
    if (res.status === 403) {
      console.warn(`[${indexer.name}] 403 — retrying without cat`);
      res = await nodeFetch(`${indexer.url}?apikey=${indexer.apiKey}&t=search&q=${encodeURIComponent(query)}`, headersFor(indexer.name));
    }
    if (!res.ok) { console.error(`[${indexer.name}] HTTP ${res.status}`); return []; }
    const items = parseXML(res.text());
    console.log(`[${indexer.name}] ${items.length} results`);
    return items.map(i => ({ ...i, indexer: indexer.name }));
  } catch (e) { console.error(`[${indexer.name}] ${e.message}`); return []; }
}

function parseXML(xml) {
  const items    = [];
  const itemRx   = /<item>([\s\S]*?)<\/item>/gi;
  const unwanted = [/\baudio\b/i,/audiobook/i,/ebook/i,/music/i,/mp3/i,/flac/i,/\bbook\b/i,/magazine/i,/comic/i,/xxx/i,/porn/i,/sample/i,/\bhdr/i,/dolby.?vision/i,/\bdovi\b/i,/\bdv\b/i,/\bhlg\b/i];
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const c = m[1];
    const title = extractTag(c, 'title'), link = extractTag(c, 'link');
    if (!title || !link) continue;
    const encM = c.match(/<enclosure[^>]*length="(\d+)"[^>]*>/i);
    const sizeInBytes = encM ? parseInt(encM[1], 10) : 0;
    if (sizeInBytes > 0 && sizeInBytes < MIN_SIZE) continue;
    const category = extractTag(c, 'category') || 'Unknown';
    if (unwanted.some(r => r.test(category) || r.test(title))) continue;
    let size = 'Unknown';
    if      (sizeInBytes > 1024 ** 3) size = `${(sizeInBytes / 1024 ** 3).toFixed(2)} GB`;
    else if (sizeInBytes > 1024 ** 2) size = `${(sizeInBytes / 1024 ** 2).toFixed(2)} MB`;
    items.push({ title, link, pubDate: extractTag(c, 'pubDate'), sizeInBytes, size, category });
  }
  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<!\[CDATA\[(.*?)\]\]>/g,'$1');
}

async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const q = new URL(req.url, `http://${req.headers.host}`).searchParams.get('q');
  if (!q) { res.writeHead(200, {'Content-Type':'text/plain'}); res.end('Scraper C online. /search?q=Title+Year\n'); return; }
  console.log(`[Scraper C] "${q}"`);
  const all    = (await Promise.all(INDEXERS.map(i => searchIndexer(i, q)))).flat();
  const unique = Array.from(new Map(all.map(i => [i.link, i])).values());
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ results: unique, count: unique.length }));
}

module.exports = handle;
if (require.main === module) {
  http.createServer(handle).listen(PORT, () => console.log(`Scraper C on http://localhost:${PORT}`));
}
