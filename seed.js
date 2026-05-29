/**
 * Seed script — full TCGdex import for all languages.
 * Drops existing cards/sets/series and reimports from scratch.
 * Usage: node seed.js
 * Environment: LANGUAGES=en,ja (comma-separated)
 */
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

const LANGS = (process.env.LANGUAGES || 'en,ja').split(',').map(l => l.trim());
const API = 'https://api.tcgdex.net/v2';
const DB = process.env.NODE_ENV === 'production' ? '/data/pokemon.db' : './pokemon.db';

function fetchJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'poke-tcg/3.0' },
      family: 4,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', e => {
      if (retries > 1) {
        setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 1000);
      } else reject(e);
    });
    req.setTimeout(15000, () => { req.destroy(); 
      if (retries > 1) {
        setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 1000);
      } else reject(new Error('timeout'));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const db = new sqlite3.Database(DB);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function main() {
  console.log(`\n🔄 TCGdex Seed — Languages: ${LANGS.join(', ')}\n`);

  // ── Schema (drop + recreate for clean import) ──
  await dbRun(`DROP TABLE IF EXISTS card_resistances`);
  await dbRun(`DROP TABLE IF EXISTS card_weaknesses`);
  await dbRun(`DROP TABLE IF EXISTS card_abilities`);
  await dbRun(`DROP TABLE IF EXISTS card_attacks`);
  await dbRun(`DROP TABLE IF EXISTS collection`);
  await dbRun(`DROP TABLE IF EXISTS cards`);
  await dbRun(`DROP TABLE IF EXISTS sets`);
  await dbRun(`DROP TABLE IF EXISTS series`);
  await dbRun(`DROP TABLE IF EXISTS sessions`);
  await dbRun(`DROP TABLE IF EXISTS users`);

  await dbRun(`CREATE TABLE series (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL
  )`);
  await dbRun(`CREATE TABLE sets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, series_id TEXT,
    language TEXT NOT NULL, logo TEXT, symbol TEXT,
    card_count INTEGER DEFAULT 0, release_date TEXT
  )`);
  await dbRun(`CREATE TABLE cards (
    id TEXT NOT NULL, local_id TEXT NOT NULL, name TEXT NOT NULL,
    set_id TEXT NOT NULL, language TEXT NOT NULL,
    category TEXT, illustrator TEXT, rarity TEXT,
    image_url TEXT, image_hi TEXT, hp INTEGER, types TEXT,
    stage TEXT, evolve_from TEXT, suffix TEXT, retreat TEXT,
    description TEXT, effect TEXT, level TEXT,
    regulation TEXT, legal_std INTEGER DEFAULT 0, legal_exp INTEGER DEFAULT 0,
    variants TEXT, attacks TEXT, abilities TEXT, weaknesses TEXT, resistances TEXT,
    pricing TEXT, PRIMARY KEY (id, language)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS card_attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
    language TEXT NOT NULL, name TEXT, cost TEXT, damage TEXT, effect TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS card_abilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
    language TEXT NOT NULL, name TEXT, effect TEXT, type TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS card_weaknesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
    language TEXT NOT NULL, type TEXT, value TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS card_resistances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL,
    language TEXT NOT NULL, type TEXT, value TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT,
    user_id INTEGER DEFAULT 1, quantity INTEGER DEFAULT 1,
    condition TEXT DEFAULT 'Near Mint', language TEXT DEFAULT 'en',
    date_added TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS friends (
    user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, friend_id)
  )`);

  // Create indexes for fast filtering
  await dbRun(`CREATE INDEX idx_cards_set ON cards(set_id)`);
  await dbRun(`CREATE INDEX idx_cards_lang ON cards(language)`);
  await dbRun(`CREATE INDEX idx_cards_name ON cards(name)`);
  await dbRun(`CREATE INDEX idx_cards_rarity ON cards(rarity)`);
  await dbRun(`CREATE INDEX idx_cards_category ON cards(category)`);
  await dbRun(`CREATE INDEX idx_cards_type ON cards(types)`);
  await dbRun(`CREATE INDEX idx_cards_stage ON cards(stage)`);

  let globalCardCount = 0;
  let globalSetCount = 0;

  for (const lang of LANGS) {
    console.log(`\n═══ ${lang.toUpperCase()} ═══`);

    // ── Series ──
    const seriesList = await fetchJSON(`${API}/${lang}/series`);
    if (seriesList && Array.isArray(seriesList)) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO series (id, name, language) VALUES (?, ?, ?)`);
      for (const s of seriesList) {
        const detail = await fetchJSON(`${API}/${lang}/series/${s.id}`);
        stmt.run(s.id, detail?.name || s.name, lang);
        await sleep(15);
      }
      stmt.finalize();
      console.log(`  Series: ${seriesList.length}`);
    }

    // ── Sets ──
    const setsList = await fetchJSON(`${API}/${lang}/sets`);
    if (!setsList || !Array.isArray(setsList)) { console.log('  No sets found'); continue; }

    const setStmt = db.prepare(
      `INSERT OR REPLACE INTO sets (id, name, series_id, language, logo, symbol, card_count, release_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < setsList.length; i++) {
      const s = setsList[i];
      let detail = null;
      try {
        detail = await fetchJSON(`${API}/${lang}/sets/${s.id}`);
        await sleep(20);
      } catch {}

      const cardCount = detail?.cardCount
        ? (detail.cardCount.total || 0)
        : (s.cardCount?.total || 0);

      setStmt.run(
        s.id,
        detail?.name || s.name,
        detail?.serie?.id || s.serie?.id || null,
        lang,
        detail?.logo || s.logo || null,
        detail?.symbol || s.symbol || null,
        cardCount,
        detail?.releaseDate || s.releaseDate || null
      );

      process.stdout.write(`\r  Sets: ${i + 1}/${setsList.length}`);
    }
    setStmt.finalize();
    console.log(`\n  ✓ ${setsList.length} sets`);
    globalSetCount += setsList.length;

    // ── Cards — from set details (fast, one API call per set = full card list) ──
    let cardStmt = db.prepare(
      `INSERT OR REPLACE INTO cards
       (id, local_id, name, set_id, language, category, illustrator, rarity,
        image_url, image_hi, hp, types, stage, evolve_from, suffix, retreat,
        description, effect, level, regulation, legal_std, legal_exp, variants,
        attacks, abilities, weaknesses, resistances, pricing)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    let langCardCount = 0;
    let skipped = 0;

    for (let i = 0; i < setsList.length; i++) {
      const s = setsList[i];
      let detail = null;
      try {
        detail = await fetchJSON(`${API}/${lang}/sets/${s.id}`);
        await sleep(25);
      } catch { continue; }

      const cards = detail?.cards || [];
      if (!cards.length) { skipped++; continue; }

      for (const c of cards) {
        const cardDetail = {
          category: c.category || null,
          illustrator: c.illustrator || null,
          rarity: c.rarity || null,
          hp: c.hp || null,
          types: c.types ? JSON.stringify(c.types) : null,
          stage: c.stage || null,
          evolveFrom: c.evolveFrom || null,
          suffix: c.suffix || null,
          retreat: c.retreat != null ? c.retreat : null,
          description: c.description || null,
          effect: c.effect || null,
          level: c.level != null ? String(c.level) : null,
          regulationMark: c.regulationMark || null,
          legal: c.legal || null,
          variants: c.variants ? JSON.stringify(c.variants) : null,
          attacks: c.attacks ? JSON.stringify(c.attacks) : null,
          abilities: c.abilities ? JSON.stringify(c.abilities) : null,
          weaknesses: c.weaknesses ? JSON.stringify(c.weaknesses) : null,
          resistances: c.resistances ? JSON.stringify(c.resistances) : null,
          pricing: c.pricing ? JSON.stringify(c.pricing) : null,
        };

        // Build image URLs
        const seriePath = detail?.serie?.id || s.id.replace(/[0-9.]/g, '') || 'unknown';
        const imgLow = c.image || `https://assets.tcgdex.net/${lang}/${seriePath}/${s.id}/${c.localId || c.id.split('-')[1] || '001'}/low.png`;
        const imgHigh = imgLow.replace('/low.png', '/high.png');

        cardStmt.run(
          c.id,
          c.localId || c.id.split('-')[1] || '001',
          c.name,
          s.id,
          lang,
          cardDetail.category,
          cardDetail.illustrator,
          cardDetail.rarity,
          imgLow, imgHigh,
          cardDetail.hp,
          cardDetail.types,
          cardDetail.stage,
          cardDetail.evolveFrom,
          cardDetail.suffix,
          cardDetail.retreat,
          cardDetail.description,
          cardDetail.effect,
          cardDetail.level,
          cardDetail.regulationMark,
          cardDetail.legal?.standard ? 1 : 0,
          cardDetail.legal?.expanded ? 1 : 0,
          cardDetail.variants,
          cardDetail.attacks,
          cardDetail.abilities,
          cardDetail.weaknesses,
          cardDetail.resistances,
          cardDetail.pricing
        );
        langCardCount++;
      }

      process.stdout.write(`\r  Cards: ${langCardCount} (set ${i + 1}/${setsList.length})`);
    }

    cardStmt.finalize();
    console.log(`\n  ✓ ${langCardCount} cards (${skipped} empty sets skipped)`);
    globalCardCount += langCardCount;
  }

  console.log(`\n✅ Done! ${globalSetCount} sets, ${globalCardCount} cards\n`);
  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
