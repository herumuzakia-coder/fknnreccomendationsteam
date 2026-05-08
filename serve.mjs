import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { fields.push(field); field = ''; }
      else field += c;
    }
  }
  fields.push(field);
  return fields;
}

console.log('Loading game data (this may take a moment)...');
const csvPath = path.join(__dirname, 'assets', 'steam_preprocessed.csv');
const csvText = fs.readFileSync(csvPath, 'utf-8');
const lines = csvText.split('\n');

const headerRow = parseCSVLine(lines[0]);
const HEADER_IMG_IDX = headerRow.indexOf('header_image');
const SHORT_DESC_IDX = headerRow.indexOf('short_description');
const FEATURE_START = 4;
const FEATURE_END = HEADER_IMG_IDX;
const NUM_FEATURES = FEATURE_END - FEATURE_START;
const featureNames = headerRow.slice(FEATURE_START, FEATURE_END);

console.log(`Columns: ${headerRow.length}, Features: ${NUM_FEATURES}, parsing...`);

const games = [];
const invertedIndex = Array.from({ length: NUM_FEATURES }, () => []);
const genreSet = new Set();

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const row = parseCSVLine(line);
  if (row.length < HEADER_IMG_IDX + 1) continue;

  const sparse = [];
  let norm = 0;
  for (let j = 0; j < NUM_FEATURES; j++) {
    const val = parseFloat(row[FEATURE_START + j]);
    if (val > 0) { sparse.push({ idx: j, val }); norm += val * val; }
  }
  norm = Math.sqrt(norm);
  if (norm > 0) sparse.forEach(s => (s.val /= norm));

  const genres = row[2] || '';
  const tags = row[3] || '';
  genres.split(';').forEach(g => { if (g.trim()) genreSet.add(g.trim()); });

  const gIdx = games.length;
  games.push({
    appid: row[0],
    name: row[1],
    genres,
    tags,
    headerImage: row[HEADER_IMG_IDX] || '',
    shortDesc: (row[SHORT_DESC_IDX] || '').slice(0, 300),
    sparse,
    idx: gIdx,
  });

  sparse.forEach(({ idx, val }) => invertedIndex[idx].push({ gIdx, val }));
}

console.log(`Loaded ${games.length} games. Server starting...`);

const appidMap = new Map(games.map(g => [g.appid, g.idx]));
const genres = [...genreSet].sort();

function safeGame(g) {
  return { appid: g.appid, name: g.name, genres: g.genres, tags: g.tags, headerImage: g.headerImage, shortDesc: g.shortDesc };
}

// ── Recommendation cache (LRU-like, capped at 500 entries) ──────────────────
const recCache = new Map();
const CACHE_MAX = 500;

function cacheSet(key, val) {
  if (recCache.size >= CACHE_MAX) recCache.delete(recCache.keys().next().value);
  recCache.set(key, val);
}

// ── Fuzzy KNN with inverted index ───────────────────────────────────────────
function recommend(appid, k = 12) {
  const cacheKey = `${appid}:${k}`;
  if (recCache.has(cacheKey)) return recCache.get(cacheKey);

  const gIdx = appidMap.get(appid);
  if (gIdx === undefined) return [];

  const scores = new Float32Array(games.length);
  const queryGame = games[gIdx];

  queryGame.sparse.forEach(({ idx, val }) => {
    invertedIndex[idx].forEach(({ gIdx: dIdx, val: dVal }) => { scores[dIdx] += val * dVal; });
  });
  scores[gIdx] = -1;

  // Collect candidates above threshold
  const top = [];
  for (let i = 0; i < games.length; i++) { if (scores[i] > 0.01) top.push(i); }
  top.sort((a, b) => scores[b] - scores[a]);
  const topK = top.slice(0, k);

  // Build query feature map for "Why similar"
  const qFeatureMap = new Map();
  queryGame.sparse.forEach(({ idx, val }) => qFeatureMap.set(idx, val));

  const result = topK.map(i => {
    const g = games[i];

    // Top shared TF-IDF features (weighted by joint contribution)
    const shared = [];
    g.sparse.forEach(({ idx, val }) => {
      if (qFeatureMap.has(idx)) {
        shared.push({ name: featureNames[idx].replace(/_/g, ' '), score: qFeatureMap.get(idx) * val });
      }
    });
    shared.sort((a, b) => b.score - a.score);
    const whySimilar = shared.slice(0, 4).map(f => f.name);

    return { game: safeGame(g), score: Math.round(scores[i] * 1000) / 10, whySimilar };
  });

  cacheSet(cacheKey, result);
  return result;
}

// ── Trigram fuzzy search ─────────────────────────────────────────────────────
function trigrams(str) {
  const s = ('  ' + str.toLowerCase() + '  ');
  const set = new Set();
  for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
  return set;
}

function trigramSim(a, b) {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

function fuzzySearch(query, limit = 40) {
  const q = query.trim();
  if (!q) return games.slice(0, limit).map(safeGame);

  const qLower = q.toLowerCase();
  const results = [];

  for (const g of games) {
    const name = g.name.toLowerCase();
    let score = 0;

    if (name === qLower) score = 100;
    else if (name.startsWith(qLower)) score = 85 + (qLower.length / name.length) * 15;
    else if (name.includes(qLower)) score = 65 + (qLower.length / name.length) * 20;
    else {
      const ts = trigramSim(qLower, name);
      score = ts * 60;
    }

    if (score > 18) results.push({ score, g });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => safeGame(r.g));
}

// ── Random game ──────────────────────────────────────────────────────────────
function randomGame() {
  return safeGame(games[Math.floor(Math.random() * games.length)]);
}

// ── Top tags ─────────────────────────────────────────────────────────────────
const topTags = (() => {
  const counts = new Map();
  for (const g of games) {
    (g.tags || '').split(';').forEach(t => {
      const tag = t.trim();
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
})();

// ── Static file MIME types ───────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
};

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  if (p === '/api/games') {
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '40'), 100);
    const genre = url.searchParams.get('genre') || '';
    const tag = url.searchParams.get('tag') || '';
    let pool = games;
    if (genre) pool = pool.filter(g => g.genres.includes(genre));
    if (tag) pool = pool.filter(g => g.tags.split(';').map(t => t.trim()).includes(tag));
    const start = (page - 1) * limit;
    const slice = pool.slice(start, start + limit).map(safeGame);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ games: slice, total: pool.length, page, limit, hasMore: start + limit < pool.length }));
    return;
  }

  if (p === '/api/genres') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(genres));
    return;
  }

  if (p === '/api/tags') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(topTags));
    return;
  }

  if (p === '/api/random') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(randomGame()));
    return;
  }

  if (p.startsWith('/api/recommend/')) {
    const appid = p.split('/').pop();
    const k = Math.min(parseInt(url.searchParams.get('k') || '12'), 24);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(recommend(appid, k)));
    return;
  }

  if (p === '/api/search') {
    const q = url.searchParams.get('q') || '';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(fuzzySearch(q)));
    return;
  }

  // Static files
  let filePath;
  if (p.startsWith('/assets/')) {
    filePath = path.join(__dirname, p.slice(1));
  } else {
    filePath = path.join(__dirname, p === '/' ? 'index.html' : p.slice(1));
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  FKNN Game Recommender -> http://localhost:${PORT}\n`);
});
