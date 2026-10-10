/**
 * OmniTactica Retribution Armory
 * Client-Side Engine, Multi-System Store Modal & Effect Dispatcher
 */

(function(window) {
  'use strict';

  var VALID_ARMORY_SLOTS = ['active_dice', 'active_card_frame', 'active_card_finish', 'active_title', 'active_avatar'];

  var AOS_ITEM_IDS_LIST = [
    "dice_celestial_sigmarite", "dice_death_bone", "dice_aos_stormcast", "dice_aos_khorne", "dice_aos_gloomspite",
    "dice_aos_soulblight", "dice_aos_sylvaneth", "dice_aos_skaven", "dice_aos_bonereapers", "dice_aos_seraphon",
    "dice_aos_maggotkin", "dice_aos_ironjawz", "dice_aos_slavestodarkness", "dice_aos_nighthaunt", "dice_aos_daughtersofkhaine",
    "dice_aos_citiesofsigmar", "dice_aos_kharadron", "dice_aos_fyreslayers", "dice_aos_idoneth", "dice_aos_lumineth",
    "dice_aos_flesheater", "frame_realm_chamon", "frame_ghur_feral", "frame_shyish_obsidian", "frame_hysh_celestial",
    "finish_aos_astral_holofoil", "finish_aos_stormcast_eternals", "finish_aos_blades_of_khorne", "finish_aos_gloomspite_gitz",
    "finish_aos_soulblight_gravelords", "finish_aos_sylvaneth", "finish_aos_beasts_of_chaos", "finish_aos_cities_of_sigmar",
    "finish_aos_daughters_of_khaine", "finish_aos_disciples_of_tzeentch", "finish_aos_flesh_eater_courts", "finish_aos_fyreslayers",
    "finish_aos_hedonites_of_slaanesh", "finish_aos_idoneth_deepkin", "finish_aos_kharadron_overlords", "finish_aos_lumineth_realm_lords",
    "finish_aos_maggotkin_of_nurgle", "finish_aos_nighthaunt", "finish_aos_ogor_mawtribes", "finish_aos_orruk_warclans",
    "finish_aos_ossiarch_bonereapers", "finish_aos_seraphon", "finish_aos_skaven", "finish_aos_slaves_to_darkness",
    "finish_aos_sons_of_behemat", "avatar_stormcast_eternals", "avatar_khorne_bloodbound", "avatar_gloomspite_gitz",
    "avatar_soulblight_gravelords", "avatar_sylvaneth", "avatar_beasts_of_chaos", "avatar_cities_of_sigmar",
    "avatar_daughters_of_khaine", "avatar_disciples_of_tzeentch", "avatar_flesh_eater_courts", "avatar_fyreslayers",
    "avatar_hedonites_of_slaanesh", "avatar_idoneth_deepkin", "avatar_kharadron_overlords", "avatar_lumineth_realm_lords",
    "avatar_maggotkin_of_nurgle", "avatar_nighthaunt", "avatar_ogor_mawtribes", "avatar_orruk_warclans",
    "avatar_ossiarch_bonereapers", "avatar_seraphon", "avatar_skaven", "avatar_slaves_to_darkness", "avatar_sons_of_behemat",
    "title_lord_celestant", "title_everchosen_herald", "title_ghoul_king", "title_bad_moon_chosen", "title_anointed_of_khaine",
    "title_arkanaut_admiral", "title_slann_starmaster", "title_clawlord_of_blight", "poke_sigmar_bolt", "poke_squig_nibble",
    "poke_khorne_roar", "poke_nighthaunt_shriek", "poke_khorne_blood_tithe", "poke_bad_moon_looming", "poke_sigmar_comet_strike",
    "poke_tzeentch_twist", "poke_nurgle_rot_bell"
  ];
  var AOS_ITEM_ID_MAP = {};
  AOS_ITEM_IDS_LIST.forEach(function(id) { AOS_ITEM_ID_MAP[id] = true; });

  function createEmptySystemEquipped() {
    return {
      active_dice: null,
      active_card_frame: null,
      active_card_finish: null,
      active_title: null,
      active_avatar: null
    };
  }

  function detectActiveGameSystem() {
    if (typeof window !== 'undefined' && (window.currentGameSystem === '40k' || window.currentGameSystem === 'aos')) {
      return window.currentGameSystem;
    }
    try {
      var path = (window.location && window.location.pathname || '').toLowerCase();
      var hash = (window.location && window.location.hash || '').toLowerCase();
      if (path.indexOf('/aos') === 0 || path.indexOf('/11th/tracker/aos') === 0 || hash.indexOf('#/aos') === 0 || hash.indexOf('/aos/') !== -1) {
        return 'aos';
      }
      var stored = (localStorage.getItem('omni_game_system') || '').toLowerCase();
      if (stored === 'aos' || stored === '40k') return stored;
    } catch (e) {}
    return '40k';
  }

  var currentGameSystem = detectActiveGameSystem();
  var currentCatalog = null;
  var catalogBySystem = { '40k': null, 'aos': null };
  var currentVault = { inventory: {}, equipped: { '40k': createEmptySystemEquipped(), 'aos': createEmptySystemEquipped() } };
  var currentGlory = { total_earned: 0, glory_spent: 0, spendable_glory: 0, crest_tier: 1 };
  var activeWingFilter = 'all';
  var currentArmoryMode = 'vault'; // 'vault' (Command Home) or 'store' (Requisition Depot)
  var activeVaultTab = 'backpack'; // 'backpack' or 'ledger'
  var isPurchasing = false;

  function findCatalogItemById(itemId) {
    if (!itemId) return null;
    var sources = [currentCatalog, catalogBySystem['40k'], catalogBySystem['aos']];
    for (var s = 0; s < sources.length; s++) {
      var cat = sources[s];
      if (cat && Array.isArray(cat.items)) {
        for (var i = 0; i < cat.items.length; i++) {
          if (cat.items[i].id === itemId) return cat.items[i];
        }
      }
    }
    return null;
  }

  function getItemGameSystem(itemId) {
    if (!itemId || typeof itemId !== 'string') return null;
    var found = findCatalogItemById(itemId);
    if (found && found.game_system) {
      return String(found.game_system).toLowerCase();
    }
    if (AOS_ITEM_ID_MAP[itemId] || itemId.indexOf('_aos_') !== -1 || itemId.indexOf('aos_') === 0) {
      return 'aos';
    }
    return '40k';
  }

  function normalizeEquippedObject(rawEq) {
    var src = (rawEq && typeof rawEq === 'object') ? rawEq : {};
    var eq40k = createEmptySystemEquipped();
    var eqAos = createEmptySystemEquipped();
    var had40k = !!(src['40k'] && typeof src['40k'] === 'object');
    var hadAos = !!(src['aos'] && typeof src['aos'] === 'object');

    if (had40k) {
      VALID_ARMORY_SLOTS.forEach(function(slot) {
        var val = src['40k'][slot];
        if (typeof val === 'string' && val.trim()) {
          val = val.trim();
          if (getItemGameSystem(val) === 'aos') {
            if (!eqAos[slot]) eqAos[slot] = val;
          } else {
            eq40k[slot] = val;
          }
        }
      });
    }
    if (hadAos) {
      VALID_ARMORY_SLOTS.forEach(function(slot) {
        var val = src['aos'][slot];
        if (typeof val === 'string' && val.trim()) {
          val = val.trim();
          if (getItemGameSystem(val) === '40k') {
            if (!eq40k[slot]) eq40k[slot] = val;
          } else {
            eqAos[slot] = val;
          }
        }
      });
    }
    VALID_ARMORY_SLOTS.forEach(function(slot) {
      var val = src[slot];
      if (typeof val === 'string' && val.trim()) {
        val = val.trim();
        var itemSys = getItemGameSystem(val);
        if (itemSys === 'aos') {
          if (!hadAos && !eqAos[slot]) eqAos[slot] = val;
        } else {
          if (!had40k && !eq40k[slot]) eq40k[slot] = val;
        }
      }
    });
    return { '40k': eq40k, 'aos': eqAos };
  }

  function getEquippedForSystem(allEq, system) {
    var sys = String(system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
    if (sys !== '40k' && sys !== 'aos') sys = '40k';
    var normalized = normalizeEquippedObject(allEq || (currentVault && currentVault.equipped) || {});
    return normalized[sys] || createEmptySystemEquipped();
  }
  window.getEquippedForSystem = getEquippedForSystem;

  function syncCachedUserVault() {
    if (!currentVault || !currentVault.equipped) return;
    currentVault.equipped = normalizeEquippedObject(currentVault.equipped);
    if (typeof window !== 'undefined') {
      if (window.myHubData && typeof window.myHubData === 'object') {
        window.myHubData.equipped = currentVault.equipped;
        if (window.myHubData.armory_vault && typeof window.myHubData.armory_vault === 'object') {
          window.myHubData.armory_vault.equipped = currentVault.equipped;
        }
      }
      if (window.currentUser && typeof window.currentUser === 'object') {
        window.currentUser.equipped = currentVault.equipped;
        if (window.currentUser.armory_vault && typeof window.currentUser.armory_vault === 'object') {
          window.currentUser.armory_vault.equipped = currentVault.equipped;
        }
      }
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Synchronize Armory when the global app game system switches (navbar 40K <-> AoS)
   */
  async function syncGlobalGameSystem(sys) {
    var nextSys = (sys === 'aos') ? 'aos' : '40k';
    currentGameSystem = nextSys;
    applyEquippedDecorations(nextSys);
    await loadArmoryData(nextSys);
    applyEquippedDecorations(nextSys);
    if (document.getElementById('retribution-armory-modal')) {
      renderArmoryModalShell();
    }
  }

  var inFlightCatalogPromise = {};
  var lastCatalogLoadedAt = {};

  function hydrateVaultFromGlobalSession() {
    var hub = window.myHubData;
    var usr = window.currentUser || (window.api && window.api.currentUser);
    if ((!currentVault || !currentVault.inventory || Object.keys(currentVault.inventory).length === 0)) {
      var candidateVault = (hub && hub.armory_vault) || (usr && usr.armory_vault);
      if (candidateVault && typeof candidateVault === 'object') {
        currentVault = {
          inventory: candidateVault.inventory || {},
          equipped: normalizeEquippedObject(candidateVault.equipped || {})
        };
      }
    }
    if (!currentGlory || (!currentGlory.total_earned && !currentGlory.spendable_glory)) {
      if (hub && (hub.glory_balance !== undefined || hub.total_glory !== undefined)) {
        currentGlory = {
          spendable_glory: Number(hub.spendable_glory !== undefined ? hub.spendable_glory : (hub.glory_balance || 0)),
          total_earned: Number(hub.total_earned !== undefined ? hub.total_earned : (hub.unified_glory || hub.total_glory || 0)),
          glory_spent: Number(hub.glory_spent || 0),
          glory_40k: Number(hub.glory_40k || 0),
          glory_aos: Number(hub.glory_aos || 0),
          peak_elo: Number((hub.player && hub.player.peak_elo) || 1500)
        };
      }
    }
  }

  /**
   * Switch active game system inside Armory modal (40k vs aos)
   */
  async function switchGameSystem(sys) {
    if (sys !== '40k' && sys !== 'aos') sys = '40k';
    currentGameSystem = sys;

    // Update switcher tab UI
    var tabs = document.querySelectorAll('.armory-system-btn');
    tabs.forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-sys') === sys);
    });

    if (catalogBySystem[sys] && Array.isArray(catalogBySystem[sys].items)) {
      currentCatalog = catalogBySystem[sys];
      renderArmoryGrid();
      if (Date.now() - (lastCatalogLoadedAt[sys] || 0) > 15000) {
        loadArmoryData(sys).then(function() {
          if (currentGameSystem === sys && document.getElementById('retribution-armory-modal')) {
            renderArmoryGrid();
          }
        });
      }
      return;
    }

    var gridEl = document.getElementById('armory-products-grid');
    if (gridEl) {
      gridEl.innerHTML = buildArmoryLoadingHtml(sys === 'aos' ? 'Synchronizing Age of Sigmar Grand Alliance Relics...' : 'Synchronizing Warhammer 40,000 Command Vault...');
    }

    await loadArmoryData(sys);
    renderArmoryGrid();
  }

  /**
   * Fetch latest catalog & user vault from server (single unified request with in-flight deduplication)
   */
  async function loadArmoryData(gameSys, forceRefresh) {
    var sys = (gameSys || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
    if (sys !== '40k' && sys !== 'aos') sys = '40k';

    hydrateVaultFromGlobalSession();

    if (!catalogBySystem[sys]) {
      try {
        var rawCachedCat = localStorage.getItem('omnitactica_armory_catalog_cache_' + sys);
        if (rawCachedCat) {
          var parsedCat = JSON.parse(rawCachedCat);
          if (parsedCat && Array.isArray(parsedCat.items)) {
            catalogBySystem[sys] = parsedCat;
            if (!currentCatalog) currentCatalog = parsedCat;
          }
        }
      } catch (e) {}
    }

    if (!forceRefresh && catalogBySystem[sys] && (Date.now() - (lastCatalogLoadedAt[sys] || 0) < 10000)) {
      currentCatalog = catalogBySystem[sys];
      return currentCatalog;
    }

    if (inFlightCatalogPromise[sys]) {
      return inFlightCatalogPromise[sys];
    }

    inFlightCatalogPromise[sys] = (async function() {
      var abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = abortCtrl ? setTimeout(function() { try { abortCtrl.abort(); } catch (e) {} }, 5500) : null;
      try {
        var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
        var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        var fetchOpts = {
          headers: headers,
          credentials: 'include',
          cache: 'no-store'
        };
        if (abortCtrl) fetchOpts.signal = abortCtrl.signal;

        var catRes = await fetch('/api/armory/catalog?game_system=' + encodeURIComponent(sys) + '&_t=' + Date.now(), fetchOpts);

        if (catRes && catRes.ok) {
          var data = await catRes.json();
          currentCatalog = data;
          catalogBySystem[sys] = data;
          lastCatalogLoadedAt[sys] = Date.now();
          if (data.user_glory) currentGlory = data.user_glory;
          if (data.user_vault) currentVault = data.user_vault;
          try {
            localStorage.setItem('omnitactica_armory_catalog_cache_' + sys, JSON.stringify(data));
          } catch (e) {}
        }

        // Strict per-system normalization: never write flat top-level slot keys
        if (!currentVault) currentVault = { inventory: {}, equipped: {} };
        currentVault.equipped = normalizeEquippedObject(currentVault.equipped);

        // If catalog items for `sys` have is_equipped === true, reflect them into currentVault.equipped[sys] ONLY
        if (currentCatalog && Array.isArray(currentCatalog.items)) {
          currentCatalog.items.forEach(function(item) {
            var itemSys = (item.game_system || sys).toLowerCase();
            if (itemSys === sys && item.is_equipped && item.slot) {
              currentVault.equipped[sys][item.slot] = item.id;
            }
          });
        }

        syncCachedUserVault();
        updateArmoryHeaderBalance();
        return currentCatalog;
      } catch (e) {
        console.warn('Notice loading armory catalog:', e);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        delete inFlightCatalogPromise[sys];
      }
      return currentCatalog || catalogBySystem[sys] || null;
    })();

    return inFlightCatalogPromise[sys];
  }

  /**
   * Requisition (Purchase) an item with Glory
   */
  async function purchaseItem(itemId) {
    if (isPurchasing) return;
    isPurchasing = true;

    var btn = document.getElementById('armory-buy-btn-' + itemId);
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Requisitioning...</span>';
    }

    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/purchase', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ item_id: itemId })
      });

      var data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Failed to requisition item');
      }

      // Success notification toast
      showArmoryNotification('🎉 ' + data.message, 'success');

      // Update local state
      if (data.vault) {
        currentVault = data.vault;
        currentVault.equipped = normalizeEquippedObject(currentVault.equipped);
        syncCachedUserVault();
      }
      if (data.glory) currentGlory = data.glory;

      // Automatically equip if permanent cosmetic
      if (data.item && !data.item.is_consumable && data.item.slot) {
        var itemSys = (data.item.game_system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
        await equipItem(data.item.slot, data.item.id, true, itemSys);
      } else {
        await loadArmoryData();
        renderArmoryGrid();
      }

      updateArmoryHeaderBalance();
      // Update global UI decoration for the active page system
      applyEquippedDecorations(detectActiveGameSystem());

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
    } finally {
      isPurchasing = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  /**
   * Toggle equip/unequip for an item
   */
  async function toggleEquip(slot, itemId, system) {
    var itemSys = getItemGameSystem(itemId);
    var sys = (system || itemSys || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
    var eq = getEquippedForSystem(currentVault.equipped, sys);
    var currentlyEquipped = eq[slot];

    if (currentlyEquipped === itemId) {
      return await unequipSlot(slot, false, sys);
    } else {
      return await equipItem(slot, itemId, false, sys);
    }
  }

  /**
   * Equip an owned item into an active slot
   */
  async function equipItem(slot, itemId, silent, system) {
    var itemSys = getItemGameSystem(itemId);
    var sys = (itemSys || system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
    if (sys !== '40k' && sys !== 'aos') sys = '40k';

    // 1. Instant optimistic in-memory update (strictly scoped to `sys`)
    currentVault.equipped = normalizeEquippedObject(currentVault.equipped);
    currentVault.equipped[sys][slot] = itemId;
    syncCachedUserVault();

    if (slot === 'active_dice') {
      try {
        localStorage.setItem('omnitactica_active_dice_' + sys, itemId);
        if (sys === '40k') localStorage.setItem('omnitactica_active_dice', itemId);
      } catch(e) {}
    }

    if (currentCatalog && currentCatalog.items) {
      currentCatalog.items.forEach(function(i) {
        if (i.slot === slot && (i.game_system || sys).toLowerCase() === sys) {
          i.is_equipped = (i.id === itemId);
        }
      });
    }

    // Immediately reflect on Armory modal grid, header, and profile card!
    renderArmoryGrid();
    applyEquippedDecorations(detectActiveGameSystem());
    updateArmoryHeaderBalance();

    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/equip', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ slot: slot, item_id: itemId, game_system: sys })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to equip item');

      if (data.equipped) {
        currentVault.equipped = normalizeEquippedObject(data.equipped);
        syncCachedUserVault();
      }
      if (!silent) showArmoryNotification('⚔️ ' + data.message, 'success');

      await loadArmoryData(currentGameSystem);
      renderArmoryGrid();
      applyEquippedDecorations(detectActiveGameSystem());
      updateArmoryHeaderBalance();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
      await loadArmoryData(currentGameSystem);
      renderArmoryGrid();
      applyEquippedDecorations(detectActiveGameSystem());
    }
  }

  /**
   * Unequip an item slot back to default
   */
  async function unequipSlot(slot, silent, system) {
    var sys = (system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
    if (sys !== '40k' && sys !== 'aos') sys = '40k';

    // 1. Instant optimistic in-memory update (strictly scoped to `sys`)
    currentVault.equipped = normalizeEquippedObject(currentVault.equipped);
    currentVault.equipped[sys][slot] = null;
    syncCachedUserVault();

    if (slot === 'active_dice') {
      try {
        localStorage.removeItem('omnitactica_active_dice_' + sys);
        if (sys === '40k') localStorage.removeItem('omnitactica_active_dice');
      } catch(e) {}
    }

    if (currentCatalog && currentCatalog.items) {
      currentCatalog.items.forEach(function(i) {
        if (i.slot === slot && (i.game_system || sys).toLowerCase() === sys) {
          i.is_equipped = false;
        }
      });
    }

    renderArmoryGrid();
    applyEquippedDecorations(detectActiveGameSystem());
    updateArmoryHeaderBalance();

    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/unequip', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ slot: slot, game_system: sys })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to unequip slot');

      if (data.equipped) {
        currentVault.equipped = normalizeEquippedObject(data.equipped);
        syncCachedUserVault();
      }
      if (!silent) showArmoryNotification('🛡️ ' + data.message, 'info');

      await loadArmoryData(currentGameSystem);
      renderArmoryGrid();
      applyEquippedDecorations(detectActiveGameSystem());

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
      await loadArmoryData(currentGameSystem);
      renderArmoryGrid();
      applyEquippedDecorations(detectActiveGameSystem());
    }
  }

  /**
   * Poke another player (consumes 1 charge)
   */
  async function pokePlayer(targetPlayerId, pokeId, targetName) {
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/poke', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({
          poke_id: pokeId,
          target_player_id: targetPlayerId || 'p_rival',
          target_name: targetName || 'Opposing Commander'
        })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to dispatch poke');

      // Play poke banner toast
      showArmoryPokeToast(data);

      // Update local vault inventory
      await loadArmoryData();
      renderArmoryGrid();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
    }
  }

  /**
   * Displays rich animated Poke banner
   */
  function showArmoryPokeToast(data) {
    var toast = document.createElement('div');
    toast.className = 'armory-poke-toast';
    toast.style.borderColor = data.css_glow || '#38bdf8';
    toast.style.boxShadow = '0 0 25px ' + (data.css_glow || '#38bdf8');
    toast.innerHTML = [
      '<div class="poke-toast-icon">' + (data.icon || '👉') + '</div>',
      '<div class="poke-toast-content">',
      '  <div class="poke-toast-title">PLAYER POKE DISPATCHED</div>',
      '  <div class="poke-toast-body">' + escapeHtml(data.toast_message || data.message) + '</div>',
      '  <div class="poke-toast-meta">Target: <strong>' + escapeHtml(data.target_name) + '</strong> &bull; Charges remaining: <strong>' + data.charges_remaining + '</strong></div>',
      '</div>'
    ].join('');

    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('active'); }, 10);
    setTimeout(function() {
      toast.classList.remove('active');
      setTimeout(function() { toast.remove(); }, 350);
    }, 4000);
  }

  /**
   * Open Poke Rival quick modal
   */
  async function openPokeRivalModal(targetPlayerId, targetName) {
    var existing = document.getElementById('poke-rival-modal');
    if (existing) existing.remove();

    var tName = targetName || 'Opposing Rival';
    var tId = targetPlayerId || 'p_rival';

    if (!currentCatalog) await loadArmoryData();

    var inv = currentVault.inventory || {};
    var ownedPokes = [];
    if (currentCatalog && currentCatalog.items) {
      currentCatalog.items.forEach(function(item) {
        if (item.wing === 'pokes' && inv[item.id] && (inv[item.id].quantity || 0) > 0) {
          ownedPokes.push({
            item: item,
            charges: inv[item.id].quantity
          });
        }
      });
    }

    var modal = document.createElement('div');
    modal.id = 'poke-rival-modal';
    modal.className = 'modal-backdrop active';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '100010';

    var bodyContent = '';
    if (ownedPokes.length > 0) {
      bodyContent = [
        '<div style="color:#94a3b8; font-size:0.85rem; margin-bottom:1rem;">Select a battle taunt to dispatch at <strong>' + escapeHtml(tName) + '</strong>:</div>',
        '<div style="display:flex; flex-direction:column; gap:0.65rem;">',
        ownedPokes.map(function(op) {
          var it = op.item;
          return [
            '<button type="button" class="btn" style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem 1rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; color:#fff; text-align:left; cursor:pointer;" ',
            '        onclick="window.Armory.pokePlayer(\'' + escapeHtml(tId) + '\', \'' + escapeHtml(it.id) + '\', \'' + escapeHtml(tName) + '\'); document.getElementById(\'poke-rival-modal\').remove();">',
            '  <div style="display:flex; align-items:center; gap:0.75rem;">',
            '    <span style="font-size:1.5rem;">' + (it.icon || '👉') + '</span>',
            '    <div>',
            '      <div style="font-weight:700; font-size:0.92rem;">' + escapeHtml(it.name) + '</div>',
            '      <div style="font-size:0.75rem; color:#94a3b8;">' + escapeHtml(it.description || '') + '</div>',
            '    </div>',
            '  </div>',
            '  <span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-weight:700;">' + op.charges + ' charges</span>',
            '</button>'
          ].join('');
        }).join(''),
        '</div>'
      ].join('');
    } else {
      bodyContent = [
        '<div style="text-align:center; padding:1.5rem 0;">',
        '  <div style="font-size:2.5rem; margin-bottom:0.75rem;">👉</div>',
        '  <h4 style="color:#fff; margin-bottom:0.5rem;">No Poke Charges Remaining</h4>',
        '  <p style="color:#94a3b8; font-size:0.85rem; max-width:320px; margin:0 auto 1.25rem;">Requisition a 5-pack of battle pokes in the Retribution Armory for 50 Glory to taunt your rivals!</p>',
        '  <button type="button" class="btn btn-primary" onclick="document.getElementById(\'poke-rival-modal\').remove(); window.Armory.openArmoryModal(\'pokes\');" style="font-weight:700;">',
        '    🏛️ Requisition Pokes in Armory (50 Glory)',
        '  </button>',
        '</div>'
      ].join('');
    }

    modal.innerHTML = [
      '<div class="modal-card" style="max-width:480px; background:#0f172a; border:1px solid rgba(255,255,255,0.14); border-radius:14px; padding:1.5rem; box-shadow:0 25px 60px rgba(0,0,0,0.85);">',
      '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.75rem;">',
      '    <div style="font-weight:800; font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:0.5rem;">',
      '      <span>👉</span> Poke Rival: ' + escapeHtml(tName),
      '    </div>',
      '    <button type="button" class="modal-close" onclick="document.getElementById(\'poke-rival-modal\').remove()">✕</button>',
      '  </div>',
      bodyContent,
      '</div>'
    ].join('');

    document.body.appendChild(modal);
  }

  function formatHexTimeRemaining(expiresAt) {
    if (!expiresAt) return '24h remaining';
    var diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    var hours = Math.floor(diff / (1000 * 60 * 60));
    var mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return hours + 'h ' + mins + 'm remaining';
  }

  function getActiveHexes() {
    var rawPokes = (currentVault && currentVault.received_pokes) || (currentCatalog && currentCatalog.active_pokes) || [];
    var now = Date.now();
    return rawPokes.filter(function(p) {
      if (!p || !p.expires_at) return false;
      return new Date(p.expires_at).getTime() > now;
    });
  }

  /**
   * Check and Trigger Rival Incursion Sign-in Effect
   */
  async function checkAndTriggerSignInPokeEffect(contextData) {
    var unseen = (currentCatalog && currentCatalog.unseen_pokes) || [];
    if (unseen.length === 0 && currentVault && currentVault.received_pokes) {
      var now = Date.now();
      unseen = currentVault.received_pokes.filter(function(p) {
        return p && !p.seen && new Date(p.expires_at).getTime() > now;
      });
    }

    if (unseen.length === 0) return;

    var activePoke = unseen[0];
    var existing = document.getElementById('armory-incursion-backdrop');
    if (existing) existing.remove();

    var fxClass = 'fx-' + (activePoke.sign_in_effect || 'warp_storm');
    var overlay = document.createElement('div');
    overlay.id = 'armory-incursion-backdrop';
    overlay.className = 'armory-incursion-backdrop ' + fxClass;

    var timerText = formatHexTimeRemaining(activePoke.expires_at);

    overlay.innerHTML = [
      '<div class="armory-incursion-card" style="border-color: ' + (activePoke.css_glow || '#38bdf8') + '; box-shadow: 0 0 45px ' + (activePoke.css_glow || '#38bdf8') + ', 0 25px 60px rgba(0,0,0,0.85);">',
      '  <div class="incursion-header-badge" style="border-color:' + (activePoke.css_glow || '#ef4444') + '; color:' + (activePoke.css_glow || '#f87171') + ';">',
      '    <span>⚠️</span> RIVAL INCURSION DETECTED',
      '  </div>',
      '  <div class="incursion-icon-banner" style="color:' + (activePoke.css_glow || '#38bdf8') + ';">',
      '    ' + (activePoke.icon || '👉'),
      '  </div>',
      '  <h2 class="incursion-title">' + escapeHtml(activePoke.poke_name || 'Rival Poke') + '</h2>',
      '  <div class="incursion-body">',
      '    <strong>' + escapeHtml(activePoke.sender_name || 'A rival commander') + '</strong> targeted your command console!<br>',
      '    <span style="color:#94a3b8; font-style:italic;">"' + escapeHtml(activePoke.toast_message || activePoke.hex_banner_desc || 'You have been challenged.') + '"</span>',
      '  </div>',
      '  <div class="incursion-meta">',
      '    <span>⏳ <strong>Hex Duration:</strong> 24 Hours</span>',
      '    <span>•</span>',
      '    <span style="color:#facc15; font-family:var(--font-mono, monospace); font-weight:700;">' + timerText + '</span>',
      '  </div>',
      '  <div class="incursion-actions">',
      '    <button type="button" class="btn btn-outline" id="incursion-dismiss-btn" style="font-weight:600; padding:0.6rem 1.25rem;">',
      '      Accept Challenge',
      '    </button>',
      '    <button type="button" class="btn btn-primary" id="incursion-avenge-btn" style="font-weight:700; padding:0.6rem 1.4rem; background:' + (activePoke.css_glow || '#38bdf8') + '; border-color:' + (activePoke.css_glow || '#38bdf8') + '; color:#000;">',
      '      ⚔️ Counter-Poke Rival',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);
    setTimeout(function() { overlay.classList.add('active'); }, 20);

    var dismiss = async function() {
      overlay.classList.remove('active');
      setTimeout(function() { overlay.remove(); }, 400);
      try {
        await fetch('/api/armory/poke/acknowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ poke_event_id: activePoke.id })
        });
        activePoke.seen = true;
      } catch (e) {}
    };

    var dismissBtn = document.getElementById('incursion-dismiss-btn');
    if (dismissBtn) dismissBtn.onclick = dismiss;

    var avengeBtn = document.getElementById('incursion-avenge-btn');
    if (avengeBtn) {
      avengeBtn.onclick = async function() {
        await dismiss();
        if (activePoke.sender_id && activePoke.sender_id !== 'unknown') {
          openPokeRivalModal(activePoke.sender_id, activePoke.sender_name);
        } else {
          openPokeRivalModal('p_rival', activePoke.sender_name);
        }
      };
    }
  }

  /**
   * Renders persistent Active Rival Hex banner across Hub / Profile
   */
  function renderActiveRivalHexBanner(targetContainerId) {
    var activeHexes = getActiveHexes();
    var existing = document.getElementById('armory-active-hex-banner');
    if (existing) existing.remove();

    if (activeHexes.length === 0) return;

    var topHex = activeHexes[0];
    var container = document.getElementById(targetContainerId || 'hub-active-hex-container') ||
                    document.getElementById('my-hub-container') ||
                    document.getElementById('hub-content');
    if (!container) return;

    var banner = document.createElement('div');
    banner.id = 'armory-active-hex-banner';
    banner.className = 'armory-active-hex-banner';
    banner.style.borderColor = topHex.css_glow || '#c084fc';
    banner.style.boxShadow = '0 0 16px ' + (topHex.css_glow || 'rgba(192, 132, 252, 0.35)');

    banner.innerHTML = [
      '<div class="hex-banner-left">',
      '  <span class="hex-banner-icon">' + (topHex.icon || '👉') + '</span>',
      '  <div>',
      '    <div class="hex-banner-title">ACTIVE RIVAL HEX: ' + escapeHtml(topHex.poke_name || 'Battle Hex') + '</div>',
      '    <div class="hex-banner-sub">' + escapeHtml(topHex.hex_banner_desc || ('Targeted by rival commander ' + topHex.sender_name)) + '</div>',
      '  </div>',
      '</div>',
      '<div style="display:flex; align-items:center; gap:0.75rem;">',
      '  <div class="hex-banner-timer">⏳ ' + formatHexTimeRemaining(topHex.expires_at) + '</div>',
      '  <button type="button" class="btn btn-outline" onclick="window.Armory.openPokeRivalModal(\'' + escapeHtml(topHex.sender_id || 'p_rival') + '\', \'' + escapeHtml(topHex.sender_name || 'Rival Commander') + '\')" style="font-size:0.78rem; font-weight:700; padding:0.35rem 0.75rem;">',
      '    ⚔️ Avenge',
      '  </button>',
      '</div>'
    ].join('');

    container.prepend(banner);
  }

  function getFrameCssClass(frameId) {
    if (!frameId) return '';
    if (currentCatalog && currentCatalog.items) {
      var it = currentCatalog.items.find(function(i) { return i.id === frameId; });
      if (it && it.payload && it.payload.css_class) return it.payload.css_class;
    }
    return frameId.replace(/_/g, '-');
  }

  var FACTION_FINISH_MAP = {
    'frame_astral_holofoil': 'finish-astral-holofoil',
    'finish_astral_holofoil': 'finish-astral-holofoil',
    'finish_aos_astral_holofoil': 'finish-astral-holofoil',
    'finish_40k_dark_angels': 'finish-caliban-emerald-sheen',
    'finish_40k_necrons': 'finish-dynastic-gauss-sheen',
    'finish_40k_adeptus_astartes': 'finish-macragge-auric-glaze',
    'finish_40k_chaos_space_marines': 'finish-warpfire-prism',
    'finish_40k_orks': 'finish-waaagh-dakka-foil',
    'finish_40k_black_templars': 'finish-crusader-relic-silver',
    'finish_40k_blood_angels': 'finish-baal-ruby-radiance',
    'finish_40k_space_wolves': 'finish-fenrisian-frost-glaze',
    'finish_40k_adeptus_custodes': 'finish-solar-auramite-leaf',
    'finish_40k_adeptus_mechanicus': 'finish-mechanicus-rad-luminescence',
    'finish_40k_tyranids': 'finish-hive-bio-chitin',
    'finish_40k_tau': 'finish-sept-plasma-telemetry',
    'finish_40k_aeldari': 'finish-wraithbone-spirit-veil',
    'finish_40k_death_guard': 'finish-nurgle-plague-patina',
    'finish_40k_adepta_sororitas': 'finish-sororitas-miracle-radiance',
    'finish_40k_astra_militarum': 'finish-cadia-flak-camo-foil',
    'finish_40k_chaos_daemons': 'finish-warp-rift-chroma',
    'finish_40k_chaos_knights': 'finish-dread-warp-patina',
    'finish_40k_deathwatch': 'finish-xenomortis-silver',
    'finish_40k_drukhari': 'finish-commorragh-soul-shard',
    'finish_40k_emperors_children': 'finish-slaanesh-ecstatic-sheen',
    'finish_40k_genestealer_cults': 'finish-gsc-void-mining-holo',
    'finish_40k_grey_knights': 'finish-titan-aegis-sanctification',
    'finish_40k_imperial_agents': 'finish-inquisition-rosette-gilt',
    'finish_40k_imperial_knights': 'finish-knights-chivalric-heraldry',
    'finish_40k_leagues_of_votann': 'finish-votann-plasma-forge',
    'finish_40k_space_marines': 'finish-astartes-honor-foil',
    'finish_40k_thousand_sons': 'finish-rubric-tzaangor-sorcery',
    'finish_40k_world_eaters': 'finish-khorne-blood-slick',
    'finish_aos_stormcast_eternals': 'finish-azyrite-lightning-sheen',
    'finish_aos_blades_of_khorne': 'finish-blood-god-brass-sheen',
    'finish_aos_gloomspite_gitz': 'finish-bad-moon-loontide-sheen',
    'finish_aos_soulblight_gravelords': 'finish-crimson-court-blood-foil',
    'finish_aos_sylvaneth': 'finish-life-bloom-jade-sheen',
    'finish_aos_beasts_of_chaos': 'finish-wild-herdstone-blood-sheen',
    'finish_aos_cities_of_sigmar': 'finish-freeguild-banner-foil',
    'finish_aos_daughters_of_khaine': 'finish-morathi-shadow-blade-foil',
    'finish_aos_disciples_of_tzeentch': 'finish-fateweaver-kaleidoscope',
    'finish_aos_flesh_eater_courts': 'finish-grand-illusion-chivalric-sheen',
    'finish_aos_fyreslayers': 'finish-ur-gold-volcano-ember',
    'finish_aos_hedonites_of_slaanesh': 'finish-excess-opalescent-sheen',
    'finish_aos_idoneth_deepkin': 'finish-ethersea-abyssal-current',
    'finish_aos_kharadron_overlords': 'finish-aether-gold-burnish',
    'finish_aos_lumineth_realm_lords': 'finish-aelementor-zenith-glaze',
    'finish_aos_maggotkin_of_nurgle': 'finish-rotbringer-bile-glaze',
    'finish_aos_nighthaunt': 'finish-spectral-ectoplasm-veil',
    'finish_aos_ogor_mawtribes': 'finish-everwinter-blizzard-frost',
    'finish_aos_orruk_warclans': 'finish-ironjawz-crusher-glaze',
    'finish_aos_ossiarch_bonereapers': 'finish-mortisan-bone-lacquer',
    'finish_aos_seraphon': 'finish-celestial-constellation-foil',
    'finish_aos_skaven': 'finish-warpstone-mutagenic-sheen',
    'finish_aos_slaves_to_darkness': 'finish-varanite-corrupted-chrome',
    'finish_aos_sons_of_behemat': 'finish-colossal-megagargant-crag'
  };

  function getFinishCssClass(finishId) {
    if (!finishId) return '';
    if (FACTION_FINISH_MAP[finishId]) return FACTION_FINISH_MAP[finishId];
    if (finishId === 'frame_astral_holofoil' || finishId.includes('holofoil')) {
      return 'finish-astral-holofoil';
    }
    if (currentCatalog && currentCatalog.items) {
      var it = currentCatalog.items.find(function(i) { return i.id === finishId; });
      if (it && it.payload && it.payload.css_class) return it.payload.css_class;
    }
    return finishId.replace(/_/g, '-');
  }

  function isTeamViewElement(el) {
    if (!el || !el.closest) return false;
    if (el.classList && (el.classList.contains('team-hero-card') || el.classList.contains('team-rank-crest') || el.classList.contains('team-reliquary-container'))) {
      return true;
    }
    return Boolean(el.closest('#team-profile-container, #teams-view, #tab-teams, #team-directory-container'));
  }

  /**
   * Effect Dispatcher: Applies active decorations only to player profile / My Hub hero cards (never Team View)
   */
  function applyEquippedDecorations(system, overrideEquipped, scopeRoot) {
    var rawSys = (typeof system === 'string' && (system === '40k' || system === 'aos'))
      ? system
      : detectActiveGameSystem();
    var sys = String(rawSys).toLowerCase();
    var eq = getEquippedForSystem(overrideEquipped || (currentVault && currentVault.equipped) || {}, sys);

    // Always ensure Team View cards are clean of any personal Armory frame/finish classes
    var teamCards = document.querySelectorAll('#team-profile-container .profile-hero-card, .team-hero-card');
    teamCards.forEach(function(tc) {
      Array.from(tc.classList).forEach(function(c) {
        if (c.startsWith('frame-') || c.startsWith('frame_') || c.startsWith('finish-') || c.startsWith('finish_')) {
          tc.classList.remove(c);
        }
      });
    });

    // Resolve target root(s): if scopeRoot is provided, only decorate within scopeRoot;
    // otherwise only decorate the logged-in user's My Hub hero card (#my-hub-container / #hub-content).
    var roots = [];
    if (scopeRoot) {
      var resolved = typeof scopeRoot === 'string' ? document.querySelector(scopeRoot) : scopeRoot;
      if (resolved) roots.push(resolved);
    } else {
      var hubRoot = document.getElementById('my-hub-container') || document.getElementById('hub-content');
      if (hubRoot) roots.push(hubRoot);
    }

    // 1. Apply Card Frame (Border) & Card Finish
    var frameId = eq.active_card_frame;
    var targetCssClass = frameId ? getFrameCssClass(frameId) : null;
    var finishId = eq.active_card_finish;
    var targetFinishClass = finishId ? getFinishCssClass(finishId) : null;

    roots.forEach(function(root) {
      var heroCards = root.querySelectorAll('.hero-card, #my-hub-hero-card, .profile-hero-card');
      heroCards.forEach(function(card) {
        if (isTeamViewElement(card)) return;
        // Only apply frame/finish to the main competitor hero card (which contains .profile-hero-top), not inner sub-panels
        if (card.classList.contains('profile-hero-card') && !card.querySelector('.profile-hero-top') && card.id !== 'my-hub-hero-card') {
          return;
        }
        Array.from(card.classList).forEach(function(c) {
          if (c.startsWith('frame-') || c.startsWith('frame_')) card.classList.remove(c);
          if (c.startsWith('finish-') || c.startsWith('finish_')) card.classList.remove(c);
        });
        if (targetCssClass) {
          card.classList.add(targetCssClass);
        }
        if (targetFinishClass) {
          card.classList.add(targetFinishClass);
        }
      });

      // 2. Render Equipped Title
      var titleId = eq.active_title;
      var titleBadgeContainers = root.querySelectorAll('.hero-title-badge-slot');
      titleBadgeContainers.forEach(function(el) {
        if (isTeamViewElement(el)) return;
        if (!titleId) {
          el.innerHTML = '';
          el.style.display = 'none';
        } else {
          var tItem = findCatalogItemById(titleId);
          var tText = tItem && tItem.payload ? tItem.payload.title_text : (tItem ? tItem.name : titleId.replace(/^title_/, '').replace(/_/g, ' '));
          var tClass = tItem && tItem.payload ? tItem.payload.css_class : (titleId.includes('warp') ? 'title-badge-warp' : (titleId.includes('forge') ? 'title-badge-forge' : (titleId.includes('strategist') ? 'title-badge-strategist' : 'title-badge-unbroken')));
          el.innerHTML = '<span class="armory-title-chip ' + escapeHtml(tClass) + '"><span class="title-chip-icon">🏷️</span> ' + escapeHtml(tText.toUpperCase()) + '</span>';
          el.style.display = 'inline-flex';
        }
      });

      // 3. Render Equipped Faction Avatar Sigil (Replaces rank crest icon on player/My Hub cards only!)
      var avatarId = eq.active_avatar;
      var rankCrests = root.querySelectorAll('.profile-rank-crest');
      rankCrests.forEach(function(crest) {
        if (isTeamViewElement(crest)) return;
        var slot = crest.querySelector('.hero-avatar-sigil-slot');
        var defIcon = crest.querySelector('.hero-crest-default-icon');

        if (!slot) {
          var origHtml = crest.innerHTML.trim();
          var fallbackIcon = crest.getAttribute('data-default-icon') || origHtml || '🎖️';
          crest.innerHTML = '<span class="hero-crest-default-icon">' + fallbackIcon + '</span><span class="hero-avatar-sigil-slot" style="display:none;"></span>';
          slot = crest.querySelector('.hero-avatar-sigil-slot');
          defIcon = crest.querySelector('.hero-crest-default-icon');
        }

        if (!avatarId) {
          if (slot) {
            slot.innerHTML = '';
            slot.style.display = 'none';
          }
          if (defIcon) {
            defIcon.style.display = 'inline-flex';
          }
          crest.style.borderColor = '';
          crest.style.boxShadow = '';
        } else {
          var svgCode = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(avatarId) : '';
          var aItem = findCatalogItemById(avatarId);
          var aColor = (aItem && aItem.payload && aItem.payload.badge_color) ? aItem.payload.badge_color : '#38bdf8';

          if (defIcon) {
            defIcon.style.display = 'none';
          }
          if (slot) {
            if (svgCode) {
              slot.innerHTML = svgCode;
            } else {
              var aIcon = (aItem && aItem.payload && aItem.payload.avatar_icon) || (aItem && aItem.icon) || '🛡️';
              slot.innerHTML = '<span class="armory-avatar-sigil" style="font-size: 2.2rem; filter: drop-shadow(0 0 10px ' + aColor + ');">' + aIcon + '</span>';
            }
            slot.style.display = 'flex';
          }
          crest.style.borderColor = aColor;
          crest.style.boxShadow = '0 0 20px ' + aColor + '55, inset 0 0 14px ' + aColor + '22';
        }
      });
    });

    // 4. Sync game-system-scoped localStorage active_dice for real-time dice tray integration (only for current user)
    if (!overrideEquipped) {
      if (eq && eq.active_dice) {
        try {
          localStorage.setItem('omnitactica_active_dice_' + sys, eq.active_dice);
          if (sys === '40k') localStorage.setItem('omnitactica_active_dice', eq.active_dice);
        } catch(e) {}
      } else {
        try {
          localStorage.removeItem('omnitactica_active_dice_' + sys);
          if (sys === '40k') localStorage.removeItem('omnitactica_active_dice');
        } catch(e) {}
      }
    }

    // 5. Dispatch Event for Live Tracker Dice Tray
    if (window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('omnitactica:armory-loadout-changed', {
        detail: { game_system: sys, equipped: eq, vault: currentVault }
      }));
    }
  }

  /**
   * Notification Toast Helper
   */
  function showArmoryNotification(msg, type) {
    var toast = document.createElement('div');
    toast.className = 'armory-toast toast-' + (type || 'info');
    toast.innerHTML = msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('active'); }, 10);
    setTimeout(function() {
      toast.classList.remove('active');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3200);
  }

  function getOwnedItemsCount() {
    if (!currentCatalog || !currentCatalog.items) return 0;
    var sys = (currentGameSystem || '40k').toLowerCase();
    return currentCatalog.items.filter(function(item) {
      return (item.game_system === sys || !item.game_system) && !!item.is_owned;
    }).length;
  }

  /**
   * Filter Store by Wing
   */
  function setWingFilter(wingId) {
    if (wingId === 'ledger') {
      openGloryLedgerModal();
      return;
    }
    if (wingId === 'backpack' || wingId === 'vault') {
      currentArmoryMode = 'vault';
      activeVaultTab = 'backpack';
      renderArmoryModalShell();
      return;
    }
    activeWingFilter = wingId;
    if (['all', 'dice_forge', 'profile_forge', 'card_finishes', 'avatars', 'titles', 'pokes'].indexOf(wingId) !== -1) {
      if (currentArmoryMode !== 'store') {
        currentArmoryMode = 'store';
        renderArmoryModalShell();
        return;
      }
    }
    var pills = document.querySelectorAll('.armory-wing-pill');
    pills.forEach(function(p) {
      p.classList.toggle('active', p.getAttribute('data-wing') === wingId);
    });
    renderArmoryGrid();
  }

  /**
   * Update Spendable Balance display in modal header
   */
  function updateArmoryHeaderBalance() {
    var balEl = document.getElementById('armory-spendable-balance-val');
    var spendable = Number(currentGlory.spendable_glory != null ? currentGlory.spendable_glory : (currentGlory.glory_balance || 0));
    if (balEl) balEl.textContent = spendable.toLocaleString();

    var spentEl = document.getElementById('armory-total-spent-val');
    if (spentEl) spentEl.textContent = Number(currentGlory.glory_spent || 0).toLocaleString();

    var subEl = document.getElementById('armory-glory-breakdown-sub');
    if (subEl) {
      var total = Number(currentGlory.total_glory || currentGlory.total_earned || 0);
      if (total > 0) {
        subEl.textContent = '(' + total.toLocaleString() + ' Lifetime: ' + Number(currentGlory.glory_40k || 0).toLocaleString() + ' 40K + ' + Number(currentGlory.glory_aos || 0).toLocaleString() + ' AoS)';
      } else {
        subEl.textContent = '';
      }
    }

    if (spendable > 0) {
      try {
        localStorage.setItem('omnitactica_cached_spendable_glory', String(spendable));
      } catch (e) {}
    }

    // Synchronize the My Hub tab button in real-time
    var hubCounter = document.getElementById('hub-armory-balance-count');
    if (hubCounter) {
      hubCounter.textContent = spendable.toLocaleString();
    }
    var hubBtn = document.querySelector('.hub-subtab-armory-btn');
    if (hubBtn) {
      hubBtn.setAttribute('title', spendable.toLocaleString() + ' Spendable Glory Points Remaining');
    }
  }

  /**
   * Renders the Armory Grid of Products
   */
  function renderArmoryGrid() {
    var container = document.getElementById('armory-products-grid');
    if (!container) return;

    if (currentArmoryMode === 'vault' && activeVaultTab === 'ledger') {
      renderArmoryLedger(container);
      return;
    }

    if (!currentCatalog || !currentCatalog.items) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 2rem;">Loading requisition manifests...</div>';
      return;
    }

    var countSpans = document.querySelectorAll('.backpack-count-span');
    var bCount = getOwnedItemsCount();
    countSpans.forEach(function(s) { s.textContent = bCount; });

    var items = [];
    if (currentArmoryMode === 'vault') {
      items = currentCatalog.items.filter(function(item) {
        return !!item.is_owned;
      });
    } else {
      items = currentCatalog.items.filter(function(item) {
        if (activeWingFilter === 'all') return true;
        return item.wing === activeWingFilter;
      });
    }

    if (items.length === 0) {
      if (currentArmoryMode === 'vault') {
        container.innerHTML = [
          '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 3rem 1.5rem;">',
          '  <div style="font-size: 3.2rem; margin-bottom: 0.75rem;">🎒</div>',
          '  <h3 style="color: #fff; font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem;">Your Armory Backpack is Empty</h3>',
          '  <p style="color: #94a3b8; font-size: 0.88rem; max-width: 440px; margin: 0 auto 1.5rem;">You haven\'t requisitioned any items for ' + (currentGameSystem === 'aos' ? 'Age of Sigmar' : 'Warhammer 40,000') + ' yet. Requisition tactical dice, frames, animated finishes, heraldic sigils, and titles using your Unified Glory!</p>',
          '  <button type="button" class="armory-store-cta-btn" onclick="window.Armory.setArmoryMode(\'store\')" style="font-size: 0.88rem; padding: 0.6rem 1.5rem; margin: 0 auto;">',
          '    <span>🛒</span> Enter Requisition Store Depot ➔',
          '  </button>',
          '</div>'
        ].join('');
        return;
      }
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 2.5rem;">No requisitions available in this wing for ' + (currentGameSystem === 'aos' ? 'Age of Sigmar' : 'Warhammer 40,000') + '.</div>';
      return;
    }

    var rarities = currentCatalog.rarity_config || {};

    var cardsHtml = items.map(function(item) {
      var rMeta = rarities[item.rarity] || { label: item.rarity, color: '#94a3b8', badge_bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };
      var isOwned = !!item.is_owned;
      var isEquipped = !!item.is_equipped;
      var meetsPrereq = item.meets_prerequisite !== false;
      var affordable = (currentGlory.spendable_glory || 0) >= item.cost_glory;

      // Card action button state
      var actionBtnHtml = '';
      if (item.is_consumable) {
        var charges = item.charges_remaining || 0;
        var chargesBadge = isOwned ? '<div class="armory-charges-badge"><span>Stock: ' + charges + ' charges</span></div>' : '';
        
        var pokeAction = '';
        if (isOwned && charges > 0) {
          pokeAction = [
            '<button type="button" class="btn armory-action-btn btn-poke-action" ',
            '        onclick="window.Armory.pokePlayer(\'p_rival\', \'' + item.id + '\', \'Opposing Commander\')">',
            '  <span>👉 Test Poke (Spend 1)</span>',
            '</button>'
          ].join('');
        }

        actionBtnHtml = [
          chargesBadge,
          '<div style="display: flex; gap: 0.5rem; width: 100%; flex-direction: column;">',
          pokeAction,
          '  <button type="button" id="armory-buy-btn-' + item.id + '" class="btn armory-action-btn btn-buy ' + (affordable ? 'affordable' : 'unaffordable') + '" ',
          '          onclick="window.Armory.purchaseItem(\'' + item.id + '\')" ' + (!affordable ? 'disabled' : '') + '>',
          '    <span>' + (isOwned ? '+ Requisition More (5x)' : 'Requisition (5x Pack)') + '</span>',
          '    <span class="armory-btn-cost">💰 ' + item.cost_glory + ' Glory</span>',
          '  </button>',
          '</div>'
        ].join('');
      } else if (isOwned) {
        if (isEquipped) {
          actionBtnHtml = [
            '<button type="button" class="btn armory-action-btn btn-equipped" onclick="window.Armory.toggleEquip(\'' + item.slot + '\', \'' + item.id + '\')">',
            '  <span>✓ Equipped</span>',
            '  <span style="font-size: 0.72rem; opacity: 0.7;">(Click to Unequip)</span>',
            '</button>'
          ].join('');
        } else {
          actionBtnHtml = [
            '<button type="button" class="btn armory-action-btn btn-equip" onclick="window.Armory.toggleEquip(\'' + item.slot + '\', \'' + item.id + '\')">',
            '  <span>⚔️ Equip Item</span>',
            '</button>'
          ].join('');
        }
      } else {
        // Locked by prerequisite
        if (!meetsPrereq) {
          actionBtnHtml = [
            '<button type="button" class="btn armory-action-btn btn-locked" disabled title="' + escapeHtml(item.prerequisite_reason || 'Locked') + '">',
            '  <span>🔒 ' + escapeHtml(item.prerequisite_reason || 'Locked') + '</span>',
            '</button>'
          ].join('');
        } else {
          actionBtnHtml = [
            '<button type="button" id="armory-buy-btn-' + item.id + '" class="btn armory-action-btn btn-buy ' + (affordable ? 'affordable' : 'unaffordable') + '" ',
            '        onclick="window.Armory.purchaseItem(\'' + item.id + '\')" ' + (!affordable ? 'disabled' : '') + '>',
            '  <span>Requisition</span>',
            '  <span class="armory-btn-cost">💰 ' + item.cost_glory + ' Glory</span>',
            '</button>'
          ].join('');
        }
      }

      // Visual preview badge
      var previewGraphic = '';
      if (item.wing === 'dice_forge') {
        var dieBg = item.payload && item.payload.die_bg ? item.payload.die_bg : '#1e293b';
        var pipCol = item.payload && item.payload.pip_color ? item.payload.pip_color : '#fff';
        var sixSvgId = item.payload && item.payload.six_face_svg_id ? item.payload.six_face_svg_id : null;
        var sixLabel = item.payload && item.payload.six_face_label ? item.payload.six_face_label : null;
        if (sixSvgId) {
          var sigilSvg = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(sixSvgId) : '';
          previewGraphic = [
            '<div class="armory-dice-preview-wrapper">',
            '  <div class="armory-dice-preview-tile faction-dice-tile" style="background: ' + dieBg + ';">',
            '    <div class="armory-preview-die-face faction-face-preview">',
            '      <div class="die-face-six-sigil">' + sigilSvg + '</div>',
            '    </div>',
            '  </div>',
            '  <span class="die-six-badge">★ Face 6: ' + escapeHtml(sixLabel || 'Faction Sigil') + '</span>',
            '</div>'
          ].join('');
        } else {
          previewGraphic = [
            '<div class="armory-dice-preview-tile" style="background: ' + dieBg + ';">',
            '  <div class="armory-preview-die-face">',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '    <span class="pip" style="background:' + pipCol + ';"></span>',
            '  </div>',
            '</div>'
          ].join('');
        }
      } else if (item.wing === 'profile_forge') {
        var glow = item.payload && item.payload.border_glow ? item.payload.border_glow : 'none';
        var cls = item.payload && item.payload.css_class ? item.payload.css_class : '';
        previewGraphic = [
          '<div class="armory-frame-preview-tile ' + cls + '" style="box-shadow: ' + glow + ';">',
          '  <div class="preview-mini-avatar">👤</div>',
          '  <div class="preview-mini-title">PROFILE AURA</div>',
          '</div>'
        ].join('');
      } else if (item.wing === 'card_finishes') {
        var finishCls = item.payload && item.payload.css_class ? item.payload.css_class : (item.id === 'frame_astral_holofoil' ? 'finish-astral-holofoil' : item.id.replace(/_/g, '-'));
        var finishFaction = item.payload && item.payload.faction ? item.payload.faction : (item.id.includes('astral') ? 'Universal' : item.name);
        previewGraphic = [
          '<div class="armory-finish-preview-tile ' + finishCls + '">',
          '  <div class="finish-preview-inner">',
          '    <div class="preview-mini-avatar">✨</div>',
          '    <div class="preview-mini-title">' + escapeHtml(finishFaction.toUpperCase()) + '</div>',
          '    <div class="preview-mini-sub">HOLO FINISH</div>',
          '  </div>',
          '</div>'
        ].join('');
      } else if (item.wing === 'avatars') {
        var bCol = item.payload && item.payload.badge_color ? item.payload.badge_color : '#38bdf8';
        var fName = item.payload && item.payload.faction ? item.payload.faction : item.name;
        var svgGraphic = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(item.id) : '';
        previewGraphic = [
          '<div class="armory-avatar-preview-tile" style="border-color: ' + bCol + '; box-shadow: 0 0 16px ' + bCol + '33;">',
          '  <div class="avatar-preview-graphic">' + (svgGraphic || ('<span style="font-size:2.2rem;">' + (item.icon || '🛡️') + '</span>')) + '</div>',
          '  <div class="avatar-preview-faction" style="color: ' + bCol + ';">' + escapeHtml(fName) + '</div>',
          '</div>'
        ].join('');
      } else if (item.wing === 'titles') {
        var tCls = item.payload && item.payload.css_class ? item.payload.css_class : '';
        previewGraphic = [
          '<div class="armory-title-preview-tile">',
          '  <span class="armory-title-chip ' + tCls + '">🏷️ ' + escapeHtml((item.payload && item.payload.title_text) || item.name) + '</span>',
          '</div>'
        ].join('');
      } else if (item.wing === 'pokes') {
        var pGlow = item.payload && item.payload.css_glow ? item.payload.css_glow : '#38bdf8';
        var pVerb = item.payload && item.payload.verb ? item.payload.verb : 'Poke';
        previewGraphic = [
          '<div class="armory-poke-preview-tile" style="border-color: ' + pGlow + '; box-shadow: 0 0 14px ' + pGlow + '33;">',
          '  <span class="poke-preview-icon">' + (item.icon || '👉') + '</span>',
          '  <span class="poke-preview-verb" style="color: ' + pGlow + ';">' + escapeHtml(pVerb) + '</span>',
          '</div>'
        ].join('');
      } else {
        previewGraphic = '<div class="armory-generic-preview-tile"><span style="font-size: 2.2rem;">' + (item.icon || '📦') + '</span></div>';
      }

      return [
        '<div id="armory-card-' + item.id + '" class="armory-product-card rarity-' + escapeHtml(item.rarity) + (isEquipped ? ' is-equipped' : '') + '" data-item-id="' + item.id + '">',
        '  <div class="armory-card-header">',
        '    <span class="armory-rarity-tag" style="color:' + rMeta.color + '; background:' + rMeta.badge_bg + '; border: 1px solid ' + rMeta.border + ';">',
        '      ' + escapeHtml(rMeta.label),
        '    </span>',
        isEquipped ? '    <span class="armory-equipped-indicator">ACTIVE LOADOUT</span>' : (isOwned ? '    <span class="armory-owned-indicator">OWNED</span>' : ''),
        '  </div>',
        '  <div class="armory-card-visual">',
        previewGraphic,
        '  </div>',
        '  <div class="armory-card-body">',
        '    <h4 class="armory-product-title">' + escapeHtml(item.name) + '</h4>',
        '    <p class="armory-product-desc">' + escapeHtml(item.description) + '</p>',
        '  </div>',
        '  <div class="armory-card-footer">',
        actionBtnHtml,
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');

    var backpackHeaderHtml = '';
    var storeBannerHtml = '';
    if (currentArmoryMode === 'vault') {
      var eq = getEquippedForSystem(currentVault.equipped, currentGameSystem);
      var activeDiceItem = currentCatalog.items.find(function(i) {
        return (eq && i.id === eq.active_dice) || (i.slot === 'active_dice' && i.is_equipped && (i.game_system === currentGameSystem || !i.game_system));
      });
      var activeFrameItem = currentCatalog.items.find(function(i) {
        return (eq && i.id === eq.active_card_frame) || (i.slot === 'active_card_frame' && i.is_equipped && (i.game_system === currentGameSystem || !i.game_system));
      });
      var activeFinishItem = currentCatalog.items.find(function(i) {
        return (eq && i.id === eq.active_card_finish) || (i.slot === 'active_card_finish' && i.is_equipped && (i.game_system === currentGameSystem || !i.game_system));
      });
      var activeAvatarItem = currentCatalog.items.find(function(i) {
        return (eq && i.id === eq.active_avatar) || (i.slot === 'active_avatar' && i.is_equipped && (i.game_system === currentGameSystem || !i.game_system));
      });
      var activeTitleItem = currentCatalog.items.find(function(i) {
        return (eq && i.id === eq.active_title) || (i.slot === 'active_title' && i.is_equipped && (i.game_system === currentGameSystem || !i.game_system));
      });

      backpackHeaderHtml = [
        '<div class="armory-backpack-summary">',
        '  <div class="backpack-summary-top">',
        '    <div class="backpack-summary-title">',
        '      <span class="backpack-summary-icon" style="font-size: 1.15rem;">🎒</span> <span class="subtab-desktop-text">My Purchased Backpack (' + items.length + ' Items Owned)</span><span class="subtab-mobile-text">My Backpack (' + items.length + ' Owned)</span>',
        '    </div>',
        '    <div class="badge backpack-loadout-badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); font-weight: 700; font-size: 0.72rem; padding: 0.18rem 0.5rem; white-space: nowrap;">',
        '      ' + (currentGameSystem === 'aos' ? '⚡ AoS Loadout' : '⚔️ 40K Loadout'),
        '    </div>',
        '  </div>',
        '  <div class="backpack-loadout-grid">',
        '    <div class="backpack-slot-chip ' + (activeDiceItem ? 'is-active' : '') + '">',
        '      <span class="slot-chip-label">🎲 Dice:</span> <strong>' + (activeDiceItem ? escapeHtml(activeDiceItem.name) : '<span style="color:#64748b;">Standard</span>') + '</strong>',
        '    </div>',
        '    <div class="backpack-slot-chip ' + (activeFrameItem ? 'is-active' : '') + '">',
        '      <span class="slot-chip-label">✨ Border:</span> <strong>' + (activeFrameItem ? escapeHtml(activeFrameItem.name) : '<span style="color:#64748b;">Standard</span>') + '</strong>',
        '    </div>',
        '    <div class="backpack-slot-chip ' + (activeFinishItem ? 'is-active' : '') + '">',
        '      <span class="slot-chip-label">🌈 Finish:</span> <strong>' + (activeFinishItem ? escapeHtml(activeFinishItem.name) : '<span style="color:#64748b;">None</span>') + '</strong>',
        '    </div>',
        '    <div class="backpack-slot-chip ' + (activeAvatarItem ? 'is-active' : '') + '">',
        '      <span class="slot-chip-label">🛡️ Sigil:</span> <strong>' + (activeAvatarItem ? escapeHtml(activeAvatarItem.name) : '<span style="color:#64748b;">Default</span>') + '</strong>',
        '    </div>',
        '    <div class="backpack-slot-chip ' + (activeTitleItem ? 'is-active' : '') + '">',
        '      <span class="slot-chip-label">🏷️ Title:</span> <strong>' + (activeTitleItem ? escapeHtml(activeTitleItem.name) : '<span style="color:#64748b;">None</span>') + '</strong>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    container.innerHTML = backpackHeaderHtml + cardsHtml;
  }

  /**
   * Renders the modal card frame based on active view mode ('vault' vs 'store')
   */
  function renderArmoryModalShell() {
    var modal = document.getElementById('retribution-armory-modal');
    if (!modal) return;

    var headerHtml = '';
    var subnavHtml = '';
    var footerHtml = '';
    var spendableVal = Number((currentGlory.spendable_glory != null ? currentGlory.spendable_glory : ((currentGlory.total_glory || 0) - (currentGlory.glory_spent || 0))) || 0).toLocaleString();

    if (currentArmoryMode === 'vault') {
      headerHtml = [
        '<div class="armory-modal-header">',
        '  <div class="armory-header-branding">',
        '    <div class="armory-header-icon">🏛️</div>',
        '    <div>',
        '      <div class="armory-header-kicker">COMMAND VAULT &amp; PERSONAL REQUISITIONS</div>',
        '      <h2 class="armory-header-title">Retribution Armory</h2>',
        '    </div>',
        '  </div>',
        '  <div class="armory-system-switcher">',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === '40k' ? 'active' : '') + '" data-sys="40k" onclick="window.Armory.switchGameSystem(\'40k\')">⚔️ 40K<span class="subtab-desktop-text"> Armory</span></button>',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === 'aos' ? 'active' : '') + '" data-sys="aos" onclick="window.Armory.switchGameSystem(\'aos\')">⚡ AoS<span class="subtab-desktop-text"> Armory</span></button>',
        '  </div>',
        '  <button type="button" class="armory-wallet-hud armory-wallet-balance-btn" onclick="window.Armory.openGloryLedgerModal()" style="cursor: pointer;" title="Click to view Glory Points Audit &amp; Balance Reconciliation">',
        '    <span class="armory-wallet-balance-pill">',
        '      <span class="armory-wallet-coin">🪙</span>',
        '      <span class="armory-wallet-val" id="armory-spendable-balance-val">' + spendableVal + '</span>',
        '      <span class="armory-wallet-lbl">Glory</span>',
        '      <span class="armory-wallet-audit-badge" title="Audit Verified">📜</span>',
        '    </span>',
        '  </button>',
        '  <button type="button" class="armory-store-cta-btn" onclick="window.Armory.setArmoryMode(\'store\')" title="Enter Retribution Store">',
        '    <span>🛒</span> <span class="subtab-desktop-text">Retribution Store ➔</span><span class="subtab-mobile-text">Store ➔</span>',
        '  </button>',
        '  <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
        '</div>'
      ].join('\n');

      subnavHtml = '';
      footerHtml = '';
    } else {
      headerHtml = [
        '<div class="armory-modal-header">',
        '  <button type="button" class="armory-back-vault-btn" onclick="window.Armory.setArmoryMode(\'vault\')">',
        '    <span class="subtab-desktop-text">← Back to Armory</span><span class="subtab-mobile-text">← Armory</span>',
        '  </button>',
        '  <div class="armory-header-branding">',
        '    <div class="armory-header-icon">🛒</div>',
        '    <div>',
        '      <div class="armory-header-kicker">OMNITACTICA QUARTERMASTER CATALOG</div>',
        '      <h2 class="armory-header-title">Retribution Store</h2>',
        '    </div>',
        '  </div>',
        '  <div class="armory-system-switcher">',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === '40k' ? 'active' : '') + '" data-sys="40k" onclick="window.Armory.switchGameSystem(\'40k\')">⚔️ 40K<span class="subtab-desktop-text"> Armory</span></button>',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === 'aos' ? 'active' : '') + '" data-sys="aos" onclick="window.Armory.switchGameSystem(\'aos\')">⚡ AoS<span class="subtab-desktop-text"> Armory</span></button>',
        '  </div>',
        '  <button type="button" class="armory-wallet-hud armory-wallet-balance-btn" onclick="window.Armory.openGloryLedgerModal()" style="cursor: pointer;" title="Click to view Glory Points Audit &amp; Balance Reconciliation">',
        '    <span class="armory-wallet-balance-pill">',
        '      <span class="armory-wallet-coin">🪙</span>',
        '      <span class="armory-wallet-val" id="armory-spendable-balance-val">' + spendableVal + '</span>',
        '      <span class="armory-wallet-lbl">Glory</span>',
        '      <span class="armory-wallet-audit-badge" title="Audit Verified">📜</span>',
        '    </span>',
        '  </button>',
        '  <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
        '</div>'
      ].join('\n');

      subnavHtml = [
        '<div class="armory-wings-bar">',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'all' ? 'active' : '') + '" data-wing="all" onclick="window.Armory.setWingFilter(\'all\')">',
        '    <span>🌐</span> <span class="wing-pill-desktop">All Wings</span><span class="wing-pill-mobile">All</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'dice_forge' ? 'active' : '') + '" data-wing="dice_forge" onclick="window.Armory.setWingFilter(\'dice_forge\')">',
        '    <span>🎲</span> <span class="wing-pill-desktop">Dice Forge</span><span class="wing-pill-mobile">Dice</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'profile_forge' ? 'active' : '') + '" data-wing="profile_forge" onclick="window.Armory.setWingFilter(\'profile_forge\')">',
        '    <span>🖼️</span> <span class="wing-pill-desktop">Card Borders</span><span class="wing-pill-mobile">Borders</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'card_finishes' ? 'active' : '') + '" data-wing="card_finishes" onclick="window.Armory.setWingFilter(\'card_finishes\')">',
        '    <span>✨</span> <span class="wing-pill-desktop">Card Finishes</span><span class="wing-pill-mobile">Finishes</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'avatars' ? 'active' : '') + '" data-wing="avatars" onclick="window.Armory.setWingFilter(\'avatars\')">',
        '    <span>🛡️</span> <span class="wing-pill-desktop">Faction Sigils</span><span class="wing-pill-mobile">Sigils</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'titles' ? 'active' : '') + '" data-wing="titles" onclick="window.Armory.setWingFilter(\'titles\')">',
        '    <span>🏷️</span> <span class="wing-pill-desktop">Titles</span><span class="wing-pill-mobile">Titles</span>',
        '  </button>',
        '  <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'pokes' ? 'active' : '') + '" data-wing="pokes" onclick="window.Armory.setWingFilter(\'pokes\')">',
        '    <span>👉</span> <span class="wing-pill-desktop">Player Pokes</span><span class="wing-pill-mobile">Pokes</span>',
        '  </button>',
        '</div>'
      ].join('\n');

      footerHtml = '';
    }

    modal.innerHTML = [
      '<div class="modal-card armory-modal-card">',
      headerHtml,
      subnavHtml,
      '  <div class="armory-modal-body">',
      '    <div id="armory-products-grid" class="armory-grid"></div>',
      '  </div>',
      '</div>'
    ].join('\n');

    updateArmoryHeaderBalance();
    renderArmoryGrid();
  }

  /**
   * Sets mode between 'vault' (Home) and 'store' (Depot)
   */
  function setArmoryMode(mode, subOption) {
    currentArmoryMode = (mode === 'store') ? 'store' : 'vault';
    if (subOption) {
      if (currentArmoryMode === 'vault') {
        activeVaultTab = (subOption === 'ledger') ? 'ledger' : 'backpack';
      } else {
        activeWingFilter = subOption;
      }
    }
    renderArmoryModalShell();
  }

  /**
   * Sets subtab on Home Vault view ('backpack' or 'ledger')
   */
  function setVaultTab(tab) {
    activeVaultTab = (tab === 'ledger') ? 'ledger' : 'backpack';
    currentArmoryMode = 'vault';
    renderArmoryModalShell();
  }

  function openStore(wing, system) {
    currentGameSystem = (system === '40k' || system === 'aos') ? system : detectActiveGameSystem();
    if (wing) activeWingFilter = wing;
    currentArmoryMode = 'store';
    openArmoryModal('store', currentGameSystem);
  }

  function openVault(tab, system) {
    currentGameSystem = (system === '40k' || system === 'aos') ? system : detectActiveGameSystem();
    if (tab) activeVaultTab = tab;
    currentArmoryMode = 'vault';
    openArmoryModal(tab || 'backpack', currentGameSystem);
  }

  /**
   * Builds the themed Quartermaster loading screen HTML for the Retribution Armory modal
   */
  function buildArmoryLoadingHtml(statusText) {
    var msg = statusText || 'Synchronizing Command Vault, Equipped Relics & Glory Balance...';
    return [
      '<div class="armory-loading-screen" style="grid-column: 1 / -1; width: 100%; max-width: 100%; box-sizing: border-box; margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">',
      '  <div class="armory-loading-emblem-wrap">',
      '    <div class="armory-loading-orbital-ring"></div>',
      '    <div class="armory-loading-orbital-ring armory-loading-orbital-inner"></div>',
      '    <div class="armory-loading-crest-icon">🏛️</div>',
      '  </div>',
      '  <div class="armory-loading-kicker" style="font-size: 0.72rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #fbbf24; margin-top: 1.15rem; width: 100%; text-align: center;">QUARTERMASTER VAULT DISPATCH</div>',
      '  <h3 class="armory-loading-title" style="margin: 0.3rem auto 0.35rem; font-size: 1.28rem; font-weight: 800; color: #ffffff; width: 100%; text-align: center;">Opening Retribution Armory...</h3>',
      '  <div class="armory-loading-subtitle" style="font-size: 0.84rem; color: #94a3b8; max-width: 440px; width: 100%; margin: 0 auto 1.1rem; text-align: center; box-sizing: border-box; padding: 0 0.25rem;">' + escapeHtml(msg) + '</div>',
      '  <div class="armory-loading-progress-track">',
      '    <div class="armory-loading-progress-bar"></div>',
      '  </div>',
      '  <div class="armory-loading-skeleton-grid">',
      '    <div class="armory-loading-skeleton-card"><div class="armory-skel-icon"></div><div class="armory-skel-line armory-skel-w70"></div><div class="armory-skel-line armory-skel-w45"></div></div>',
      '    <div class="armory-loading-skeleton-card"><div class="armory-skel-icon"></div><div class="armory-skel-line armory-skel-w70"></div><div class="armory-skel-line armory-skel-w45"></div></div>',
      '    <div class="armory-loading-skeleton-card"><div class="armory-skel-icon"></div><div class="armory-skel-line armory-skel-w70"></div><div class="armory-skel-line armory-skel-w45"></div></div>',
      '    <div class="armory-loading-skeleton-card"><div class="armory-skel-icon"></div><div class="armory-skel-line armory-skel-w70"></div><div class="armory-skel-line armory-skel-w45"></div></div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /**
   * Opens the full Retribution Armory Modal
   */
  async function openArmoryModal(initialWing, system) {
    currentGameSystem = (system === '40k' || system === 'aos') ? system : detectActiveGameSystem();
    hydrateVaultFromGlobalSession();

    if (initialWing === 'store') {
      currentArmoryMode = 'store';
      activeWingFilter = 'all';
    } else if (['dice_forge', 'profile_forge', 'card_finishes', 'avatars', 'titles', 'pokes'].indexOf(initialWing) !== -1) {
      currentArmoryMode = 'store';
      activeWingFilter = initialWing;
    } else if (initialWing === 'ledger') {
      currentArmoryMode = 'vault';
      activeVaultTab = 'ledger';
    } else {
      currentArmoryMode = 'vault';
      activeVaultTab = 'backpack';
    }

    var existing = document.getElementById('retribution-armory-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'retribution-armory-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100005';
    document.body.appendChild(modal);

    if (!catalogBySystem[currentGameSystem]) {
      try {
        var rawCachedCat = localStorage.getItem('omnitactica_armory_catalog_cache_' + currentGameSystem);
        if (rawCachedCat) {
          var parsedCat = JSON.parse(rawCachedCat);
          if (parsedCat && Array.isArray(parsedCat.items)) {
            catalogBySystem[currentGameSystem] = parsedCat;
            if (!currentCatalog) currentCatalog = parsedCat;
          }
        }
      } catch (e) {}
    }

    // Fast path: if catalog for this system is already loaded in memory or localStorage, render the full interactive shell in 0ms!
    if (catalogBySystem[currentGameSystem] && Array.isArray(catalogBySystem[currentGameSystem].items)) {
      currentCatalog = catalogBySystem[currentGameSystem];
      renderArmoryModalShell();
      if (Date.now() - (lastCatalogLoadedAt[currentGameSystem] || 0) > 15000) {
        loadArmoryData(currentGameSystem).then(function() {
          if (document.getElementById('retribution-armory-modal')) {
            updateArmoryHeaderBalance();
            renderArmoryGrid();
          }
        });
      }
      return;
    }

    // Cold path: render the modal frame & Quartermaster loading screen while awaiting the first catalog fetch
    var isStore = (currentArmoryMode === 'store');
    modal.innerHTML = [
      '<div class="modal-card armory-modal-card">',
      '  <div class="armory-modal-header">',
      '    <div class="armory-header-branding">',
      '      <div class="armory-header-icon">' + (isStore ? '🛒' : '🏛️') + '</div>',
      '      <div>',
      '        <div class="armory-header-kicker">' + (isStore ? 'OMNITACTICA QUARTERMASTER CATALOG' : 'COMMAND VAULT &amp; PERSONAL REQUISITIONS') + '</div>',
      '        <h2 class="armory-header-title">' + (isStore ? 'Retribution Store' : 'Retribution Armory') + '</h2>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
      '  </div>',
      '  <div class="armory-modal-body">',
      '    <div id="armory-products-grid" class="armory-grid">',
      buildArmoryLoadingHtml(isStore ? 'Loading Quartermaster Catalog, Relics & Glory Pricing...' : 'Synchronizing Command Vault, Equipped Relics & Glory Balance...'),
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    var loadPromise = loadArmoryData(currentGameSystem);
    await Promise.race([
      loadPromise,
      new Promise(function(resolve) { setTimeout(resolve, 1500); })
    ]);
    if (document.getElementById('retribution-armory-modal')) {
      renderArmoryModalShell();
    }
    loadPromise.then(function() {
      if (document.getElementById('retribution-armory-modal')) {
        renderArmoryModalShell();
      }
    });
  }

  var currentLedgerData = null;
  var currentLedgerFilter = 'all'; // 'all', 'credit', 'debit'
  var currentLedgerSearch = '';

  /**
   * Sanitizes internal technical audit fields (TX IDs, balance steps, SHA-256 hashes, raw snake_case keys)
   * into clean, human-friendly labels for players.
   */
  var WING_LABELS = {
    'dice_forge': 'Dice Forge',
    'profile_forge': 'Profile Forge',
    'card_finishes': 'Card Finishes',
    'avatars': 'Faction Avatars',
    'titles': 'Titles & Honors',
    'pokes': 'Rival Hexes & Pokes'
  };

  function cleanLedgerRowMeta(rawCategory, rawDetail) {
    var cat = String(rawCategory || '').trim();
    var det = String(rawDetail || '').trim();

    if (WING_LABELS[cat.toLowerCase()]) {
      cat = WING_LABELS[cat.toLowerCase()];
    }

    if (cat.indexOf('genesis_pioneer_grant') !== -1 || cat.indexOf('GRANTED') !== -1) {
      cat = 'Official Account Grant';
      if (!det || det.indexOf('TX:') !== -1 || det.indexOf('SHA-256:') !== -1) {
        det = 'Early Adopter & Armory Unlock Allocation';
      }
    } else if (cat.indexOf('topup_purchase') !== -1 || cat.indexOf('PURCHASED') !== -1) {
      cat = 'Glory Store Top-Up';
      if (!det || det.indexOf('TX:') !== -1 || det.indexOf('SHA-256:') !== -1) {
        det = 'Purchased Glory Honor Credit';
      }
    } else if (cat.indexOf('REFUND') !== -1) {
      cat = 'Official Refund';
    } else if (cat.indexOf('TX:') !== -1 || cat.indexOf('SHA-256:') !== -1) {
      cat = 'Armory Requisition';
    }

    if (det.indexOf('TX:') !== -1 || det.indexOf('SHA-256:') !== -1 || det.indexOf('Balance:') !== -1) {
      det = det
        .replace(/TX:\s*[A-Za-z0-9_-]+\s*•?\s*/g, '')
        .replace(/Balance:\s*[\d,]+\s*→\s*[\d,]+\s*•?\s*/g, '')
        .replace(/SHA-256:\s*[A-Za-z0-9….]+\s*/g, '')
        .replace(/^[•\s]+|[•\s]+$/g, '')
        .trim();
      if (!det) {
        det = (cat === 'Official Account Grant') ? 'Early Adopter & Armory Unlock Allocation' : 'Verified Quartermaster Record';
      }
    }

    return {
      category: cat || 'Glory Honor',
      detail: det
    };
  }

  function detectLocalSavedRoster() {
    if (window.hasSavedRosterInVault) return true;
    if (window.hubSavedLists && Array.isArray(window.hubSavedLists) && window.hubSavedLists.length > 0) return true;
    var hub = window.myHubData || window.currentHubData;
    if (hub && hub.seasonal) {
      var s26 = hub.seasonal[hub.active_season || '2026'] || hub.seasonal['2026'] || hub.seasonal;
      if (s26 && Array.isArray(s26.badges)) {
        var found = s26.badges.some(function(b) {
          return b && b.unlocked && String(b.id || '').indexOf('roster_in_vault') !== -1;
        });
        if (found) return true;
      }
    }
    return false;
  }

  /**
   * Fetch itemized Glory transaction ledger
   */
  async function fetchArmoryLedger() {
    var hasRoster = detectLocalSavedRoster();
    if (!hasRoster && typeof window.readSameOriginNewRecruitIdbRows === 'function') {
      try {
        var idbRows = await Promise.race([
          window.readSameOriginNewRecruitIdbRows(),
          new Promise(function(resolve) { setTimeout(function() { resolve([]); }, 120); })
        ]);
        if (Array.isArray(idbRows) && idbRows.length > 0) {
          window.hasSavedRosterInVault = true;
          hasRoster = true;
          if (typeof window.reconcileHubRosterVaultBadge === 'function') {
            window.reconcileHubRosterVaultBadge(idbRows);
          }
        }
      } catch (e) {}
    }
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      var url = '/api/armory/transactions' + (hasRoster ? '?has_roster=1' : '');
      var res = await fetch(url, { headers: headers, credentials: 'include' });
      if (res.ok) {
        var data = await res.json();
        if (data && data.summary) {
          currentLedgerData = data;
          return data;
        }
      }
    } catch (e) {
      console.warn('Could not fetch remote armory transactions:', e);
    }
    currentLedgerData = buildClientFallbackLedger();
    return currentLedgerData;
  }

  /**
   * Fallback client ledger reconstruction
   */
  function buildClientFallbackLedger() {
    var earnedBucket = Number(currentGlory.earned_glory_total || currentGlory.total_glory || currentGlory.total_earned || 8890);
    var purchasedBucket = Number(currentGlory.purchased_glory_total || 0);
    var grantedBucket = Number(currentGlory.granted_glory_total || 0);
    var totalSpent = Number(currentGlory.glory_spent || 0);
    var spendable = Number(currentGlory.spendable_glory != null ? currentGlory.spendable_glory : Math.max(0, earnedBucket - totalSpent));
    var gAos = Number(currentGlory.glory_aos || 110);
    var g40k = Number(currentGlory.glory_40k || Math.max(8780, earnedBucket - gAos));
    if (earnedBucket > (g40k + gAos)) {
      g40k = Math.max(g40k, earnedBucket - gAos);
    }

    var debits = [];
    var debitsSum = 0;
    var inv = (currentVault && currentVault.inventory) ? currentVault.inventory : {};
    Object.keys(inv).forEach(function(itemId) {
      var itemMeta = null;
      if (currentCatalog && currentCatalog.items) {
        itemMeta = currentCatalog.items.find(function(it) { return it.id === itemId; });
      }
      var cost = Number(itemMeta ? (itemMeta.cost_glory || itemMeta.cost || 0) : 0);
      debitsSum += cost;
      debits.push({
        id: 'inv_' + itemId,
        type: 'debit',
        item_id: itemId,
        name: itemMeta ? itemMeta.name : itemId,
        wing: itemMeta ? itemMeta.wing : 'Armory Requisition',
        cost: cost,
        date: ''
      });
    });

    if (debitsSum > totalSpent) {
      totalSpent = debitsSum;
    }
    if ((earnedBucket + purchasedBucket + grantedBucket - totalSpent) !== spendable) {
      grantedBucket = Math.max(0, (totalSpent + spendable) - (earnedBucket + purchasedBucket));
    }
    var totalCredits = earnedBucket + purchasedBucket + grantedBucket;

    var credits = [];
    if (grantedBucket > 0) {
      credits.push({
        id: 'pioneer_grant_reconcile',
        type: 'credit',
        category: 'Official Account Grant',
        name: '💎 Founder & Pioneer Armory Requisition Grant',
        detail: 'Early Adopter & Armory Unlock Allocation',
        amount: grantedBucket,
        date: ''
      });
    }
    if (window.myHubData && window.myHubData.championships && Array.isArray(window.myHubData.championships.items)) {
      window.myHubData.championships.items.forEach(function(c) {
        credits.push({
          id: 'champ_' + (c.event_id || c.name),
          type: 'credit',
          category: 'Tournament Silverware',
          name: '🏆 ' + (c.event_name || c.name || 'Tournament Championship'),
          detail: (c.tier_title || 'Championship') + (c.record ? ' • Record: ' + c.record : ''),
          amount: Number(c.glory_bonus || 500),
          date: c.event_date || ''
        });
      });
    }
    var hubRef = window.myHubData || window.currentHubData;
    var sObj = hubRef && hubRef.seasonal && (hubRef.seasonal[hubRef.active_season || '2026'] || hubRef.seasonal['2026'] || hubRef.seasonal);
    if (sObj && Array.isArray(sObj.badges)) {
      sObj.badges.forEach(function(sb) {
        var pts = Number(sb.glory_points || sb.glory || 0);
        if (sb.unlocked && pts > 0) {
          credits.push({
            id: 'seasonal_' + sb.id,
            type: 'credit',
            category: 'Season 2026 Trophy',
            name: (sb.icon || '🏆') + ' ' + (sb.name || 'Season 2026 Honor'),
            detail: (sb.tier_name || ('Season 2026 • ' + (sb.rarity_label || sb.rarity || 'Honor'))) + ' • ' + (sb.provenance || sb.description || ''),
            amount: pts,
            date: sb.unlocked_at || '2026'
          });
        }
      });
    }
    if (detectLocalSavedRoster() && !credits.some(function(c) { return String(c.id || '').indexOf('roster_in_vault') !== -1 || String(c.name || '').indexOf('Roster In the Vault') !== -1; })) {
      credits.push({
        id: 'seasonal_s26_40k_roster_in_vault',
        type: 'credit',
        category: 'Season 2026 Trophy',
        name: "📜 Roster In the Vault '26",
        detail: 'Season 2026 • Common • Saved battle roster in NewRecruit Studio',
        amount: 25,
        date: '2026'
      });
    }
    if (window.myHubData && Array.isArray(window.myHubData.badges)) {
      window.myHubData.badges.forEach(function(b) {
        var pts = Number(b.glory_points || b.glory || 0);
        if (b.unlocked && pts > 0) {
          credits.push({
            id: 'badge_' + b.id,
            type: 'credit',
            category: 'Battlefield Honor',
            name: '🎖️ ' + (b.name || 'Badge Honor'),
            detail: (b.tier_name || 'Honor') + ' • ' + (b.provenance || b.description || ''),
            amount: pts,
            date: b.unlocked_at || ''
          });
        }
      });
    }

    if (credits.length === 0) {
      credits = [
        { id: 'c1', type: 'credit', category: 'Tournament Silverware', name: '🏆 Flawless 5-0 / 3-0 Tournament Championships (x13)', detail: 'GT & RTT Undefeated 1st Place Finishes (500 Glory per Trophy)', amount: 6500, date: '' },
        { id: 'c2', type: 'credit', category: 'Battlefield Honor', name: '🎖️ High Elo Grandmaster Distinction', detail: 'Reached 2,100+ Elo in Global Leaderboard', amount: 1150, date: '' },
        { id: 'c3', type: 'credit', category: 'Cross-Game System', name: '⚡ Age of Sigmar Competitive Honor', detail: 'Match play & verified tournament performance in AoS', amount: gAos, date: '' }
      ];
    } else if (gAos > 0 && !credits.some(function(c) { return c.id === 'cross_sys_aos'; })) {
      credits.push({
        id: 'cross_sys_aos',
        type: 'credit',
        category: 'Cross-Game System',
        name: '⚡ Age of Sigmar Competitive Honor',
        detail: 'Match play & verified tournament performance in AoS',
        amount: gAos,
        date: ''
      });
    }

    return {
      success: true,
      summary: {
        total_earned: totalCredits,
        total_credits: totalCredits,
        earned_glory_total: earnedBucket,
        purchased_glory_total: purchasedBucket,
        granted_glory_total: grantedBucket,
        total_spent: totalSpent,
        spendable_glory: spendable,
        glory_40k: g40k,
        glory_aos: gAos,
        is_balanced: (totalCredits - totalSpent) === spendable
      },
      debits: debits,
      credits: credits
    };
  }

  /**
   * Render Glory Ledger view
   */
  async function renderArmoryLedger(container) {
    if (!container) return;
    container.innerHTML = buildArmoryLoadingHtml('Loading Glory Honor Statement & Balance History...');

    var data = await fetchArmoryLedger();
    container.innerHTML = buildLedgerHtml(data);
  }

  function buildLedgerHtml(data) {
    var summary = (data && data.summary) ? data.summary : {};
    var debitsList = (data && Array.isArray(data.debits)) ? data.debits : [];
    var creditsList = (data && Array.isArray(data.credits)) ? data.credits.slice() : [];
    var debitsSum = debitsList.reduce(function(acc, d) { return acc + Number(d.cost || 0); }, 0);

    // Reconcile any unlocked Season 2026 Trophies (including Roster In the Vault '26) from My Hub state
    var hubRef = window.myHubData || window.currentHubData;
    var sObj = hubRef && hubRef.seasonal && (hubRef.seasonal[hubRef.active_season || '2026'] || hubRef.seasonal['2026'] || hubRef.seasonal);
    var seasonalToInject = [];
    if (sObj && Array.isArray(sObj.badges)) {
      sObj.badges.forEach(function(sb) {
        var pts = Number(sb && (sb.glory_points || sb.glory || 0));
        if (sb && sb.unlocked && pts > 0) {
          var sid = 'seasonal_' + sb.id;
          var already = creditsList.some(function(c) {
            return c.id === sid || c.id === ('badge_' + sb.id) || (c.name && sb.name && String(c.name).indexOf(sb.name) !== -1);
          });
          if (!already) {
            seasonalToInject.push({
              id: sid,
              type: 'credit',
              category: 'Season 2026 Trophy',
              name: (sb.icon || '🏆') + ' ' + sb.name,
              detail: (sb.tier_name || ('Season 2026 • ' + (sb.rarity_label || sb.rarity || 'Honor'))) + ' • ' + (sb.provenance || sb.description || ''),
              amount: pts,
              date: sb.unlocked_at || '2026'
            });
          }
        }
      });
    }
    if (detectLocalSavedRoster() && !creditsList.some(function(c) { return String(c.id || '').indexOf('roster_in_vault') !== -1 || String(c.name || '').indexOf('Roster In the Vault') !== -1; }) && !seasonalToInject.some(function(c) { return String(c.id || '').indexOf('roster_in_vault') !== -1; })) {
      seasonalToInject.push({
        id: 'seasonal_s26_40k_roster_in_vault',
        type: 'credit',
        category: 'Season 2026 Trophy',
        name: "📜 Roster In the Vault '26",
        detail: 'Season 2026 • Common • Saved battle roster in NewRecruit Studio',
        amount: 25,
        date: '2026'
      });
    }
    if (seasonalToInject.length > 0) {
      var insertIdx = 0;
      while (insertIdx < creditsList.length && (String(creditsList[insertIdx].category || '').indexOf('Grant') !== -1 || String(creditsList[insertIdx].category || '').indexOf('Silverware') !== -1)) {
        insertIdx++;
      }
      creditsList = creditsList.slice(0, insertIdx).concat(seasonalToInject, creditsList.slice(insertIdx));
      if (data && Array.isArray(data.credits)) {
        data.credits = creditsList;
      }
    }

    var earnedBucket = Number(summary.earned_glory_total != null ? summary.earned_glory_total : (summary.total_earned || 0));
    var purchasedBucket = Number(summary.purchased_glory_total || 0);
    var grantedBucket = Number(summary.granted_glory_total || 0);
    var totalSpent = Math.max(Number(summary.total_spent || 0), debitsSum);
    var spendable = Number(summary.spendable_glory || 0);

    var gAosDisplay = Number(summary.glory_aos || 0);
    var g40kDisplay = Number(summary.glory_40k || 0);
    if (earnedBucket > (g40kDisplay + gAosDisplay)) {
      g40kDisplay = Math.max(g40kDisplay, earnedBucket - gAosDisplay);
    }

    if ((earnedBucket + purchasedBucket + grantedBucket - totalSpent) !== spendable) {
      var neededGrant = Math.max(0, (totalSpent + spendable) - (earnedBucket + purchasedBucket));
      if (neededGrant > grantedBucket) {
        var grantDiff = neededGrant - grantedBucket;
        grantedBucket = neededGrant;
        if (!creditsList.some(function(c) { return c.id === 'pioneer_grant_reconcile' || String(c.category || '').indexOf('genesis_pioneer_grant') !== -1 || String(c.category || '').indexOf('Account Grant') !== -1; })) {
          creditsList = [{
            id: 'pioneer_grant_reconcile',
            type: 'credit',
            category: 'Official Account Grant',
            name: '💎 Founder & Pioneer Armory Requisition Grant',
            detail: 'Early Adopter & Armory Unlock Allocation',
            amount: grantDiff,
            date: ''
          }].concat(creditsList);
        }
      }
    }

    var totalCredits = earnedBucket + purchasedBucket + grantedBucket;
    var isBalanced = (totalCredits - totalSpent) === spendable;

    var rows = [];
    creditsList.forEach(function(c) {
      var cleaned = cleanLedgerRowMeta(c.category || 'Glory Earned', c.detail || '');
      rows.push({
        id: c.id,
        type: 'credit',
        amount: Number(c.amount || 0),
        title: c.name || 'Glory Honor Bounty',
        category: cleaned.category,
        detail: cleaned.detail,
        date: c.date || ''
      });
    });
    debitsList.forEach(function(d) {
      var cleanedD = cleanLedgerRowMeta(d.wing || 'Armory Requisition', 'Unlocked in Retribution Armory');
      rows.push({
        id: d.id,
        type: 'debit',
        amount: Number(d.cost || 0),
        title: d.name || d.item_id || 'Armory Requisition',
        category: cleanedD.category,
        detail: cleanedD.detail,
        date: d.date || ''
      });
    });

    var filteredRows = rows.filter(function(r) {
      if (currentLedgerFilter === 'credit' && r.type !== 'credit') return false;
      if (currentLedgerFilter === 'debit' && r.type !== 'debit') return false;
      if (currentLedgerSearch) {
        var q = currentLedgerSearch.toLowerCase();
        var match = (r.title && r.title.toLowerCase().indexOf(q) !== -1) ||
                    (r.category && r.category.toLowerCase().indexOf(q) !== -1) ||
                    (r.detail && r.detail.toLowerCase().indexOf(q) !== -1) ||
                    (r.date && r.date.toLowerCase().indexOf(q) !== -1);
        if (!match) return false;
      }
      return true;
    });

    var rowsHtml = renderLedgerRows(filteredRows);

    return [
      '<div class="armory-ledger-container" style="grid-column: 1/-1; width: 100%;">',
      '  <div class="armory-ledger-hero-card">',
      '    <div class="ledger-hero-header">',
      '      <div style="display: flex; align-items: center; gap: 0.75rem;">',
      '        <span class="ledger-crest-icon">📜</span>',
      '        <div>',
      '          <h3 class="ledger-hero-title">Glory Honor Balance &amp; Transaction Statement</h3>',
      '          <div class="ledger-hero-sub">Complete history of your earned Glory Honors, account grants, and Armory requisitions.</div>',
      '        </div>',
      '      </div>',
      '      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">',
      '        <div class="ledger-status-pill" style="' + (isBalanced ? '' : 'background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.35);') + '">',
      '          ' + (isBalanced ? '✅ Account Balance Verified' : '⚠️ Balance Discrepancy Detected') + '',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="ledger-metrics-grid" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Career Earned Glory</div>',
      '        <div class="ledger-metric-val" style="color: #10b981;">+' + earnedBucket.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">(' + g40kDisplay.toLocaleString() + ' 40K + ' + gAosDisplay.toLocaleString() + ' AoS)</div>',
      '      </div>',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Account Grants &amp; Credits</div>',
      '        <div class="ledger-metric-val" style="color: #fbbf24;">+' + (purchasedBucket + grantedBucket).toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">' + (purchasedBucket > 0 ? purchasedBucket.toLocaleString() + ' Top-Up • ' : '') + grantedBucket.toLocaleString() + ' Grants</div>',
      '      </div>',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Total Spent (Events / Armory)</div>',
      '        <div class="ledger-metric-val" style="color: #ef4444;">-' + totalSpent.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">(' + debitsList.length + ' Items &amp; Entries)</div>',
      '      </div>',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Spendable Balance</div>',
      '        <div class="ledger-metric-val" style="color: #38bdf8;">' + spendable.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">Available in Armory &amp; Events</div>',
      '      </div>',
      '    </div>',
      '    <div class="ledger-math-formula" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">',
      '      <div><strong>Balance Summary:</strong> Total Credits (<strong>' + totalCredits.toLocaleString() + '</strong>) − Total Spent (<strong>' + totalSpent.toLocaleString() + '</strong>) = Spendable Balance (<strong>' + spendable.toLocaleString() + '</strong> Glory) ' + (isBalanced ? '✅ Reconciled' : '⚠️ Discrepancy') + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="ledger-controls-bar">',
      '    <div class="ledger-tabs-row">',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'all' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'all\')">All Records (' + rows.length + ')</button>',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'credit' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'credit\')">🟢 Credits &amp; Honors (' + creditsList.length + ')</button>',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'debit' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'debit\')">🔴 Requisitions &amp; Entries (' + debitsList.length + ')</button>',
      '    </div>',
      '    <div>',
      '      <input type="text" class="ledger-search-input" placeholder="Search item, tournament, league, or honor..." value="' + (currentLedgerSearch || '') + '" oninput="window.Armory.filterLedgerSearch(this.value)">',
      '    </div>',
      '  </div>',
      '  <div id="armory-ledger-stream" class="ledger-records-list">',
      rowsHtml,
      '  </div>',
      '</div>'
    ].join('\n');
  }

  async function runLiveGloryAudit() {
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var res = await fetch('/api/glory/audit', { headers: headers, credentials: 'include' });
      var data = await res.json();
      if (data && data.audit) {
        var a = data.audit;
        showArmoryNotification('✅ Account Balance Verified (' + Number(a.verified_balance || 0).toLocaleString() + ' Spendable Glory)', a.is_valid ? 'success' : 'error');
        var container = document.getElementById('armory-products-grid') || document.getElementById('standalone-ledger-container');
        if (container) await renderArmoryLedger(container);
      }
    } catch (e) {
      showArmoryNotification('❌ Verification check failed: ' + e.message, 'error');
    }
  }

  function renderLedgerRows(rows) {
    if (!rows || rows.length === 0) {
      return '<div class="ledger-empty-msg">No records match your current filter.</div>';
    }
    return rows.map(function(r) {
      var isCredit = r.type === 'credit';
      var badgeClass = isCredit ? 'badge-credit' : 'badge-debit';
      var sign = isCredit ? '+' : '−';
      var amtClass = isCredit ? 'amt-credit' : 'amt-debit';
      var dateStr = r.date ? '<span class="ledger-row-date">' + r.date.split('T')[0] + '</span>' : '';
      var cleaned = cleanLedgerRowMeta(r.category, r.detail);

      return [
        '<div class="ledger-record-row">',
        '  <div class="ledger-record-left">',
        '    <span class="ledger-entry-type-pill ' + badgeClass + '">' + (isCredit ? 'CREDIT' : 'DEBIT') + '</span>',
        '    <div class="ledger-record-info">',
        '      <div class="ledger-record-title">' + r.title + '</div>',
        '      <div class="ledger-record-meta">' + cleaned.category + (cleaned.detail ? ' • ' + cleaned.detail : '') + '</div>',
        '    </div>',
        '  </div>',
        '  <div class="ledger-record-right">',
        '    <div class="ledger-record-amount ' + amtClass + '">' + sign + r.amount.toLocaleString() + ' Glory</div>',
        dateStr,
        '  </div>',
        '</div>'
      ].join('\n');
    }).join('\n');
  }

  function filterLedgerType(type) {
    currentLedgerFilter = type;
    var container = document.getElementById('armory-products-grid') || document.getElementById('standalone-ledger-container');
    if (container && currentLedgerData) {
      container.innerHTML = buildLedgerHtml(currentLedgerData);
    }
  }

  function filterLedgerSearch(query) {
    currentLedgerSearch = query;
    var stream = document.getElementById('armory-ledger-stream');
    if (stream && currentLedgerData) {
      var rows = [];
      (currentLedgerData.credits || []).forEach(function(c) {
        rows.push({ id: c.id, type: 'credit', amount: Number(c.amount || 0), title: c.name || 'Glory Honor Bounty', category: c.category || 'Glory Earned', detail: c.detail || '', date: c.date || '' });
      });
      (currentLedgerData.debits || []).forEach(function(d) {
        rows.push({ id: d.id, type: 'debit', amount: Number(d.cost || 0), title: d.name || d.item_id || 'Armory Requisition', category: d.wing || 'Requisition Spent', detail: 'Requisition from Retribution Armory', date: d.date || '' });
      });
      var filtered = rows.filter(function(r) {
        if (currentLedgerFilter === 'credit' && r.type !== 'credit') return false;
        if (currentLedgerFilter === 'debit' && r.type !== 'debit') return false;
        if (currentLedgerSearch) {
          var q = currentLedgerSearch.toLowerCase();
          return (r.title && r.title.toLowerCase().indexOf(q) !== -1) ||
                 (r.category && r.category.toLowerCase().indexOf(q) !== -1) ||
                 (r.detail && r.detail.toLowerCase().indexOf(q) !== -1) ||
                 (r.date && r.date.toLowerCase().indexOf(q) !== -1);
        }
        return true;
      });
      stream.innerHTML = renderLedgerRows(filtered);
    }
  }

  async function openGloryLedgerModal() {
    var existing = document.getElementById('glory-ledger-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'glory-ledger-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100010';

    modal.innerHTML = [
      '<div class="modal-card armory-modal-card" style="max-width: 820px;">',
      '  <div class="armory-modal-header">',
      '    <div class="armory-header-branding">',
      '      <div class="armory-header-icon">📜</div>',
      '      <div>',
      '        <div class="armory-header-kicker">QUARTERMASTER AUDIT LOG</div>',
      '        <h2 class="armory-header-title">Glory Points Audit &amp; Balance Reconciliation</h2>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="document.getElementById(\'glory-ledger-modal\').remove()" aria-label="Close">✕</button>',
      '  </div>',
      '  <div class="armory-modal-body" style="padding: 1.25rem;">',
      '    <div id="standalone-ledger-container"></div>',
      '  </div>',
      '  <div class="armory-modal-footer" style="display: flex; justify-content: space-between; align-items: center;">',
      '    <button type="button" class="btn btn-secondary" onclick="document.getElementById(\'glory-ledger-modal\').remove()">Close Ledger</button>',
      '    <button type="button" class="btn btn-primary" onclick="document.getElementById(\'glory-ledger-modal\').remove(); window.Armory.openArmoryModal();">Return to Armory 🏛️</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);
    await renderArmoryLedger(document.getElementById('standalone-ledger-container'));
  }

  function closeArmoryModal() {
    var m = document.getElementById('retribution-armory-modal');
    if (m) m.remove();
  }

  // Public Interface
  window.Armory = {
    loadArmoryData: loadArmoryData,
    switchGameSystem: switchGameSystem,
    syncGlobalGameSystem: syncGlobalGameSystem,
    getGameSystem: function() { return currentGameSystem; },
    getEquippedForSystem: getEquippedForSystem,
    normalizeEquippedObject: normalizeEquippedObject,
    getItemGameSystem: getItemGameSystem,
    openArmoryModal: openArmoryModal,
    closeArmoryModal: closeArmoryModal,
    setArmoryMode: setArmoryMode,
    setVaultTab: setVaultTab,
    openStore: openStore,
    openVault: openVault,
    getArmoryMode: function() { return currentArmoryMode; },
    getVaultTab: function() { return activeVaultTab; },
    openGloryLedgerModal: openGloryLedgerModal,
    renderArmoryLedger: renderArmoryLedger,
    runLiveGloryAudit: runLiveGloryAudit,
    filterLedgerType: filterLedgerType,
    filterLedgerSearch: filterLedgerSearch,
    setWingFilter: setWingFilter,
    purchaseItem: purchaseItem,
    equipItem: equipItem,
    unequipSlot: unequipSlot,
    toggleEquip: toggleEquip,
    pokePlayer: pokePlayer,
    openPokeRivalModal: openPokeRivalModal,
    checkAndTriggerSignInPokeEffect: checkAndTriggerSignInPokeEffect,
    renderActiveRivalHexBanner: renderActiveRivalHexBanner,
    getActiveHexes: getActiveHexes,
    applyEquippedDecorations: applyEquippedDecorations,
    getEquipped: function(slot, system) {
      var sys = (system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
      if (sys !== '40k' && sys !== 'aos') sys = '40k';
      var eq = getEquippedForSystem(currentVault.equipped, sys);
      if (eq && eq[slot] !== undefined && eq[slot] !== null) {
        return eq[slot];
      }
      if (slot === 'active_dice') {
        try {
          var savedDice = localStorage.getItem('omnitactica_active_dice_' + sys);
          if (savedDice && getItemGameSystem(savedDice) === sys) return savedDice;
        } catch(e) {}
      }
      if (currentCatalog && currentCatalog.items && (currentCatalog.game_system || currentGameSystem) === sys) {
        var found = currentCatalog.items.find(function(it) {
          return it.is_equipped && it.slot === slot && (it.game_system === sys || !it.game_system);
        });
        if (found) return found.id;
      }
      return null;
    },
    getEquippedItem: function(slotOrId, system) {
      var sys = (system || currentGameSystem || detectActiveGameSystem() || '40k').toLowerCase();
      if (sys !== '40k' && sys !== 'aos') sys = '40k';
      var id = window.Armory.getEquipped(slotOrId, sys);
      if (!id && typeof slotOrId === 'string' && slotOrId.startsWith('dice_')) {
        if (getItemGameSystem(slotOrId) === sys) id = slotOrId;
      }
      if (!id && slotOrId === 'active_dice') {
        try {
          var saved = localStorage.getItem('omnitactica_active_dice_' + sys);
          if (saved && getItemGameSystem(saved) === sys) id = saved;
        } catch(e) {}
      }
      if (!id) return null;
      var catItem = findCatalogItemById(id);
      if (catItem) return catItem;
      if (typeof getFallbackDiceMetadata === 'function') {
        return getFallbackDiceMetadata(id);
      }
      return null;
    },
    getVault: function() { return currentVault; },
    getCurrentVault: function() { return currentVault; },
    getFrameCssClass: getFrameCssClass,
    getFinishCssClass: getFinishCssClass,
    getGlory: function() { return currentGlory; }
  };

  // Auto-init decorations & poke effects when DOM is ready
  function bootArmory() {
    var initSys = detectActiveGameSystem();
    currentGameSystem = initSys;
    hydrateVaultFromGlobalSession();
    applyEquippedDecorations(initSys);
    setTimeout(function() {
      loadArmoryData(detectActiveGameSystem()).then(function() {
        applyEquippedDecorations(detectActiveGameSystem());
        checkAndTriggerSignInPokeEffect();
        renderActiveRivalHexBanner();
      });
    }, 350);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootArmory);
  } else {
    bootArmory();
  }

})(window);
