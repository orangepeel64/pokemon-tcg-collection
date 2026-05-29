/**
 * Metadata enrichment script — fetches full card details from TCGdex API
 * for ALL cards that have NULL rarity (missing metadata).
 * 
 * Processes cards in parallel batches with rate limiting.
 * Can be safely interrupted and resumed.
 */
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

const API_BASE = 'https://api.tcgdex.net/v2';
const dbPath = process.env.NODE_ENV === 'production' ? '/data/pokemon.db' : './pokemon.db';
const db = new sqlite3.Database(dbPath);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'pokemon-tcg-collection/3.0' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function enrich() {
  console.log('=== Pokémon TCG — Metadata Enrichment ===\n');

  // Step 1: Count cards missing metadata
  const missing = await new Promise(r => db.get(
    `SELECT COUNT(*) as c FROM cards WHERE rarity IS NULL`,
    [], (e, row) => r(row?.c || 0)
  ));
  const total = await new Promise(r => db.get(
    `SELECT COUNT(*) as c FROM cards`, [], (e, row) => r(row?.c || 0)
  ));
  console.log(`Cards total: ${total}, Missing metadata: ${missing}`);

  if (missing === 0) {
    console.log('All cards already enriched!');
    db.close();
    return;
  }

  // Step 2: Get all card IDs grouped by language, ordered by set recency (most recent first)
  const cards = await new Promise(r => db.all(
    `SELECT c.id, c.language, c.set_id, s.release_date
     FROM cards c
     LEFT JOIN sets s ON c.set_id = s.id
     WHERE c.rarity IS NULL
     ORDER BY s.release_date DESC, c.id`,
    [], (e, rows) => r(rows || [])
  ));

  console.log(`Cards to enrich: ${cards.length}`);
  console.log(`First few: ${cards.slice(0, 5).map(c => c.id).join(', ')}`);
  console.log('\nStarting batch enrichment (5 parallel, 150ms delay)...\n');

  // Progress tracking
  const totalCards = cards.length;
  let enriched = 0;
  let errors = 0;
  const startTime = Date.now();

  // DB update helper
  const dbRun = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); });
  });

  // Process in batches of 5 parallel
  const BATCH_SIZE = 5;
  const DELAY = 150;

  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (card) => {
      try {
        const fullCard = await fetchJSON(`${API_BASE}/${card.language}/cards/${card.id}`);
        await sleep(DELAY);

        await dbRun(`UPDATE cards SET
          category = ?, illustrator = ?, rarity = ?, dex_id = ?,
          hp = ?, types = ?, evolve_from = ?, stage = ?, suffix = ?,
          retreat = ?, weight = ?, description = ?, level = ?,
          effect = ?, trainer_type = ?, energy_type = ?,
          regulation_mark = ?, legal_standard = ?, legal_expanded = ?,
          variant_types = ?, detail_fetched = 1, pricing = ?
          WHERE id = ? AND language = ?`, [
          fullCard.category || null, fullCard.illustrator || null, fullCard.rarity || null,
          fullCard.dexId ? JSON.stringify(fullCard.dexId) : null,
          fullCard.hp || null, fullCard.types ? JSON.stringify(fullCard.types) : null,
          fullCard.evolveFrom || null, fullCard.stage || null, fullCard.suffix || null,
          fullCard.retreat != null ? fullCard.retreat : null, fullCard.weight || null,
          fullCard.description || null, fullCard.level != null ? String(fullCard.level) : null,
          fullCard.effect || null, fullCard.trainerType || null, fullCard.energyType || null,
          fullCard.regulationMark || null, fullCard.legal?.standard ? 1 : 0,
          fullCard.legal?.expanded ? 1 : 0,
          fullCard.variants ? JSON.stringify(fullCard.variants) : null,
          fullCard.pricing ? JSON.stringify(fullCard.pricing) : null,
          card.id, card.language
        ]);

        // Attacks
        if (fullCard.attacks) {
          await dbRun("DELETE FROM card_attacks WHERE card_id = ?", [card.id]);
          for (const a of fullCard.attacks) {
            await dbRun("INSERT OR IGNORE INTO card_attacks (card_id, name, cost, damage, effect) VALUES (?, ?, ?, ?, ?)",
              [card.id, a.name, a.cost ? JSON.stringify(a.cost) : null, a.damage != null ? String(a.damage) : null, a.effect || null]);
          }
        }

        // Abilities
        if (fullCard.abilities) {
          await dbRun("DELETE FROM card_abilities WHERE card_id = ?", [card.id]);
          for (const a of fullCard.abilities) {
            await dbRun("INSERT OR IGNORE INTO card_abilities (card_id, name, effect, type) VALUES (?, ?, ?, ?)",
              [card.id, a.name, a.effect || null, a.type || null]);
          }
        }

        // Weaknesses
        if (fullCard.weaknesses) {
          await dbRun("DELETE FROM card_weaknesses WHERE card_id = ?", [card.id]);
          for (const w of fullCard.weaknesses) {
            await dbRun("INSERT OR IGNORE INTO card_weaknesses (card_id, type, value) VALUES (?, ?, ?)",
              [card.id, w.type, w.value || null]);
          }
        }

        // Resistances
        if (fullCard.resistances) {
          await dbRun("DELETE FROM card_resistances WHERE card_id = ?", [card.id]);
          for (const r of fullCard.resistances) {
            await dbRun("INSERT OR IGNORE INTO card_resistances (card_id, type, value) VALUES (?, ?, ?)",
              [card.id, r.type, r.value || null]);
          }
        }

        enriched++;
      } catch (e) {
        errors++;
        if (errors < 10) {
          console.error(`  ✗ ${card.id}: ${e.message.substring(0, 60)}`);
        }
      }
    }));

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const pct = ((i + BATCH_SIZE) / totalCards * 100).toFixed(1);
    const rate = (enriched / elapsed).toFixed(1);
    process.stdout.write(`\r  ${Math.min(enriched + errors, i + BATCH_SIZE)}/${totalCards} (${pct}%) · ${enriched} enriched · ${errors} errors · ${elapsed}s · ${rate}/s`);
  }

  console.log('\n\n=== Enrichment Complete! ===');
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Time: ${elapsed}s`);

  // Verify
  const stillMissing = await new Promise(r => db.get(
    "SELECT COUNT(*) as c FROM cards WHERE rarity IS NULL",
    [], (e, row) => r(row?.c || 0)
  ));
  console.log(`  Still missing metadata: ${stillMissing}`);

  db.close();
}

enrich().catch(e => { console.error('FAILED:', e); process.exit(1); });
