// Warframe Mastery Tracker — Frontend Application Logic
// Handles profile parsing, catalog fetching, ownership/mastery computation, and rendering.

(function () {
  "use strict";

  const API_BASE = "/api";
  let state = {
    profile: null,
    catalog: null,
    items: [],
    filter: "all",
    search: "",
    typeFilter: "all",
    primeFilter: "all",
    sort: "name-asc",
    view: "table",
    refreshTimer: null,
  };

  // --- DOM ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // --- Init ---
  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadCatalog();
    // Auto-fetch if player ID is already in the box
    const playerId = $("#player-id").value.trim();
    if (playerId) {
      fetchProfile();
    }
  });

  function bindEvents() {
    $("#upload-btn").addEventListener("click", uploadProfile);
    $("#profile-file").addEventListener("change", handleFileSelect);
    $("#fetch-btn").addEventListener("click", fetchProfile);
    $("#player-id").addEventListener("keydown", (e) => {
      if (e.key === "Enter") fetchProfile();
    });
    $("#search-input").addEventListener("input", (e) => {
      state.search = e.target.value.toLowerCase();
      renderTable();
    });
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.filter = tab.dataset.filter;
        renderTable();
      });
    });
    $("#type-filter").addEventListener("change", (e) => {
      state.typeFilter = e.target.value;
      renderTable();
    });
    $("#prime-filter").addEventListener("change", (e) => {
      state.primeFilter = e.target.value;
      renderTable();
    });
    $("#view-table-btn").addEventListener("click", () => {
      state.view = "table";
      renderTable();
    });
    $("#view-cards-btn").addEventListener("click", () => {
      state.view = "cards";
      renderTable();
    });
    $("#clear-manual-btn").addEventListener("click", () => {
      if (confirm("Reset all Kuva/Tenet/Coda weapons to MR 40?")) {
        clearMrLevels();
        if (state.profile) {
          const ownedMap = new Map();
          (state.profile.XPInfo || []).forEach((x) => {
            let it = x.ItemType;
            if (it.includes("SiriusOrion")) it = "/Lotus/Powersuits/SiriusOrion/Merged";
            ownedMap.set(it, x.XP || 0);
          });
          computeItems(ownedMap);
        } else {
          computeItems(new Map());
        }
        renderSummary();
        renderTable();
      }
    });
  }

  // --- File upload ---
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        processProfile(data);
      } catch (err) {
        showError("Failed to parse file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function uploadProfile() {
    const file = $("#profile-file").files[0];
    if (!file) {
      showError("Please select a profile.json file first.");
      return;
    }
    showLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const res = await fetch(API_BASE + "/upload/json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Upload failed: " + res.status);
        const result = await res.json();
        processProfile(result);
      } catch (err) {
        showError("Upload error: " + err.message);
      } finally {
        showLoading(false);
      }
    };
    reader.onerror = () => {
      showError("Failed to read file.");
      showLoading(false);
    };
    reader.readAsText(file);
  }

  async function fetchProfile() {
    const playerId = $("#player-id").value.trim();
    if (!playerId) {
      showError("Please enter a player ID.");
      return;
    }
    showLoading(true);
    try {
      const res = await fetch(API_BASE + "/warframe/profile?playerId=" + encodeURIComponent(playerId) + "&platform=pc");
      if (!res.ok) {
        let detail = "";
        try { detail = await res.text(); } catch(e) {}
        throw new Error("Fetch failed: " + res.status + (detail ? " " + detail : ""));
      }
      const data = await res.json();
      let xpInfo = [];
      let displayName = (data.DisplayName || "").replace(/[^\x20-\x7E]/g, "").trim();
      if (data.Results && Array.isArray(data.Results)) {
        for (const result of data.Results) {
          if (result.XPInfo && Array.isArray(result.XPInfo)) {
            xpInfo = xpInfo.concat(result.XPInfo);
          }
          if (!displayName && result.DisplayName) displayName = result.DisplayName.replace(/[^\x20-\x7E]/g, "").trim();
        }
      } else if (data.XPInfo && Array.isArray(data.XPInfo)) {
        xpInfo = data.XPInfo;
      }
      const transformedData = { XPInfo: xpInfo, DisplayName: displayName };
      processProfile(transformedData);
      // Retry if profile came back blank
      if (!xpInfo || xpInfo.length === 0) {
        setTimeout(() => fetchProfile(), 3000);
        return;
      }
      // Auto-refresh from API every 5 minutes
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(() => {
        fetchProfile();
      }, 5 * 60 * 1000);
    } catch (err) {
      showError("Fetch error: " + err.message);
    } finally {
      showLoading(false);
    }
  }

  // --- Catalog loading ---
  async function loadCatalog() {
    try {
      const res = await fetch(API_BASE + "/catalog");
      if (!res.ok) throw new Error("Catalog fetch failed: " + res.status);
      state.catalog = await res.json();
      populateTypeFilter();
    } catch (err) {
      console.warn("Catalog not available:", err.message);
      state.catalog = null;
    }
  }

  function populateTypeFilter() {
    const select = $("#type-filter");
    if (!select || !state.catalog) return;
    const types = [...new Set(state.catalog.map((i) => i.type))].sort();
    types.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
  }

  // --- MR level switch for Kuva/Tenet/Coda weapons (localStorage) ---
  const MR_LEVEL_KEY = "wf_mastery_mr_level";
  function getMrLevels() {
    try {
      return JSON.parse(localStorage.getItem(MR_LEVEL_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function setMrLevel(uniqueName, level) {
    const levels = getMrLevels();
    if (level === null) {
      delete levels[uniqueName];
    } else {
      levels[uniqueName] = level;
    }
    localStorage.setItem(MR_LEVEL_KEY, JSON.stringify(levels));
  }
  function clearMrLevels() {
    localStorage.removeItem(MR_LEVEL_KEY);
  }
  function isFormaToggleable(name, baseMr) {
    // Only regular weapons (base 3000) can be forma'd to reach MR 40
    return baseMr === 3000;
  }

  // --- Process profile ---
  function processProfile(data) {
    state.profile = data;
    // Display gamertag
    const nameEl = $("#player-name");
    if (nameEl) {
      let name = "";
      if (data.Results && Array.isArray(data.Results) && data.Results[0]) {
        name = (data.Results[0].DisplayName || "").replace(/<<ZIMA_USER>>/g, "deadvision").replace(/[^\x20-\x7E]/g, "").trim();
      } else if (data.DisplayName) {
        name = data.DisplayName.replace(/<<ZIMA_USER>>/g, "deadvision").replace(/[^\x20-\x7E]/g, "").trim();
      }
      nameEl.textContent = name ? name : "";
    }
    const ownedMap = new Map();
    (data.XPInfo || []).forEach((x) => {
      let itemType = x.ItemType;
      if (itemType.includes("SiriusOrion")) {
        itemType = "/Lotus/Powersuits/SiriusOrion/Merged";
      }
      ownedMap.set(itemType, x.XP || 0);
    });
    computeItems(ownedMap);
    renderSummary();
    renderTable();
    $("#dashboard").style.display = "block";
    // Hide Load Profile section only after a successful non-blank load
    const loadSection = $("#load-profile-section");
    if (loadSection && state.items.length > 0 && data.XPInfo && data.XPInfo.length > 0) {
      loadSection.style.display = "none";
    }
  }

  // --- Compute items list ---
  function computeItems(ownedMap) {
    if (!state.catalog) {
      state.items = [];
      return;
    }
    const mrLevels = getMrLevels();
    state.items = state.catalog
      .filter((item) => (item.masteryLevel || 0) > 0)
      .map((item) => {
      const itemType = item.uniqueName || "";
      const owned = ownedMap.has(itemType);
      const xp = owned ? (ownedMap.get(itemType) || 0) : 0;
      // Apply MR level switch for forma'd weapons
      let mr = item.masteryLevel || 0;
      const toggleable = isFormaToggleable(item.name, item.masteryLevel || 0);
      if (toggleable && mrLevels.hasOwnProperty(itemType)) {
        const base = (item.masteryLevel || 0);
        const formaMr = base + 1000;
        mr = mrLevels[itemType] === 'forma' ? formaMr : base;
      }
      return {
        name: item.name || "Unknown",
        type: item.type || "Unknown",
        mr,
        baseMr: item.masteryLevel || 0,
        owned,
        itemType,
        xp,
        imageName: item.imageName || null,
        wikiaUrl: item.wikiaUrl || null,
        imageUrl: item.imageUrl || null,
        imageFallbackUrl: item.imageFallbackUrl || null,
        isPrime: item.isPrime || false,
        masteryReq: item.masteryReq || 0,
        isFormaToggleable: isFormaToggleable(item.name, item.masteryLevel || 0),
        mrLevel: mrLevels[itemType] || 'base',
      };
    });
    
    // Add manual companions if owned but not in catalog
    const manualCompanions = [
      { uniqueName: '/Lotus/Types/Game/KubrowPet/ChargerKubrowPetPowerSuit', name: 'Charger Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/RetrieverKubrowPetPowerSuit', name: 'Retriever Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit', name: 'Furtive Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/GuardKubrowPetPowerSuit', name: 'Guard Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit', name: 'Hunter Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/AdventurerKubrowPetPowerSuit', name: 'Adventurer Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Powersuits/Khora/Kavat/KhoraKavatPowerSuit', name: 'Venari (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Powersuits/Khora/Kavat/KhoraPrimeKavatPowerSuit', name: 'Venari Prime (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CreaturePets/PharaohPredatorKubrowPetPowerSuit', name: 'Pharaoh Predasite (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CreaturePets/VizierPredatorKubrowPetPowerSuit', name: 'Vizier Predasite (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CreaturePets/MedjayPredatorKubrowPetPowerSuit', name: 'Medjay Predasite (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      // Additional missing beasts/hounds/moas/kavats/vulpaphylas
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/AdarzaCatbrowPetPowerSuit', name: 'Adarza Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/SmeetaCatbrowPetPowerSuit', name: 'Smeeta Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/VascaCatbrowPetPowerSuit', name: 'Vasca Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/CheshireCatbrowPetPowerSuit', name: 'Adarza Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/MirrorCatbrowPetPowerSuit', name: 'Smeeta Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/VampireCatbrowPetPowerSuit', name: 'Vasca Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/ArmoredInfestedCatbrowPetPowerSuit', name: 'Adarza Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/VulpineInfestedCatbrowPetPowerSuit', name: 'Smeeta Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/CatbrowPet/HornedInfestedCatbrowPetPowerSuit', name: 'Vasca Kavat (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Vulpaphyla/VulpaphylaSlyPowerSuit', name: 'Sly Vulpaphyla (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Vulpaphyla/VulpaphylaCrescentPowerSuit', name: 'Crescent Vulpaphyla (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Vulpaphyla/VulpaphylaPanzerPowerSuit', name: 'Panzer Vulpaphyla (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/ChesaKubrowPetPowerSuit', name: 'Chesa Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/HurasKubrowPetPowerSuit', name: 'Huras Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/RaksaKubrowPetPowerSuit', name: 'Raksa Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/SahasaKubrowPetPowerSuit', name: 'Sahasa Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Game/KubrowPet/SunikaKubrowPetPowerSuit', name: 'Sunika Kubrow (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/HelminthCharger/HelminthChargerPowerSuit', name: 'Helminth Charger (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Hounds/HoundBhairaPowerSuit', name: 'Bhaira Hound (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Hounds/HoundDormaPowerSuit', name: 'Dorma Hound (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/Hounds/HoundHecPowerSuit', name: 'Hec Hound (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/MoaPets/LambeoMoaPetPowerSuit', name: 'Lambeo Moa (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/MoaPets/OloroMoaPetPowerSuit', name: 'Oloro Moa (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/MoaPets/ParaMoaPetPowerSuit', name: 'Para Moa (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/MoaPets/NychusMoaPetPowerSuit', name: 'Nychus Moa (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
      { uniqueName: '/Lotus/Types/Friendly/Pets/MoaPets/MoaPetPowerSuit', name: 'Lambeo Moa (Manual)', type: 'Pet', mr: 6000, masteryReq: 6000 },
    ];
    for (const comp of manualCompanions) {
      if (ownedMap.has(comp.uniqueName) && !state.items.find(i => i.itemType === comp.uniqueName)) {
        state.items.push({
          name: comp.name,
          type: comp.type,
          mr: comp.mr,
          baseMr: comp.mr,
          owned: true,
          itemType: comp.uniqueName,
          xp: ownedMap.get(comp.uniqueName) || 0,
          imageName: null,
          wikiaUrl: null,
          imageUrl: null,
          imageFallbackUrl: null,
          isPrime: false,
          masteryReq: comp.masteryReq,
          isFormaToggleable: false,
          mrLevel: 'base',
          manual: true,
        });
      }
    }
  }

  // --- Render summary stats ---
  function renderSummary() {
    const total = state.items.length;
    const owned = state.items.filter((i) => i.owned).length;
    const missing = total - owned;
    const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
    const mpOwned = state.items.filter((i) => i.owned).reduce((sum, i) => sum + i.mr, 0);
    const mpTotal = state.items.reduce((sum, i) => sum + i.mr, 0);
    
    // Mastery Rank thresholds from Warframe Wiki (Total XP Required)
    const mrThresholds = [0, 2500, 10000, 22500, 40000, 62500, 90000, 122500, 160000, 202500, 250000, 302500, 360000, 422500, 490000, 562500, 640000, 722500, 810000, 902500, 1000000, 1102500, 1210000, 1322500, 1440000, 1562500, 1690000, 1822500, 1960000, 2102500, 2250000, 2397500, 2545000, 2692500, 2840000, 2987500, 3135000];
    const mrNames = ["Unranked", "Initiate", "Silver Initiate", "Gold Initiate", "Novice", "Silver Novice", "Gold Novice", "Disciple", "Silver Disciple", "Gold Disciple", "Seeker", "Silver Seeker", "Gold Seeker", "Hunter", "Silver Hunter", "Gold Hunter", "Eagle", "Silver Eagle", "Gold Eagle", "Tiger", "Silver Tiger", "Gold Tiger", "Dragon", "Silver Dragon", "Gold Dragon", "Sage", "Silver Sage", "Gold Sage", "Master", "Middle Master", "True Master", "Legendary 1", "Legendary 2", "Legendary 3", "Legendary 4", "Legendary 5", "Legendary 6"];
    
    let mr = 0;
    for (let i = mrThresholds.length - 1; i >= 0; i--) {
      if (mpOwned >= mrThresholds[i]) {
        mr = i;
        break;
      }
    }
    
    $("#stat-total").textContent = total.toLocaleString();
    $("#stat-owned").textContent = owned.toLocaleString();
    $("#stat-missing").textContent = missing.toLocaleString();
    $("#stat-pct").textContent = pct + "%";
    $("#stat-mp-owned").textContent = mpOwned.toLocaleString();
    $("#stat-mp-total").textContent = mpTotal.toLocaleString();
    $("#stat-mr").textContent = mr + " (" + mrNames[mr] + ")";
    const fill = $("#summary-progress");
    if (fill) {
      fill.style.width = pct + "%";
      fill.classList.toggle("success", pct >= 50);
      fill.classList.toggle("warning", pct < 50);
    }
  }

  // --- Render table ---
  function renderTable() {
    const tbody = $("#items-tbody");
    const tableWrap = document.querySelector(".table-wrap");
    if (!tbody) return;
    let list = state.items;

    // Filter by owned/missing
    if (state.filter === "owned") list = list.filter((i) => i.owned);
    else if (state.filter === "missing") list = list.filter((i) => !i.owned);

    // Filter by type
    if (state.typeFilter !== "all") {
      list = list.filter((i) => i.type === state.typeFilter);
    }

    // Filter by prime
    if (state.primeFilter === "prime") list = list.filter((i) => i.isPrime);
    else if (state.primeFilter === "nonprime") list = list.filter((i) => !i.isPrime);

    // Search
    if (state.search) {
      list = list.filter((i) =>
        i.name.toLowerCase().includes(state.search)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      switch (state.sort) {
        case "name-asc": return a.name.localeCompare(b.name);
        case "name-desc": return b.name.localeCompare(a.name);
        case "mr-desc": return b.mr - a.mr;
        case "mr-asc": return a.mr - b.mr;
        case "type-asc": return a.type.localeCompare(b.type);
        default: return 0;
      }
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">No items to display.</td></tr>';
      return;
    }

    if (state.view === "cards") {
      // Card view
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:12px;">';
      list.forEach((item) => {
        const imgHtml = item.imageUrl
          ? '<img src="' + item.imageUrl + '" alt="" style="width:48px;height:48px;object-fit:contain;" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback=\'\';}else{this.style.display=\'none\'}" ' + (item.imageFallbackUrl ? 'data-fallback="' + item.imageFallbackUrl.replace(/&/g, '&amp;') + '"' : '') + ' />'
          : '<div style="width:48px;height:48px;margin:0 auto;background:#30363d;border-radius:4px;"></div>';
        const badge = item.owned
          ? '<span class="badge owned">Owned</span>'
          : '<span class="badge missing">Missing</span>';
        html += '<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;text-align:center;">' +
          imgHtml +
          '<div style="margin:8px 0;font-weight:600;font-size:14px;">' + (item.wikiaUrl ? '<a class="item-name-link" href="' + item.wikiaUrl + '" target="_blank" rel="noopener">' + escapeHtml(item.name) + '</a>' : escapeHtml(item.name) + (item.manual ? ' <span style="color:#d29922;font-size:10px;">[MANUAL]</span>' : '')) + '</div>' +
          '<div style="font-size:11px;color:#8b949e;">' + escapeHtml(item.type) + '</div>' +
          '<div style="margin-top:6px;font-size:12px;">MR ' + item.mr.toLocaleString() + '</div>' +
          '<div style="margin-top:4px;">' + badge + '</div>' +
          '</div>';
      });
      html += '</div>';
      tbody.innerHTML = '<tr><td colspan="5" style="padding:0;border:none;">' + html + '</td></tr>';
      return;
    }

    // Table view
    tbody.innerHTML = list
      .map((item) => {
        let badge;
        if (item.isFormaToggleable) {
          badge = '<span class="badge ' + (item.owned ? 'owned' : 'missing') + '" data-item="' + escapeHtml(item.itemType) + '" style="cursor:pointer;" title="Click to toggle Forma">' + (item.owned ? 'Owned' : 'Missing') + ' · ' + (item.mr === item.baseMr ? 'Base' : 'Forma') + '</span>';
        } else {
          badge = item.owned
            ? '<span class="badge owned">Owned</span>'
            : '<span class="badge missing">Missing</span>';
        }
        const imgHtml = item.imageUrl
          ? '<img class="item-icon" src="' + item.imageUrl + '" alt="" loading="lazy" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback=\'\';}else{this.style.display=\'none\'}" ' + (item.imageFallbackUrl ? 'data-fallback="' + item.imageFallbackUrl.replace(/&/g, '&amp;') + '"' : '') + ' />'
          : '<span class="item-icon ' + (item.type?.toLowerCase().split(' ')[0] || '') + '" title="' + escapeHtml(item.type) + '"></span>';
        const nameHtml = item.wikiaUrl
          ? '<a class="item-name-link" href="' + item.wikiaUrl + '" target="_blank" rel="noopener">' + escapeHtml(item.name) + '</a>'
          : escapeHtml(item.name) + (item.manual ? ' <span style="color:#d29922;font-size:10px;">[MANUAL]</span>' : '');
        const primeTag = item.isPrime && !item.name.toLowerCase().includes("prime") ? '<span class="prime-tag">Prime</span>' : '';
        const masteryHtml = item.owned
          ? '<span class="mastery-text">MR ' + item.mr.toLocaleString() + '</span>'
          : '<span class="mastery-text">Req: MR ' + item.masteryReq + '</span>';
        return '<tr>' +
          '<td>' + imgHtml + '</td>' +
          '<td>' + nameHtml + ' ' + primeTag + '</td>' +
          '<td>' + escapeHtml(item.type) + '</td>' +
          '<td>' + masteryHtml + '</td>' +
          '<td>' + badge + '</td>' +
          '</tr>';
      })
      .join("");

    // Add click handlers for Forma toggle
    tbody.querySelectorAll(".badge").forEach((badge) => {
      if (!badge.dataset.item) return;
      const item = state.items.find((i) => i.itemType === badge.dataset.item);
      if (!item || !item.isFormaToggleable) return;
      badge.addEventListener("click", () => {
        const newLevel = (item.mrLevel || 'base') === 'forma' ? 'base' : 'forma';
        setMrLevel(item.itemType, newLevel);
        if (state.profile) {
          const ownedMap = new Map();
          (state.profile.XPInfo || []).forEach((x) => {
            let it = x.ItemType;
            if (it.includes("SiriusOrion")) it = "/Lotus/Powersuits/SiriusOrion/Merged";
            ownedMap.set(it, x.XP || 0);
          });
          computeItems(ownedMap);
        } else {
          computeItems(new Map());
        }
        renderSummary();
        renderTable();
      });
    });

  }

  // --- Helpers ---
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showLoading(on) {
    const el = $("#loading");
    if (el) el.style.display = on ? "block" : "none";
  }

  function showError(msg) {
    let el = $("#error");
    if (!el) {
      el = document.createElement("div");
      el.id = "error";
      el.style.cssText =
        "position:fixed;top:20px;right:20px;background:var(--danger);color:#fff;padding:12px 20px;border-radius:6px;z-index:9999;max-width:400px;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    setTimeout(() => (el.style.display = "none"), 5000);
  }
})();
