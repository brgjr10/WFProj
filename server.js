import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// WFCD item data sources (GitHub raw) — provides masteryReq, imageName, wikiaUrl
const WFCD_BASE = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json';
const WFCD_FILES = ['Warframes.json', 'Primary.json', 'Secondary.json', 'Melee.json', 'Pets.json', 'Archwing.json', 'Arch-Gun.json', 'Arch-Melee.json', 'Sentinels.json', 'SentinelWeapons.json', 'Gear.json', 'Railjack.json'];

// Cache for the item catalog (fetched once, reused for the session)
let catalogCache = null;
let catalogPromise = null;
let masteryCache = null;
let masteryPromise = null;

// Fetch mastery points from Warframe Wiki Mastery Rank Checklist
async function getMasteryPoints() {
  if (masteryCache) return masteryCache;
  if (masteryPromise) return masteryPromise;
  masteryPromise = (async () => {
    try {
      const res = await fetch('https://wiki.warframe.com/api.php?action=query&prop=revisions&titles=Mastery_Rank_Checklist&rvprop=content&format=json');
      if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
      const data = await res.json();
      const pages = data.query.pages;
      const byName = new Map();
      for (const pid in pages) {
        const p = pages[pid];
        const rev = p.revisions[0];
        const content = rev['*'];
        const pattern = /\|\s*\{\{(?:WF|Weapon|Companion|Item|Mod)\|([^}]+)\}\}.*?\|\|\s*\{\{StoreTableCell\|(\d+)\|Mastery Point\}\}/g;
        const matches = content.matchAll(pattern);
        for (const m of matches) {
          const rawName = m[1].trim();
          // Handle wiki format {{Weapon|DisplayName|LinkName}} - take first part
          const name = rawName.split('|')[0].trim();
          const points = parseInt(m[2], 10);
          if (!byName.has(name)) {
            byName.set(name, points);
          }
        }
      }
      masteryCache = byName;
      return masteryCache;
    } finally {
      masteryPromise = null;
    }
  })();
  return masteryPromise;
}

async function getCatalog() {
  if (catalogCache) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    try {
      const byName = new Map();
      for (const filename of WFCD_FILES) {
        const res = await fetch(`${WFCD_BASE}/${filename}`);
        if (!res.ok) throw new Error(`catalog HTTP ${res.status} for ${filename}`);
        const data = await res.json();
        for (const it of data) {
          if (it.uniqueName) byName.set(it.uniqueName, it);
        }
      }
      catalogCache = byName;
      return catalogCache;
    } finally {
      catalogPromise = null;
    }
  })();
  return catalogPromise;
}

// Proxy for the Warframe item catalog (avoids browser CORS and caches)
app.get('/api/catalog', async (req, res) => {
  try {
    const catalog = await getCatalog();
    const masteryPoints = await getMasteryPoints();
    // Return all items as an array with fields needed for mastery tracking
    const slim = [];
    const merged = new Map();
    for (const [uniqueName, v] of catalog) {
      const type = (v.type || '').toLowerCase();
      if (!type) continue;
      // Exclude Helminth
      if (v.name === 'Helminth') continue;
      // Include Warframes, weapons, and companion pets
      const relevantTypes = ['warframe', 'weapon', 'melee', 'pistol', 'rifle',
        'shotgun', 'bow', 'heavy', 'archwing', 'pet', 'sentinel', 'kavat', 'kubrow',
        'necramech', 'launcher', 'sniper', 'dual pistols', 'throwing', 'arch-gun',
        'arch-melee', 'companion weapon', 'archwing', 'gear'];
      if (!relevantTypes.includes(type)) continue;

      // Merge Sirius & Orion / Orion & Sirius into a single entry
      let key = uniqueName;
      let name = v.name || uniqueName;
      let imageUrl = v.wikiaThumbnail || `https://wiki.warframe.com/images/${(v.name || '').replace(/[\s-]/g, '')}.png`;
      if (uniqueName.includes('SiriusOrion')) {
        key = '/Lotus/Powersuits/SiriusOrion/Merged';
        name = 'Sirius & Orion';
        imageUrl = 'https://wiki.warframe.com/images/SiriusOrion.png';
      }

      if (merged.has(key)) {
        // Keep the first entry's data, but mark as owned if either is owned
        continue;
      }

      // Look up mastery points from wiki (by name)
      const mp = masteryPoints.get(name) || masteryPoints.get(v.name) || v.masteryReq || 0;

      merged.set(key, {
        uniqueName: key,
        name,
        type: v.type || 'Unknown',
        masteryLevel: mp,
        masteryReq: v.masteryReq || 0,
        isPrime: !!v.isPrime,
        vaulted: !!v.vaulted,
        imageName: v.imageName || null,
        wikiaUrl: v.wikiaUrl || null,
        imageUrl,
      });
    }
    for (const item of merged.values()) {
      slim.push(item);
    }
    res.json(slim);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch catalog', details: err.message });
  }
});

// Proxy for Warframe.Market orders (best-effort; may be blocked/require auth)
app.get('/api/market/orders/:slug', async (req, res) => {
  const { slug } = req.params;
  const platform = (req.query.platform || 'pc').toLowerCase();
  try {
    const res2 = await fetch(
      `https://api.warframe.market/v2/items/${slug}/orders`,
      { headers: { 'Platform': platform, 'Language': 'en' } }
    );
    if (!res2.ok) {
      return res.status(res2.status).json({ error: `market HTTP ${res2.status}` });
    }
    const data = await res2.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'market fetch failed', details: err.message });
  }
});

// Store uploaded profile for the session
let uploadedProfile = null;

// Extract XPInfo from Warframe profile format (handles both API response and profile.json)
function extractXPInfo(profileData) {
  if (!profileData) return { XPInfo: [] };
  
  // Extract display name
  let displayName = '';
  if (profileData.DisplayName) displayName = profileData.DisplayName;
  else if (profileData.Results && Array.isArray(profileData.Results) && profileData.Results[0]) {
    displayName = profileData.Results[0].DisplayName || '';
  }
  // Clean up non-printable characters
  displayName = displayName.replace(/<<ZIMA_USER>>/g, 'deadvision').replace(/[^\x20-\x7E]/g, '').trim();
  
  // If already has XPInfo at top level, use it
  if (profileData.XPInfo && Array.isArray(profileData.XPInfo)) {
    return { XPInfo: profileData.XPInfo, DisplayName: displayName };
  }
  
  // Warframe API format: { Results: [{ XPInfo: [...] }] }
  if (profileData.Results && Array.isArray(profileData.Results)) {
    let xpInfo = [];
    for (const result of profileData.Results) {
      if (result.XPInfo && Array.isArray(result.XPInfo)) {
        xpInfo = xpInfo.concat(result.XPInfo);
      }
    }
    if (xpInfo.length > 0) return { XPInfo: xpInfo, DisplayName: displayName };
  }
  
  // profile.json format: { Results: [{ LoadOutInventory: { XPInfo: [...] } }] }
  if (profileData.Results && Array.isArray(profileData.Results)) {
    let xpInfo = [];
    for (const result of profileData.Results) {
      if (result.LoadOutInventory && result.LoadOutInventory.XPInfo && Array.isArray(result.LoadOutInventory.XPInfo)) {
        xpInfo = xpInfo.concat(result.LoadOutInventory.XPInfo);
      }
    }
    if (xpInfo.length > 0) return { XPInfo: xpInfo, DisplayName: displayName };
  }
  
  return { XPInfo: [], DisplayName: displayName };
}

// Accept a profile.json upload as raw JSON
app.post('/api/upload/json', (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'No profile data received' });
  }
  uploadedProfile = req.body;
  // Return transformed data with XPInfo at top level for frontend
  res.json(extractXPInfo(uploadedProfile));
});

// Return the uploaded (or sample) profile with XPInfo at top level
app.get('/api/profile', async (req, res) => {
  let sourceProfile = uploadedProfile;
  if (!sourceProfile) {
    // Fall back to bundled sample
    try {
      const data = await import('./profile.json', { with: { type: 'json' } });
      sourceProfile = data.default;
    } catch (err) {
      return res.status(500).json({ error: 'No profile available', details: err.message });
    }
  }
  res.json(extractXPInfo(sourceProfile));
});

// Fetch profile from the real Warframe API
// Falls back to local profile when API is unavailable
app.get('/api/warframe/profile', async (req, res) => {
  const { playerId, platform } = req.query;
  if (!playerId) {
    return res.status(400).json({ error: 'playerId is required' });
  }
  try {
    const apiRes = await fetch(
      `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=${encodeURIComponent(playerId)}&platform=${platform || 'pc'}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WarframeMasteryTracker/1.0)' } }
    );
    if (!apiRes.ok) {
      // Try fallback to local profile for 403/409/429 errors (API blocked/rate limited)
      if ([403, 409, 429].includes(apiRes.status)) {
        const data = await import('./profile.json', { with: { type: 'json' } });
        return res.json({ 
          XPInfo: extractXPInfo(data.default).XPInfo,
          _fallback: true,
          _fallbackReason: `Warframe API returned ${apiRes.status} - using local profile data`
        });
      }
      return res.status(apiRes.status).json({ error: 'Warframe API fetch failed', details: apiRes.statusText });
    }
    const data = await apiRes.json();
    res.json(extractXPInfo(data));
  } catch (err) {
    // Fallback to local profile on network errors
    try {
      const data = await import('./profile.json', { with: { type: 'json' } });
      res.json({ 
        XPInfo: extractXPInfo(data.default).XPInfo,
        _fallback: true,
        _fallbackReason: 'Network error - using local profile data'
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Warframe API fetch error', details: err.message, fallbackError: fallbackErr.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Warframe Mastery Tracker running on http://localhost:${PORT}`);
});