#!/usr/bin/env node
/**
 * Seed script: imports Pokemon TCG data from the public API
 * Run: node seed.js
 * This replaces the old data-source/ JSON import for deployment
 */
const https = require('https');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './pokemon.db';
const API_BASE = 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMONTCG_API_KEY || ''; // optional, free tier works without

const db = new sqlite3.Database(DB_PATH);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-Api-Key'] = API_KEY;
    mod.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function seed() {
  console.log('Seeding database from Pokemon TCG API...');

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, name TEXT, supertype TEXT, subtypes TEXT,
      hp INTEGER, types TEXT, evolvesFrom TEXT, level TEXT, rarity TEXT,
      artist TEXT, flavorText TEXT, nationalPokedexNumbers TEXT,
      number TEXT, setId TEXT, smallImageUrl TEXT, largeImageUrl TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY, name TEXT, series TEXT, printedTotal INTEGER,
      total INTEGER, releaseDate TEXT, symbolUrl TEXT, logoUrl TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS collection (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cardId TEXT, quantity INTEGER DEFAULT 1,
      condition TEXT DEFAULT 'Near Mint', dateAdded TEXT DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER DEFAULT 1, FOREIGN KEY (cardId) REFERENCES cards(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS attacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cardId TEXT, name TEXT,
      cost TEXT, damage TEXT, text TEXT, FOREIGN KEY (cardId) REFERENCES cards(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS abilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cardId TEXT, name TEXT,
      text TEXT, type TEXT, FOREIGN KEY (cardId) REFERENCES cards(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id)
    )`);
  });

  // Check if already seeded
  const count = await new Promise((resolve) => {
    db.get('SELECT COUNT(*) as c FROM cards', (err, row) => resolve(row ? row.c : 0));
  });
  if (count > 0) {
    console.log(`Database already has ${count} cards, skipping seed.`);
    db.close();
    return;
  }

  // Import sets first
  console.log('Fetching sets...');
  const setsData = await fetchJSON(`${API_BASE}/sets?pageSize=250`);
  if (setsData && setsData.data) {
    const setStmt = db.prepare('INSERT OR REPLACE INTO sets (id,name,series,printedTotal,total,releaseDate,symbolUrl,logoUrl) VALUES (?,?,?,?,?,?,?,?)');
    for (const s of setsData.data) {
      setStmt.run(s.id, s.name, s.series, s.printedTotal, s.total, s.releaseDate, s.images?.symbol, s.images?.logo);
    }
    setStmt.finalize();
    console.log(`Imported ${setsData.data.length} sets`);
  }

  // Import cards (paginated)
  let page = 1;
  let totalImported = 0;
  const cardStmt = db.prepare('INSERT OR REPLACE INTO cards (id,name,supertype,subtypes,hp,types,evolvesFrom,level,rarity,artist,flavorText,nationalPokedexNumbers,number,setId,smallImageUrl,largeImageUrl) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const attackStmt = db.prepare('INSERT INTO attacks (cardId,name,cost,damage,text) VALUES (?,?,?,?,?)');
  const abilityStmt = db.prepare('INSERT INTO abilities (cardId,name,text,type) VALUES (?,?,?,?)');

  while (true) {
    const data = await fetchJSON(`${API_BASE}/cards?page=${page}&pageSize=250`);
    if (!data || !data.data || data.data.length === 0) break;

    for (const c of data.data) {
      const setId = c.id.split('-')[0];
      cardStmt.run(c.id, c.name, c.supertype, JSON.stringify(c.subtypes||[]),
        c.hp ? parseInt(c.hp) : null, JSON.stringify(c.types||[]),
        c.evolvesFrom, c.level, c.rarity, c.artist, c.flavorText,
        JSON.stringify(c.nationalPokedexNumbers||[]), c.number, setId,
        c.images?.small, c.images?.large);
      (c.attacks||[]).forEach(a => attackStmt.run(c.id, a.name, JSON.stringify(a.cost), a.damage, a.text));
      (c.abilities||[]).forEach(a => abilityStmt.run(c.id, a.name, a.text, a.type));
      totalImported++;
    }

    console.log(`Page ${page}: ${totalImported} cards imported...`);
    page++;

    // Rate limit: be nice to the API
    await new Promise(r => setTimeout(r, 200));

    // Safety: stop after reasonable limit for free tier
    if (totalImported >= 25000) break;
  }

  cardStmt.finalize();
  attackStmt.finalize();
  abilityStmt.finalize();
  db.close();
  console.log(`Done! Imported ${totalImported} cards.`);
}

seed().catch(e => { console.error(e); process.exit(1); });
