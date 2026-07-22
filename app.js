const WARFRAME_MARKET_API = 'https://api.warframe.market/v2';
const WARFRAME_STAT_API = 'https://api.warframestat.us';
const TOTAL_BASE_FRAMES = 65;
const TOTAL_PRIME_FRAMES = 49;

const ALL_WARFRAMES = [
  'Ash', 'Atlas', 'Banshee', 'Baruuk', 'Chroma', 'Ember', 'Equinox', 'Excalibur', 'Frost',
  'Gara', 'Gauss', 'Harrow', 'Hildryn', 'Inaros', 'Ivara', 'Khora', 'Kullervo', 'Lavos',
  'Limbo', 'Loki', 'Mag', 'Mesa', 'Mirage', 'Nekros', 'Nidus', 'Nova', 'Nyx', 'Oberon',
  'Octavia', 'Revenant', 'Rhino', 'Saryn', 'Titania', 'Trinity', 'Valkyr', 'Vauban', 'Volt', 'Wisp',
  'Zephyr', 'Dagath', 'Dante', 'Grendel', 'Gyre', 'Koumei', 'Protea', 'Qorvex', 'Sevagoth', 'Styanax',
  'Voruna', 'Xaku', 'Yareli', 'Caliban', 'Narmer', 'Orax', 'Uriel', 'Sirius', 'Orion', 'Cyte-09'
];

const PRIME_WARFRAMES = ALL_WARFRAMES.filter(w => w !== 'Dagath' && w !== 'Dante' && w !== 'Grendel' && 
  w !== 'Gyre' && w !== 'Koumei' && w !== 'Protea' && w !== 'Qorvex' && 
  w !== 'Sevagoth' && w !== 'Styanax' && w !== 'Voruna' && w !== 'Xaku' && 
  w !== 'Yareli' && w !== 'Caliban' && w !== 'Narmer' && w !== 'Orax' && 
  w !== 'Uriel' && w !== 'Sirius' && w !== 'Orion' && w !== 'Cyte-09');

const WarframeRegistry = {
  warframes: {},
  companions: {},
  getWarframe(name) {
    if (!this.warframes[name]) {
      this.warframes[name] = {
        name, baseMastered: false, primeMastered: false, crafted: false,
        subsumed: false, owned: 'X', ownedCount: 0,
        prime: null
      };
    }
    return this.warframes[name];
  },
  getCompanion(name) {
    if (!this.companions[name]) {
      this.companions[name] = {
        name, mastered: false, completion: 0
      };
    }
    return this.companions[name];
  }
};

document.addEventListener('alpine:init', () => {
  Alpine.data('tracker', () => ({
    warframes: [], loading: true, pricesLoading: false, error: '', lastUpdated: '',

    get baseMastered() {
      return this.warframes.filter(w => w.baseMastered).length;
    },

    get primeMastered() {
      return this.warframes.filter(w => w.primeMastered).length;
    },

    get baseCompletion() {
      return ((this.baseMastered / TOTAL_BASE_FRAMES) * 100).toFixed(2);
    },

    get primeCompletion() {
      return ((this.primeMastered / TOTAL_PRIME_FRAMES) * 100).toFixed(2);
    },

    get uniqueOwned() {
      return this.warframes.filter(w => w.baseMastered || w.primeMastered).length;
    },

    get uniqueCompletion() {
      return ((this.uniqueOwned / TOTAL_BASE_FRAMES) * 100).toFixed(2);
    },

    get subsumed() {
      return this.warframes.filter(w => w.subsumed).length;
    },

    get subsumedCompletion() {
      return ((this.subsumed / TOTAL_BASE_FRAMES) * 100).toFixed(2);
    },

    get companions() {
      return {
        nautilus: this.companionData.nautilus || 0,
        carrier: this.companionData.carrier || 0,
        dethcube: this.companionData.dethcube || 0,
        helios: this.companionData.helios || 0,
        shade: this.companionData.shade || 0
      };
    },

    get companionData() {
      const data = { nautilus: 0, carrier: 0, dethcube: 0, helios: 0, shade: 0 };
      this.warframes.forEach(wf => {
        if (wf.companions) {
          Object.entries(wf.companions).forEach(([key, val]) => {
            if (val && data[key] !== undefined) data[key]++;
          });
        }
      });
      return data;
    },

    get totalPrice() {
      return this.warframes.reduce((sum, wf) => {
        if (!wf.prime) return sum;
        const needed = Object.values(wf.prime.parts || {})
          .filter((v, i) => !v)
          .reduce((p, _, i) => {
            const keys = ['neuroptics', 'systems', 'chassis', 'main'];
            return p + (wf.prime.prices[keys[i]] || 0);
          }, 0);
        return sum + needed;
      }, 0);
    },

    async init() {
      await this.refresh();
    },

    async refresh() {
      this.loading = true;
      this.pricesLoading = false;
      this.error = '';
      this.lastUpdated = new Date().toLocaleString();

      try {
        const [wfmItems, warframesData] = await Promise.all([
          fetchWarframeMarketItems(),
          fetch(`${WARFRAME_STAT_API}/items?language=en`).then(r => r.json())
        ]);

this.warframes = ALL_WARFRAMES.map(name => {
          const wf = WarframeRegistry.getWarframe(name);
          wf.primeMastered = false;

          const hasPrime = PRIME_WARFRAMES.includes(name);
          if (hasPrime) {
            const primeName = name + ' Prime';
            const primeInfo = warframesData.find(w => w.item_name?.toLowerCase().includes(primeName.toLowerCase()));

            wf.prime = {
              acquisition: (primeInfo?.info || primeInfo?.acquisition_drops || 'Vaulted'),
              vaulted: primeInfo?.vault_status || 'Available',
              parts: { neuroptics: false, systems: false, chassis: false, main: false },
              prices: {},
              partsOwned: 0,
              completion: 0,
              partsNeeded: 4,
              mastered: false
            };
            wf.companions = {
              nautilus: false, carrier: false, dethcube: false, helios: false,
              wyrm: false, shade: false, taxon: false, diriga: false,
              djinn: false, oxylus: false, vulklok: false, stinger: false,
              multron: false
            };
          } else {
            wf.prime = null;
          }

          return wf;
        });

        this.loading = false;
        this.pricesLoading = true;
        this.lastUpdated = new Date().toLocaleString();

        const pricePromises = [];
        const self = this;

        this.warframes.forEach(wf => {
          if (!wf.prime) return;

          const parts = getWarframePartUrlNames(wf.name + ' Prime');
          Object.entries(parts).forEach(([partKey, urlName]) => {
            const cached = PriceCache.get(urlName);
            if (cached !== null) {
              wf.prime.prices[partKey] = cached;
            } else {
              const item = wfmItems.find(i => i.url_name === urlName);
              if (item) {
                pricePromises.push(RateLimiter.schedule(() => fetchOrdersForItem(urlName)).then(orders => {
                  wf.prime.prices[partKey] = getAverageSellPrice(orders.sell_orders);
                  PriceCache.set(urlName, wf.prime.prices[partKey]);
                }).catch(() => { wf.prime.prices[partKey] = null; }));
              }
            }
          });
        });

        await Promise.all(pricePromises);
        this.pricesLoading = false;
      } catch (err) {
        this.error = 'Failed: ' + err.message;
        this.loading = false;
        this.pricesLoading = false;
      }
    },

    togglePrimePart(wf, partKey) {
      if (wf.prime && wf.prime.parts) {
        wf.prime.parts[partKey] = !wf.prime.parts[partKey];
        const partsOwned = Object.values(wf.prime.parts).filter(v => v).length;
        wf.prime.partsOwned = partsOwned;
        wf.prime.partsNeeded = 4 - partsOwned;
        wf.prime.completion = Math.round((partsOwned / 4) * 100);
        wf.primeMastered = partsOwned === 4;
      }
    },

    togglePrimeMastered(wf) {
      if (wf.prime) {
        wf.primeMastered = !wf.primeMastered;
      }
    },

    toggleCompanion(wf, companion) {
      if (wf.companions && wf.companions[companion] !== undefined) {
        wf.companions[companion] = !wf.companions[companion];
      }
    }
  }))
});

async function fetchWarframeMarketItems() {
  try {
    const response = await fetch(`${WARFRAME_MARKET_API}/items`);
    const data = await response.json();
    return data.payload.items;
  } catch (error) {
    console.error('Failed to fetch WFM items:', error);
    return [];
  }
}

async function fetchOrdersForItem(urlName) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await RateLimiter.schedule(() => fetch(`${WARFRAME_MARKET_API}/items/${urlName}/orders`, {
      signal: controller.signal,
      headers: { 'Platform': 'pc', 'Language': 'en' }
    }));
    clearTimeout(timeoutId);
    const data = await response.json();
    return data.payload;
  } catch (error) {
    return { sell_orders: [], buy_orders: [] };
  }
}

function getAverageSellPrice(sellOrders) {
  if (!sellOrders || sellOrders.length === 0) return null;
  const validOrders = sellOrders.filter(o => o.visible && o.platform === 'pc');
  if (validOrders.length === 0) return null;
  const sum = validOrders.reduce((acc, o) => acc + o.platinum, 0);
  return Math.round(sum / validOrders.length);
}

function getWarframePartUrlNames(warframeName) {
  const baseName = warframeName.replace(' Prime', '').toLowerCase().replace(/\s+/g, '_');
  return {
    neuroptics: `${baseName}_prime_neuroptics`,
    systems: `${baseName}_prime_systems`,
    chassis: `${baseName}_prime_chassis`,
    main: `${baseName}_prime_blueprint`
  };
}

const PriceCache = {
  prefix: 'wfm_price_',
  ttl: 5 * 60 * 1000,
  
  get(key) {
    const cached = localStorage.getItem(this.prefix + key);
    if (!cached) return null;
    const { price, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > this.ttl) {
      localStorage.removeItem(this.prefix + key);
      return null;
    }
    return price;
  },
  
  set(key, price) {
    localStorage.setItem(this.prefix + key, JSON.stringify({ price, timestamp: Date.now() }));
  }
};

const RateLimiter = {
  queue: [],
  lastCall: 0,
  minInterval: 350,
  
  async schedule(fn) {
    const now = Date.now();
    const waitTime = Math.max(0, this.minInterval - (now - this.lastCall));
    if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
    this.lastCall = Date.now();
    return fn();
  }
};