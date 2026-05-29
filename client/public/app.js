/* ═══════════════════════════════════════════
   POKÉMON TCG — Client App
   ═══════════════════════════════════════════ */

const S = {
  token: localStorage.getItem('poke_token') || null,
  user: null,
  lang: localStorage.getItem('poke_lang') || 'en',
  filters: { set: '', category: '', type: '', rarity: '', stage: '', search: '', sort: 'name', order: 'asc' },
  cards: [], offset: 0, limit: 48, total: 0, loadedAll: false, loading: false,
  filterOpts: { sets: [], rarities: [], categories: [], stages: [], types: [] },
};

/* ── UTILS ── */
const $ = id => document.getElementById(id);
const sel = q => document.querySelector(q);
const selAll = q => document.querySelectorAll(q);

const typeColors = {
  Colorless: '#a0a0a0', Darkness: '#5a4a6a', Dragon: '#c89b3c',
  Fairy: '#f0a0c0', Fighting: '#c03028', Fire: '#f08030',
  Grass: '#78c850', Lighting: '#f8d030', Metal: '#a8a8c0',
  Psychic: '#f85888', Water: '#6890f0', Fire: '#f08030'
};
function typeColor(t) { return typeColors[t] || '#888'; }

function toast(msg, type = 'info') {
  const c = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

let _debounceTimer;
function debounceSearch() { clearTimeout(_debounceTimer); _debounceTimer = setTimeout(applyFilters, 350); }

function params(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
}

/* ── API ── */
async function api(path, opts = {}) {
  const h = {};
  if (S.token) h['Authorization'] = `Bearer ${S.token}`;
  const r = await fetch(path, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
  if (r.status === 401 && S.token) {
    S.token = null; localStorage.removeItem('poke_token'); S.user = null; updateAuthUI();
  }
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })); throw new Error(e.error || 'API error'); }
  return r.json();
}

/* ── AUTH ── */
async function checkAuth() {
  if (!S.token) return;
  try {
    S.user = await api('/api/auth/me');
    updateAuthUI();
    toast(`Welcome back, ${S.user.username}!`, 'success');
  } catch { S.token = null; localStorage.removeItem('poke_token'); S.user = null; updateAuthUI(); }
}

function updateAuthUI() {
  const authBtn = $('header-auth');
  const userArea = $('user-info');
  if (S.user) {
    authBtn.classList.add('hidden');
    userArea.classList.remove('hidden');
    $('user-name').textContent = S.user.username;
  } else {
    authBtn.classList.remove('hidden');
    userArea.classList.add('hidden');
  }
}

function openAuth() { $('modal-auth').classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
function switchAuthTab(tab) {
  selAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('form-login').classList.toggle('hidden', tab !== 'login');
  $('form-signup').classList.toggle('hidden', tab !== 'signup');
}

async function doLogin(e) {
  e.preventDefault();
  try {
    const d = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('login-user').value, password: $('login-pass').value })
    });
    S.token = d.token; localStorage.setItem('poke_token', d.token);
    S.user = d.user; updateAuthUI(); closeModal('modal-auth');
    toast(`Welcome back, ${d.user.username}!`, 'success');
  } catch (e) { $('login-err').textContent = e.message; }
}

async function doSignup(e) {
  e.preventDefault();
  try {
    const d = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: $('su-user').value, email: $('su-email').value, password: $('su-pass').value })
    });
    S.token = d.token; localStorage.setItem('poke_token', d.token);
    S.user = d.user; updateAuthUI(); closeModal('modal-auth');
    toast(`Welcome, ${d.user.username}!`, 'success');
  } catch (e) { $('su-err').textContent = e.message; }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  S.token = null; localStorage.removeItem('poke_token'); S.user = null; updateAuthUI(); toast('Logged out');
}

/* ── FRIENDS ── */
function openFriends() {
  if (!S.user) { toast('Sign in first', 'error'); openAuth(); return; }
  $('modal-friends').classList.remove('hidden'); loadFriends();
}

async function loadFriends() {
  try {
    const friends = await api('/api/friends');
    const list = $('friends-list');
    if (!friends.length) { list.innerHTML = '<p style="color:var(--text3);text-align:center;padding:1rem;">No friends yet</p>'; return; }
    list.innerHTML = friends.map(f => `
      <div class="sec" style="margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:500">${f.username}</span>
        <div style="display:flex;gap:4px">
          <button class="btn ghost sm" onclick="removeFriend(${f.id})">Remove</button>
        </div>
      </div>
    `).join('');
  } catch { toast('Failed to load friends', 'error'); }
}

async function addFriend() {
  const u = $('friend-input').value.trim();
  if (!u) return;
  try {
    await api('/api/friends/add', { method: 'POST', body: JSON.stringify({ username: u }) });
    $('friend-input').value = '';
    toast(`Added ${u}!`, 'success');
    loadFriends();
  } catch (e) { toast(e.message, 'error'); }
}

async function removeFriend(id) {
  try { await api(`/api/friends/${id}`, { method: 'DELETE' }); loadFriends(); }
  catch { toast('Failed to remove', 'error'); }
}

/* ── NAVIGATION ── */
function navigate(page, data) {
  selAll('.page').forEach(p => p.classList.remove('active'));
  selAll('.nav-item').forEach(b => b.classList.remove('active'));
  $(`page-${page}`) && $(`page-${page}`).classList.add('active');
  sel(`[data-page="${page}"]`) && sel(`[data-page="${page}"]`).classList.add('active');

  if (page === 'collection' && S.user) renderCollection();
  if (page === 'card' && data) loadCardDetail(data);

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    // sidebar closes via CSS
  }
}

/* ── FILTERS ── */
function syncFiltersFromUI() {
  S.filters.set = $('f-set').value;
  S.filters.category = $('f-category').value;
  S.filters.type = $('f-type').value;
  S.filters.rarity = $('f-rarity').value;
  S.filters.stage = $('f-stage').value;
  S.filters.search = $('f-search').value;
  S.filters.sort = $('f-sort').value;
  S.filters.order = $('f-order').value;
}

async function applyFilters() {
  syncFiltersFromUI();
  S.offset = 0; S.cards = []; S.loadedAll = false;
  await fetchCards(true);
}

function clearSearch() {
  $('f-search').value = '';
  $('search-clear').classList.add('hidden');
  applyFilters();
}

async function resetFilters() {
  S.filters = { set: '', category: '', type: '', rarity: '', stage: '', search: '', sort: 'name', order: 'asc' };
  $('f-set').value = '';
  $('f-category').value = '';
  $('f-type').value = '';
  $('f-rarity').value = '';
  $('f-stage').value = '';
  $('f-search').value = '';
  $('f-sort').value = 'name';
  $('f-order').value = 'asc';
  $('search-clear').classList.add('hidden');
  await applyFilters();
}

async function changeLanguage() {
  S.lang = $('f-language').value;
  localStorage.setItem('poke_lang', S.lang);
  // Reset set-specific filters when changing language (different set IDs)
  S.filters.set = '';
  await loadFilterOptions();
  await applyFilters();
}

async function loadFilterOptions() {
  try {
    // Load sets and filter options
    const [sets, filters] = await Promise.all([
      api(`/api/sets?language=${S.lang}`),
      api(`/api/filters?language=${S.lang}`)
    ]);

    S.filterOpts = filters;

    // Populate set dropdown — sorted by release date desc, but alphabetically within same date
    const setSelect = $('f-set');
    const currentSet = setSelect.value;
    setSelect.innerHTML = '<option value="">All Sets</option>';
    sets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.cardCount || 0})`;
      setSelect.appendChild(opt);
    });
    if (currentSet) setSelect.value = currentSet;

    // Populate other filters
    populateSelect('f-type', filters.types, 'All Types');
    populateSelect('f-rarity', filters.rarities, 'All Rarities');
    populateSelect('f-category', filters.categories, 'All');
    populateSelect('f-stage', filters.stages, 'All Stages');

    // Update total count display
    const totalEl = $('total-cards');
    if (totalEl) {
      const totalCount = sets.reduce((sum, s) => sum + (s.cardCount || 0), 0);
      totalEl.textContent = totalCount.toLocaleString();
    }
  } catch { toast('Failed to load filters', 'error'); }
}

function populateSelect(id, options, defaultLabel) {
  const el = $(id);
  if (!el) return;
  const currentVal = el.value;
  el.innerHTML = `<option value="">${defaultLabel}</option>`;
  (options || []).forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
  // Restore selection if still valid
  if (currentVal && options && options.includes(currentVal)) el.value = currentVal;
}

/* ── CARDS ── */
async function fetchCards(replace = false) {
  if (S.loading) return;
  S.loading = true;

  const q = {
    language: S.lang,
    set: S.filters.set,
    category: S.filters.category,
    type: S.filters.type,
    rarity: S.filters.rarity,
    stage: S.filters.stage,
    search: S.filters.search,
    sortBy: S.filters.sort,
    sortDir: S.filters.order,
    limit: S.limit, offset: S.offset
  };

  try {
    const [cards, countRes] = await Promise.all([
      api(`/api/cards?${params(q)}`),
      api(`/api/cards/count?${params({ ...q, limit: '', offset: '' })}`)
    ]);

    S.total = countRes.count;
    S.loadedAll = cards.length < S.limit;
    if (replace) S.cards = cards;
    else S.cards = [...S.cards, ...cards];
    S.offset = S.cards.length;

    renderCards();
    $('load-more-wrap').classList.toggle('hidden', S.loadedAll || S.cards.length >= S.total);

    // Search clear button visibility
    $('search-clear').classList.toggle('hidden', !S.filters.search);
  } catch { toast('Failed to load cards', 'error'); }
  finally { S.loading = false; }
}

function renderCards() {
  const grid = $('card-grid');
  const empty = $('empty-state');
  const stats = $('result-count');

  if (!S.cards.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    stats.textContent = S.filters.search ? 'No cards match your search' : 'No cards found';
    return;
  }

  empty.classList.add('hidden');
  stats.textContent = `${S.cards.length.toLocaleString()} of ${S.total.toLocaleString()} cards`;

  grid.innerHTML = S.cards.map((c, i) => {
    const types = c.types || [];
    const typeBadges = types.map(t =>
      `<span class="type-badge" style="color:${typeColor(t)}">${t[0]}</span>`
    ).join('');

    const rarityClass = getRarityClass(c.rarity);

    return `
    <div class="card-cell" style="animation-delay:${(i % 48) * 25}ms" onclick="navigate('card','${c.id}')">
      <div class="img-wrap">
        <img src="${c.image || ''}" alt="${c.name}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="card-placeholder" style="display:none">
          <div class="letter">${c.name[0] || '?'}</div>
          <div class="name">${c.name}</div>
        </div>
      </div>
      <div class="info">
        <div class="card-name">${c.name}</div>
        <div class="card-sub">${c.id}</div>
        ${rarityClass || types.length ? `<div class="badges">
          ${rarityClass ? `<span class="badge ${rarityClass}">${c.rarity || ''}</span>` : ''}
          ${typeBadges}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function getRarityClass(r) {
  if (!r) return '';
  const lo = r.toLowerCase();
  if (lo.includes('hyper') || lo.includes('secret') || lo.includes('rainbow') || lo.includes('gold')) return 'rarity-ultra';
  if (lo.includes('ultra') || lo.includes('illustration') || lo.includes('shiny ultra')) return 'rarity-ultra';
  if (lo.includes('rare') && (lo.includes('holo') || lo.includes('v ') || lo.includes('ex') || lo.includes('gx') || lo.includes('vmax'))) return 'rarity-holo';
  if (lo.includes('holo')) return 'rarity-holo';
  if (lo.includes('rare')) return 'rarity-rare';
  if (lo.includes('uncommon')) return 'rarity-uncommon';
  return 'rarity-common';
}

async function loadMore() {
  if (!S.loading && !S.loadedAll) await fetchCards(false);
}

/* ── CARD DETAIL ── */
async function loadCardDetail(id) {
  const el = $('card-detail');
  el.innerHTML = '<div style="text-align:center;padding:4rem;color:var(--text3)">Loading...</div>';
  try {
    const c = await api(`/api/cards/${id}?language=${S.lang}`);
    const types = c.types || [];
    const typeTags = types.map(t =>
      `<span class="tag" style="border-color:${typeColor(t)}44;color:${typeColor(t)};background:${typeColor(t)}15">${t}</span>`
    ).join('');

    const statsHTML = [
      c.hp ? { l: 'HP', v: c.hp } : null,
      c.stage ? { l: 'Stage', v: c.stage } : null,
      c.evolveFrom ? { l: 'Evolves From', v: c.evolveFrom } : null,
      c.suffix ? { l: 'Type', v: c.suffix } : null,
      c.retreat != null ? { l: 'Retreat', v: '🔴'.repeat(c.retreat) } : null,
      c.rarity ? { l: 'Rarity', v: c.rarity } : null,
      c.illustrator ? { l: 'Artist', v: c.illustrator } : null,
      c.regulationMark ? { l: 'Regulation', v: c.regulationMark } : null,
      c.set ? { l: 'Set', v: c.set.name } : null,
    ].filter(Boolean);

    const statsGrid = statsHTML.map(s => `
      <div class="stat-item"><span class="stat-label">${s.l}</span><span class="stat-val">${s.v}</span></div>
    `).join('');

    // Attacks
    let attacksHTML = '';
    if (c.attacks && c.attacks.length) {
      attacksHTML = `<div class="sec"><div class="sec-header">Attacks</div><div class="sec-body">
        ${c.attacks.map(a => `
          <div class="attack-card">
            <div class="attack-hdr">
              ${a.cost ? `<div class="attack-cost">${a.cost.map(c2 => `<span style="background:${typeColor(c2)}">${c2[0]}</span>`).join('')}</div>` : ''}
              <span class="attack-name">${a.name}</span>
              ${a.damage ? `<span class="attack-dmg">${a.damage}</span>` : ''}
            </div>
            ${a.effect ? `<div class="attack-eff">${a.effect}</div>` : ''}
          </div>
        `).join('')}
      </div></div>`;
    }

    // Abilities
    let abilitiesHTML = '';
    if (c.abilities && c.abilities.length) {
      abilitiesHTML = `<div class="sec"><div class="sec-header">Abilities</div><div class="sec-body">
        ${c.abilities.map(a => `
          <div class="attack-card">
            <div class="attack-hdr"><span class="attack-name" style="color:var(--purple)">${a.type || 'Ability'}: ${a.name}</span></div>
            ${a.effect ? `<div class="attack-eff">${a.effect}</div>` : ''}
          </div>
        `).join('')}
      </div></div>`;
    }

    // Weaknesses & Resistances
    let weakHTML = '';
    if (c.weaknesses && c.weaknesses.length) {
      weakHTML = `<div class="sec"><div class="sec-header">Weaknesses</div><div class="sec-body">
        <div class="tags">${c.weaknesses.map(w => `<span class="tag">${w.type} ${w.value || ''}</span>`).join('')}</div>
      </div></div>`;
    }

    // Description
    let descHTML = '';
    if (c.description) descHTML = `<div class="sec"><div class="sec-header">Pokédex</div><div class="sec-body"><p style="font-style:italic;color:var(--text2)">"${c.description}"</p></div></div>`;

    // Collection controls
    let collHTML = '';
    if (S.user) {
      collHTML = `
        <div class="coll-ctrl">
          <label>Qty:</label>
          <input type="number" id="coll-qty" value="1" min="1" max="999">
          <label>Condition:</label>
          <select id="coll-cond">
            <option>Near Mint</option>
            <option>Lightly Played</option>
            <option>Moderately Played</option>
            <option>Heavily Played</option>
            <option>Damaged</option>
          </select>
          <button class="btn primary" onclick="addToColl('${c.id}')">Add to Collection</button>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="detail-layout">
        <div class="detail-img">
          <img src="${c.imageHigh || c.image || ''}" alt="${c.name}" onerror="this.src='${c.image || ''}'">
        </div>
        <div class="detail-info">
          <h1>${c.name}</h1>
          <div class="detail-sub">${c.id} · ${c.category || '—'} · ${S.lang === 'ja' ? '日本語' : 'English'}</div>

          ${typeTags ? `<div class="sec"><div class="sec-body"><div class="tags">${typeTags}</div></div></div>` : ''}

          ${statsHTML.length ? `<div class="sec"><div class="sec-header">Stats</div><div class="sec-body"><div class="stats-grid">${statsGrid}</div></div></div>` : ''}

          ${attacksHTML}
          ${abilitiesHTML}
          ${weakHTML}
          ${descHTML}
          ${collHTML}
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><h3>Card not found</h3><p>${e.message}</p></div>`;
  }
}

/* ── COLLECTION ── */
async function renderCollection() {
  const content = $('collection-content');
  if (!S.user) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">🔐</div><h3>Sign in to view collection</h3><button class="btn primary" onclick="openAuth()">Sign In</button></div>`;
    return;
  }
  try {
    const items = await api('/api/collection');
    if (!items.length) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><h3>Your collection is empty</h3><p>Start adding cards from the browse page!</p></div>`;
      return;
    }
    content.innerHTML = `<div class="card-grid">${items.map((item, i) => {
      const types = item.types ? JSON.parse(item.types) : [];
      const typeBadges = types.map(t => `<span class="type-badge" style="color:${typeColor(t)}">${t[0]}</span>`).join('');
      return `
        <div class="card-cell" style="animation-delay:${i * 25}ms" onclick="navigate('card','${item.card_id}')">
          <div class="img-wrap">
            <img src="${item.image_url || ''}" alt="${item.name}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="card-placeholder" style="display:none">
              <div class="letter">${item.name[0] || '?'}</div>
              <div class="name">${item.name}</div>
            </div>
          </div>
          <div class="info">
            <div class="card-name">${item.name} <span style="color:var(--text3)">x${item.quantity}</span></div>
            <div class="card-sub">${item.set_id} · ${item.condition}</div>
            ${typeBadges ? `<div class="badges">${typeBadges}</div>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;
  } catch { content.innerHTML = '<div class="empty-state"><h3>Failed to load collection</h3></div>'; }
}

async function addToColl(cardId) {
  const qty = parseInt($('coll-qty')?.value || 1);
  const cond = $('coll-cond')?.value || 'Near Mint';
  try {
    await api(`/api/collection/${cardId}`, {
      method: 'POST',
      body: JSON.stringify({ quantity: qty, condition: cond, language: S.lang })
    });
    toast('Added to collection!', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* ── INIT ── */
(async function init() {
  // Set language from storage
  $('f-language').value = S.lang;

  // Load initial data
  await loadFilterOptions();
  await fetchCards(true);
  await checkAuth();

  // Hide loader
  setTimeout(() => $('loader').classList.add('hidden'), 400);

  // Infinite scroll
  window.addEventListener('scroll', () => {
    if (S.loading || S.loadedAll) return;
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 400) {
      fetchCards(false);
    }
  });
})();
