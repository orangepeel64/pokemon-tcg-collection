// Pokémon TCG Collection - v2 with wtc-perspective-card 3D effects
const PerspectiveCard = window.WTCPerspectiveCard.default;

class PokemonApp {
  constructor() {
    this.apiBase = '/api';
    this.currentPage = 1;
    this.limit = 50;
    this.filters = {};
    this.collection = new Map();
    this.cardControllers = [];      // grid PerspectiveCard instances
    this.detailController = null;    // detail page ClickablePerspectiveCard
    this.init();
  }

  async init() {
    await this.loadFilters();
    await this.loadCards();
    await this.loadCollection();
    this.setupEventListeners();
    this.updateCollectionStats();
    this.initNav();
  }

  // ========= NAVIGATION =========
  initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.navigate(page);
      });
    });
    // Hash-based routing
    window.addEventListener('hashchange', () => this.handleHash());
    if (location.hash) this.handleHash();
  }

  handleHash() {
    const hash = location.hash.slice(1) || 'browse';
    if (hash === 'browse') this.showPage('browse');
    else if (hash === 'collection') this.showCollectionPage();
    else if (hash.startsWith('card-')) {
      const cardId = hash.slice(5);
      this.openCardPage(cardId);
    }
  }

  navigate(page, cardId) {
    if (page === 'browse') { location.hash = ''; this.showPage('browse'); }
    else if (page === 'collection') { location.hash = 'collection'; this.showCollectionPage(); }
    else if (page === 'card' && cardId) { location.hash = `card-${cardId}`; this.openCardPage(cardId); }
  }

  showPage(name) {
    // Clean up detail card 3D state when leaving card detail
    if (this.detailController) {
      this.detailController.playing = false;
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      const detailEl = document.getElementById('detail-card-3d');
      if (detailEl) {
        detailEl.style.position = '';
        detailEl.style.zIndex = '';
      }
      this.detailController = null;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(`page-${name}`);
    if (page) page.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.nav-btn[data-page="${name}"]`);
    if (btn) btn.classList.add('active');
  }

  showBrowsePage() {
    this.showPage('browse');
    if (this.cardControllers.length === 0) this.initGrid3DCards();
  }

  // ========= 3D GRID CARDS (tilt on hover, no click flip) =========
  initGrid3DCards() {
    // Clean up old controllers
    this.cardControllers.forEach(c => { c.playing = false; });
    this.cardControllers = [];

    document.querySelectorAll('.perspective-card').forEach(el => {
      try {
        const ctrl = new PerspectiveCard(el, { intensity: 8, zoomSize: 20 });
        ctrl.playing = true;
        this.cardControllers.push(ctrl);
      } catch (e) {
        // skip invalid elements
      }
    });
  }

  destroyGrid3DCards() {
    this.cardControllers.forEach(c => { c.playing = false; });
    this.cardControllers = [];
  }

  // ========= COLLECTION =========
  async loadCollection() {
    try {
      const res = await fetch(`${this.apiBase}/collection`);
      const cards = await res.json();
      this.collection.clear();
      cards.forEach(c => this.collection.set(c.id, c));
    } catch (e) { console.error('Error loading collection:', e); }
  }

  updateCollectionStats() {
    const count = this.collection.size;
    document.querySelectorAll('#collection-count').forEach(el => el.textContent = count);
    fetch(`${this.apiBase}/collection/value`)
      .then(r => r.json())
      .then(data => {
        document.getElementById('collection-value').innerHTML =
          `Value: <span class="value">$${data.totalValue}</span>`;
      })
      .catch(() => {});
  }

  async addToCollection(cardId, quantity = 1) {
    try {
      await fetch(`${this.apiBase}/collection/${cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: parseInt(quantity) })
      });
      this.collection.set(cardId, { id: cardId, quantity: parseInt(quantity) });
      this.updateCollectionStats();
    } catch (e) { console.error(e); }
  }

  async removeFromCollection(cardId) {
    try {
      await fetch(`${this.apiBase}/collection/${cardId}`, { method: 'DELETE' });
      this.collection.delete(cardId);
      this.updateCollectionStats();
    } catch (e) { console.error(e); }
  }

  async toggleCollection(cardId) {
    if (this.collection.has(cardId)) {
      await this.removeFromCollection(cardId);
    } else {
      await this.addToCollection(cardId, 1);
    }
    // Refresh the current view
    const hash = location.hash.slice(1);
    if (hash === 'collection') this.showCollectionPage();
    else if (hash.startsWith('card-')) this.openCardPage(hash.slice(5));
    else this.loadCards();
  }

  // ========= FILTERS =========
  async loadFilters() {
    try {
      const setsRes = await fetch(`${this.apiBase}/sets`);
      const sets = await setsRes.json();
      const setSelect = document.getElementById('set-filter');
      sets.forEach(set => {
        const opt = document.createElement('option');
        opt.value = set.id;
        opt.textContent = `${set.name}`;
        setSelect.appendChild(opt);
      });

      const filtersRes = await fetch(`${this.apiBase}/filters`);
      const filters = await filtersRes.json();

      const typeSelect = document.getElementById('type-filter');
      filters.types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        typeSelect.appendChild(opt);
      });

      const raritySelect = document.getElementById('rarity-filter');
      filters.rarities.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        raritySelect.appendChild(opt);
      });

      const pokeTypeSelect = document.getElementById('pokemon-type-filter');
      filters.pokemonTypes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        pokeTypeSelect.appendChild(opt);
      });
    } catch (e) { console.error('Error loading filters:', e); }
  }

  // ========= BROWSE PAGE =========
  async loadCards() {
    const container = document.getElementById('cards-container');
    container.innerHTML = '<div class="loading">Loading cards...</div>';

    try {
      const params = new URLSearchParams({
        limit: this.limit,
        offset: (this.currentPage - 1) * this.limit,
        ...this.filters
      });

      const res = await fetch(`${this.apiBase}/cards?${params}`);
      const cards = await res.json();

      container.innerHTML = cards.map(card => {
        const types = JSON.parse(card.types || '[]');
        const inCollection = this.collection.has(card.id);

        return `
          <div class="perspective-card" data-card-id="${card.id}">
            <div class="perspective-card__transformer">
              <div class="perspective-card__artwork perspective-card__artwork--front">
                <img src="${card.smallImageUrl}" alt="${card.name}" loading="lazy" />
              </div>
              <div class="perspective-card__artwork perspective-card__artwork--back">
                <img src="https://images.pokemontcg.io/sv/back.png" alt="Card Back"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 245 342%22><rect width=%22245%22 height=%22342%22 fill=%22%230071ba%22/><text x=%22122%22 y=%22171%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2220%22 font-weight=%22bold%22>Pokémon</text></svg>'">
              </div>
              <div class="perspective-card__shine"></div>
            </div>
            ${inCollection ? '<div class="collection-indicator"><i class="fas fa-heart"></i></div>' : ''}
            <div class="card-rarity-badge">${card.rarity || '—'}</div>
            <div class="card-grid-label">
              <h3>${card.name}</h3>
              <div class="info">
                <span>${(card.setId || '').toUpperCase()} #${card.number || '?'}</span>
                <span>${types.join('/') || '—'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('page-info').textContent = `Page ${this.currentPage}`;
      this.initGrid3DCards();

      // Delegate click on cards to open detail page
      container.querySelectorAll('.perspective-card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.button !== 0) return; // left click only
          const cardId = el.dataset.cardId;
          if (!cardId) return;
          this.destroyGrid3DCards();
          this.navigate('card', cardId);
        });
        // Middle click to toggle collection
        el.addEventListener('auxclick', async (e) => {
          if (e.button === 1) {
            e.preventDefault();
            const cardId = el.dataset.cardId;
            await this.toggleCollection(cardId);
            await this.loadCards();
          }
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="loading">Error loading cards</div>';
      console.error(e);
    }
  }

  // ========= CARD DETAIL PAGE =========
  async openCardPage(cardId) {
    this.showPage('card');

    const content = document.getElementById('card-page-content');
    content.innerHTML = '<div class="loading">Loading card...</div>';

    try {
      const [cardRes, priceRes] = await Promise.all([
        fetch(`${this.apiBase}/cards/${cardId}`),
        fetch(`${this.apiBase}/price/${cardId}`)
      ]);
      const card = await cardRes.json();
      const priceData = await priceRes.json();

      const types = JSON.parse(card.types || '[]');
      const attacks = card.attacks || [];
      const abilities = card.abilities || [];
      const pokedexNums = JSON.parse(card.nationalPokedexNumbers || '[]');
      const inCollection = this.collection.has(cardId);
      const collData = this.collection.get(cardId) || {};

      content.innerHTML = `
        <div class="card-3d-viewer" id="card-detail-viewer">
          <div class="perspective-card" id="detail-card-3d">
            <div class="perspective-card__transformer">
              <div class="perspective-card__artwork perspective-card__artwork--front">
                <img src="${card.largeImageUrl || card.smallImageUrl}" alt="${card.name}" />
              </div>
              <div class="perspective-card__artwork perspective-card__artwork--back">
                <img src="https://images.pokemontcg.io/sv/back.png" alt="Back"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 245 342%22><rect width=%22245%22 height=%22342%22 fill=%22%230071ba%22/><text x=%22122%22 y=%22171%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2220%22 font-weight=%22bold%22>Pokémon</text></svg>'">
              </div>
              <div class="perspective-card__shine"></div>
            </div>
          </div>
        </div>

        <div class="card-details">
          <h1>${card.name}</h1>
          <div class="card-set-badge">${(card.setId || '').toUpperCase()} #${card.number || '?'}</div>

          ${pokedexNums.length > 0 ? `
            <div class="stat-card" style="margin-bottom: 15px;">
              <span>Pokédex: #${pokedexNums[0]}</span>
            </div>
          ` : ''}

          <div class="price-display">
            <div class="label">Market Price</div>
            <div class="amount">$${priceData.marketPrice || '0.00'}</div>
            <div style="font-size: 0.8rem; margin-top: 5px;">
              ${inCollection ? `In Collection: ${collData.quantity || 1} copy/copies` : 'Not in collection'}
            </div>
          </div>

          <div class="collection-options">
            <div class="option-row">
              <label>Quantity</label>
              <input type="number" id="detail-qty-input" value="1" min="1" max="10">
            </div>
            <div class="option-row">
              <label>Condition</label>
              <select id="detail-condition-select">
                <option value="Near Mint">Near Mint</option>
                <option value="Lightly Played">Lightly Played</option>
                <option value="Moderately Played">Moderately Played</option>
                <option value="Heavily Played">Heavily Played</option>
              </select>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn-primary add-collection-btn" id="detail-add-btn">
                <i class="fas fa-heart"></i> ${inCollection ? 'Update Collection' : 'Add to Collection'}
              </button>
              ${inCollection ? `
                <button class="btn-secondary add-collection-btn" id="detail-remove-btn" style="flex:0.3;">
                  <i class="fas fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <div class="card-stats-grid">
            <div class="stat-card"><div class="value">${card.hp || '-'}</div><div class="label">HP</div></div>
            <div class="stat-card"><div class="value">${card.rarity || '-'}</div><div class="label">Rarity</div></div>
            <div class="stat-card"><div class="value">${types.join('/') || '—'}</div><div class="label">Types</div></div>
            <div class="stat-card"><div class="value">${card.supertype || '—'}</div><div class="label">Category</div></div>
          </div>

          ${attacks.length > 0 ? `
            <div class="card-section">
              <h3><i class="fas fa-bolt"></i> Attacks</h3>
              ${attacks.map(a => `
                <div class="attack-card">
                  <div class="name">${a.name} ${a.damage ? `<span class="damage">${a.damage}</span>` : ''}</div>
                  <div class="text">${a.text || ''}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${abilities.length > 0 ? `
            <div class="card-section">
              <h3><i class="fas fa-magic"></i> Abilities</h3>
              ${abilities.map(a => `
                <div class="ability-card">
                  <div class="name">${a.name} <span style="color: var(--gray); font-weight: normal;">(${a.type})</span></div>
                  <div class="text">${a.text}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${card.flavorText ? `
            <div class="flavor-text">"${card.flavorText}"</div>
          ` : ''}

          ${card.artist ? `
            <div class="card-section">
              <h3><i class="fas fa-palette"></i> Artist</h3>
              <div style="color: var(--gray);">${card.artist}</div>
            </div>
          ` : ''}
        </div>
      `;

// Custom 3D flip + enlarge for detail card
      const detailEl = document.getElementById('detail-card-3d');
      if (detailEl) {
        if (this.detailController) {
          this.detailController.playing = false;
        }
        // Basic PerspectiveCard for tilt only — no spin, no enlarge
        this.detailController = new PerspectiveCard(detailEl, {
          intensity: 12,
          zoomSize: 25
        });
        this.detailController.pointerControlled = true;
        this.detailController.playing = true;
      }

      // Detail page action buttons
      document.getElementById('detail-add-btn').addEventListener('click', async () => {
        const qty = parseInt(document.getElementById('detail-qty-input').value) || 1;
        await this.addToCollection(cardId, qty);
        this.openCardPage(cardId); // refresh
      });

      const removeBtn = document.getElementById('detail-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
          await this.removeFromCollection(cardId);
          this.openCardPage(cardId);
        });
      }

    } catch (e) {
      content.innerHTML = '<div class="loading">Error loading card</div>';
      console.error(e);
    }
  }

  // ========= COLLECTION PAGE =========
  async showCollectionPage() {
    this.showPage('collection');
    const container = document.getElementById('collection-content');
    container.innerHTML = '<div class="loading">Loading collection...</div>';

    try {
      const [cardsRes, valueRes] = await Promise.all([
        fetch(`${this.apiBase}/collection`),
        fetch(`${this.apiBase}/collection/value`)
      ]);
      const cards = await cardsRes.json();
      const valueData = await valueRes.json();

      if (cards.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-heart-broken"></i>
            <h3>Your collection is empty</h3>
            <p>Middle-click any card to add it, or click the heart icon on the detail page.</p>
            <button class="btn-primary" onclick="app.navigate('browse')" style="margin-top:20px;">
              <i class="fas fa-th"></i> Browse Cards
            </button>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="collection-header">
          <h2><i class="fas fa-heart"></i> My Collection</h2>
          <div class="collection-stats">
            <div class="collection-stat">
              <div class="num">${valueData.uniqueCards || cards.length}</div>
              <div class="lbl">Unique Cards</div>
            </div>
            <div class="collection-stat">
              <div class="num">${cards.reduce((s, c) => s + (c.quantity || 1), 0)}</div>
              <div class="lbl">Total Copies</div>
            </div>
            <div class="collection-stat">
              <div class="num">$${valueData.totalValue || '0.00'}</div>
              <div class="lbl">Estimated Value</div>
            </div>
          </div>
        </div>
        <div class="collection-grid">
          ${cards.map(card => `
            <div class="collection-card" data-card-id="${card.id}">
              <img src="${card.smallImageUrl}" alt="${card.name}" loading="lazy">
              <div class="card-footer">
                ${card.name} <span class="qty">${card.quantity || 1}×</span>
              </div>
              <button class="remove-btn" title="Remove from collection">&times;</button>
            </div>
          `).join('')}
        </div>
      `;

      // Card click -> detail page
      container.querySelectorAll('.collection-card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn')) return;
          const cardId = el.dataset.cardId;
          if (cardId) this.navigate('card', cardId);
        });
        el.querySelector('.remove-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const cardId = el.dataset.cardId;
          await this.removeFromCollection(cardId);
          this.showCollectionPage();
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="loading">Error loading collection</div>';
      console.error(e);
    }
  }

  // ========= EVENT LISTENERS =========
  setupEventListeners() {
    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.filters.search = e.target.value;
        this.currentPage = 1;
        this.loadCards();
      }, 300);
    });

    // Filter changes
    ['set-filter', 'type-filter', 'rarity-filter', 'pokemon-type-filter'].forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        const key = id === 'set-filter' ? 'setName'
                  : id === 'type-filter' ? 'type'
                  : id === 'rarity-filter' ? 'rarity'
                  : 'pokemonType';
        this.filters[key] = e.target.value;
        this.currentPage = 1;
        this.loadCards();
      });
    });

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filters.sortBy = btn.dataset.sort;
        this.loadCards();
      });
    });

    // Pagination
    document.getElementById('prev-page').addEventListener('click', () => {
      if (this.currentPage > 1) { this.currentPage--; this.loadCards(); }
    });
    document.getElementById('next-page').addEventListener('click', () => {
      this.currentPage++; this.loadCards();
    });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PokemonApp();
});