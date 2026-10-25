import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { load } from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Restrict CORS for local use
app.use(cors({ origin: ['http://localhost:3001', 'http://127.0.0.1:3001'] }));
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
let checklistCache = null;
let checklistPromise = null;

// Load mastery points from wiki page
async function loadChecklistMastery() {
  if (checklistCache) return checklistCache;
  if (checklistPromise) return checklistPromise;
  checklistPromise = (async () => {
    try {
      const byName = new Map();
      // Try fetching from wiki directly
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch('https://wiki.warframe.com/wiki/Mastery_Rank_Checklist?action=raw', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const text = await res.text();
          // Parse wikitext patterns
          const patterns = [
            /\|\s*\[\[([^\]]+)\]\].*?\|\|\s*\{\{StoreTableCell\|(\d+)\|Mastery Point\}\}/g,
            /\|\s*\{\{[^\|]+\|([^\}|]+)[^\}]*\}\}.*?\|\|\s*\{\{StoreTableCell\|(\d+)\|Mastery Point\}\}/g,
          ];
          for (const pattern of patterns) {
            const matches = text.matchAll(pattern);
            for (const m of matches) {
              const rawName = (m[1] || '').trim();
              const name = rawName.split('|')[0].trim().replace(/\[\[|\]\]/g, '');
              const points = parseInt(m[2], 10);
              if (name && !isNaN(points) && points > 0 && !byName.has(name)) {
                byName.set(name, points);
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch wiki raw:', e.message);
      }
      // Also try to fetch the page and parse
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch('https://wiki.warframe.com/wiki/Mastery_Rank_Checklist', { signal: controller.signal, headers: { 'User-Agent': 'WarframeMasteryTracker/1.0' } });
        clearTimeout(timeoutId);
        if (res.ok) {
          const html = await res.text();
          const $ = load(html);
          $('tr[data-rowid]').each((_, tr) => {
            const rowid = $(tr).attr('data-rowid');
            if (!rowid || rowid.startsWith('SolNode')) return;
            if (['Planet', 'Unlock', 'Deploy', 'Tactical', 'Strike', 'Abilities', 'Pulse', 'Weaponmaster', 'Synergy', 'Mass', 'Decrees', 'Crews', 'Blink', 'Neural', 'Adrenaline', 'On Call', 'Elite Crewmates', 'Deadly Decrees', 'Transference Sync', 'Swifter Strike', 'Swifter Abilities', 'Muscle Mass'].includes(rowid)) return;
            const mpCell = $(tr).find('td[data-store-currency="Mastery Point"]').first();
            if (!mpCell.length) return;
            const mpText = mpCell.text().replace(/,/g, '');
            const mpMatch = mpText.match(/([0-9]+)/);
            if (!mpMatch) return;
            const mp = parseInt(mpMatch[1], 10);
            if (mp <= 0) return;
            const nameCell = $(tr).find('td').first();
            const link = nameCell.find('a').first();
            let name = link.text().trim() || nameCell.text().trim();
            if (typeof name !== 'string') name = String(name);
            name = name.replace(/\[.*\]/, '').replace(/\s+/g, ' ').trim();
            if (name && name.length > 0 && !name.startsWith('Rank') && !name.startsWith('Deploy') && !byName.has(name)) {
              byName.set(name, mp);
            }
            if (rowid && !byName.has(rowid)) {
              byName.set(rowid, mp);
            }
          });
        }
      } catch (e) {
        console.error('Failed to fetch wiki page:', e.message);
      }
      checklistCache = byName;
      return checklistCache;
    } catch (err) {
      console.error('loadChecklistMastery failed:', err.message);
      checklistCache = new Map();
      return checklistCache;
    } finally {
      checklistPromise = null;
    }
  })();
  return checklistPromise;
}

// Fetch mastery points from Warframe Wiki Mastery Rank Checklist
async function getMasteryPoints() {
  if (masteryCache) return masteryCache;
  if (masteryPromise) return masteryPromise;
  masteryPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res;
      try {
        res = await fetch('https://wiki.warframe.com/api.php?action=query&prop=revisions&titles=Mastery_Rank_Checklist&rvprop=content&format=json', { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
      const data = await res.json();
      const pages = data.query.pages;
      const byName = new Map();
      for (const pid in pages) {
        const p = pages[pid];
        const rev = p.revisions?.[0];
        if (!rev) continue;
        const content = rev['*'] || '';
        // Try multiple patterns to be more flexible (includes Necramechs etc.)
        const patterns = [
          /\|\s*\{\{(?:WF|Weapon|Companion|Item|Mod|Warframe)\|([^}|]+)(?:\|[^}]+)*\}\}.*?\|\|\s*\{\{StoreTableCell\|(\d+)\|Mastery Point\}\}/g,
          /\|\s*\[\[([^\]]+)\]\].*?\|\|\s*\{\{StoreTableCell\|(\d+)\|Mastery Point\}\}/g,
          /\|\s*([A-Za-z0-9][A-Za-z0-9\s\-'()&]+)\b.*?data-store-value="(\d+)".*?Mastery Point/g
        ];
        for (const pattern of patterns) {
          const matches = content.matchAll(pattern);
          for (const m of matches) {
            const rawName = (m[1] || '').trim();
            const name = rawName.split('|')[0].trim().replace(/\[\[|\]\]/g, '');
            const points = parseInt(m[2], 10);
            if (name && !isNaN(points) && !byName.has(name)) {
              byName.set(name, points);
            }
          }
        }
      }
      masteryCache = byName;
      return masteryCache;
    } catch (err) {
      console.error('getMasteryPoints failed:', err.message);
      // Return empty map on failure; caller will fall back to WFCD/masteryReq
      masteryCache = new Map();
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let res;
        try {
          res = await fetch(`${WFCD_BASE}/${filename}`, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) throw new Error(`catalog HTTP ${res.status} for ${filename}`);
        const data = await res.json();
        for (const it of data) {
          if (it.uniqueName) byName.set(it.uniqueName, it);
        }
      }
      catalogCache = byName;
      return catalogCache;
    } catch (err) {
      console.error('getCatalog failed:', err.message);
      catalogCache = new Map();
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
      const checklistPoints = await loadChecklistMastery();
      // Merge checklist points (local truth files take precedence)
      const mergedMastery = new Map(masteryPoints);
      for (const [k, v] of checklistPoints) {
        if (!mergedMastery.has(k) || v > mergedMastery.get(k)) {
          mergedMastery.set(k, v);
        }
      }
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
        'arch-melee', 'companion weapon', 'gear'];
      if (!relevantTypes.includes(type)) {
        // Include if it has mastery points (zaws, kitguns, amps, moas, hounds, k-drives, etc.)
        if ((v.masteryReq || 0) <= 0) continue;
      }

      // Merge Sirius & Orion / Orion & Sirius into a single entry
      let key = uniqueName;
      let name = v.name || uniqueName;
      const nameBasedUrl = `https://wiki.warframe.com/images/${(v.name || '').replace(/[\s-]/g, '')}.png`;
      const imageNameBasedUrl = v.imageName ? `https://wiki.warframe.com/images/${v.imageName}${v.imageName.includes('.') ? '' : '.png'}` : null;
      let imageUrl = v.wikiaThumbnail || nameBasedUrl;
      let imageFallbackUrl = (imageNameBasedUrl && imageNameBasedUrl !== nameBasedUrl) ? imageNameBasedUrl : null;
      // Dark Split-Sword wiki image differs from WFCD imageName
      if (name === 'Dark Split-Sword') {
        imageUrl = 'https://wiki.warframe.com/images/DarkSplitSwordDualSwords.png';
        imageFallbackUrl = 'https://wiki.warframe.com/images/DarkSplitSwordHeavyBlade.png';
      }
      if (uniqueName.includes('SiriusOrion')) {
        key = '/Lotus/Powersuits/SiriusOrion/Merged';
        name = 'Sirius & Orion';
        imageUrl = 'https://wiki.warframe.com/images/SiriusOrion.png';
        imageFallbackUrl = null;
      }

      if (merged.has(key)) {
        // Keep the first entry's data, but mark as owned if either is owned
        continue;
      }

      // Look up mastery points from wiki (by name)
      const mp = mergedMastery.get(name) || mergedMastery.get(v.name) || mergedMastery.get(uniqueName) || v.masteryReq || 0;

      merged.set(key, {
        uniqueName: key,
        name,
        type: v.type || 'Unknown',
        masteryLevel: mp || v.masteryReq || 0,
        masteryReq: v.masteryReq || mp || 0,
        isPrime: !!v.isPrime,
        vaulted: !!v.vaulted,
        imageName: v.imageName || null,
        wikiaUrl: v.wikiaUrl || null,
        imageUrl,
        imageFallbackUrl,
      });
    }
    // Add missing items from checklist (zaws, kitguns, amps, moas, hounds, k-drives, etc.)
    try {
      const checklistPoints = await loadChecklistMastery();
      for (const [key, mp] of checklistPoints) {
        if (merged.has(key)) continue;
        // Skip if it's a node or unlock
        if (key.startsWith('SolNode') || key.includes('Unlock') || key.includes('Deploy') || key.includes('Tactical')) continue;
        // Check if we already have by name
        let exists = false;
        for (const item of merged.values()) {
          if (item.name === key || item.uniqueName === key) { exists = true; break; }
        }
        if (exists) continue;
        // Add as new item
        merged.set(key, {
          uniqueName: key,
          name: key,
          type: key.includes('Strike') || key.toLowerCase().includes('zaw') ? 'Melee' : 
                (key.toLowerCase().includes('kitgun') || key.toLowerCase().includes('catchmoon') || key.toLowerCase().includes('gaze') || key.toLowerCase().includes('rattleguts') || key.toLowerCase().includes('sporelacer') || key.toLowerCase().includes('tombfinger') || key.toLowerCase().includes('vermisplicer')) ? 'Rifle' :
                (key.toLowerCase().includes('amp') || key.toLowerCase().includes('prism')) ? 'Pistol' :
                (key.toLowerCase().includes('moa')) ? 'Pet' :
                (key.toLowerCase().includes('hound')) ? 'Pet' :
                (key.toLowerCase().includes('k-drive') || key.toLowerCase().includes('bad baby') || key.toLowerCase().includes('feverspine') || key.toLowerCase().includes('flatbelly') || key.toLowerCase().includes('needlenose') || key.toLowerCase().includes('runway')) ? 'Archwing' :
                'Weapon',
          masteryLevel: mp,
          masteryReq: mp,
          isPrime: key.includes('Prime'),
          vaulted: false,
          imageName: null,
          wikiaUrl: `https://wiki.warframe.com/w/${key.replace(/\s+/g, '_')}`,
          imageUrl: null,
          imageFallbackUrl: null,
        });
      }
    } catch (e) {
      console.error('Failed to merge checklist items:', e.message);
    }
    for (const item of merged.values()) {
      slim.push(item);
    }
    res.json(slim);
  } catch (err) {
    console.error('GET /api/catalog error:', err);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// Proxy for Warframe.Market orders (best-effort; may be blocked/require auth)
app.get('/api/market/orders/:slug', async (req, res) => {
  const { slug } = req.params;
  const platform = (req.query.platform || 'pc').toLowerCase();
  const allowedPlatforms = ['pc', 'ps4', 'xb1', 'switch'];
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let res2;
    try {
      res2 = await fetch(
        `https://api.warframe.market/v2/items/${encodeURIComponent(slug)}/orders`,
        { headers: { 'Platform': platform, 'Language': 'en' }, signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res2.ok) {
      return res.status(res2.status).json({ error: `market request failed` });
    }
    const data = await res2.json();
    res.json(data);
  } catch (err) {
    console.error('market fetch failed:', err.message);
    res.status(500).json({ error: 'market fetch failed' });
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
  if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
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
  if (!playerId || typeof playerId !== 'string') {
    return res.status(400).json({ error: 'playerId is required' });
  }
  // Basic validation
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(playerId)) {
    return res.status(400).json({ error: 'Invalid playerId' });
  }
  const plat = (platform || 'pc').toLowerCase();
  const allowedPlatforms = ['pc', 'ps4', 'xb1', 'switch'];
  if (!allowedPlatforms.includes(plat)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let apiRes;
    try {
      apiRes = await fetch(
        `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=${encodeURIComponent(playerId)}&platform=${plat}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WarframeMasteryTracker/1.0)' }, signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!apiRes.ok) {
      // Try fallback to local profile for 403/409/429 errors (API blocked/rate limited)
      if ([403, 409, 429].includes(apiRes.status)) {
        try {
          const data = await import('./profile.json', { with: { type: 'json' } });
          const extracted = extractXPInfo(data.default);
          return res.json({ 
            XPInfo: extracted.XPInfo,
            DisplayName: extracted.DisplayName,
            _fallback: true,
            _fallbackReason: `Warframe API returned ${apiRes.status}`
          });
        } catch (e) {
          return res.status(502).json({ error: 'Upstream API error' });
        }
      }
      return res.status(apiRes.status).json({ error: 'Warframe API fetch failed' });
    }
    const data = await apiRes.json();
    res.json(extractXPInfo(data));
  } catch (err) {
    console.error('warframe/profile error:', err.message);
    // Fallback to local profile on network errors
    try {
      const data = await import('./profile.json', { with: { type: 'json' } });
      const extracted = extractXPInfo(data.default);
      res.json({ 
        XPInfo: extracted.XPInfo,
        DisplayName: extracted.DisplayName,
        _fallback: true,
        _fallbackReason: 'Network error'
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Warframe API fetch error' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Warframe Mastery Tracker running on http://localhost:${PORT}`);
});