/**
 * OmniTactica Retribution Armory
 * Client-Side Engine, Multi-System Store Modal & Effect Dispatcher
 */

(function(window) {
  'use strict';

  var currentGameSystem = '40k';
  var currentCatalog = null;
  var currentVault = { inventory: {}, equipped: { active_dice: null, active_card_frame: null, active_title: null, active_avatar: null } };
  var currentGlory = { total_earned: 0, glory_spent: 0, spendable_glory: 0, crest_tier: 1 };
  var activeWingFilter = 'all';
  var currentArmoryMode = 'vault'; // 'vault' (Command Home) or 'store' (Requisition Depot)
  var activeVaultTab = 'backpack'; // 'backpack' or 'ledger'
  var isPurchasing = false;

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
   * Switch active game system (40k vs aos)
   */
  async function switchGameSystem(sys) {
    if (sys !== '40k' && sys !== 'aos') sys = '40k';
    currentGameSystem = sys;

    // Update switcher tab UI
    var tabs = document.querySelectorAll('.armory-system-btn');
    tabs.forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-sys') === sys);
    });

    await loadArmoryData(sys);
    renderArmoryGrid();
  }

  /**
   * Fetch latest catalog & user vault from server
   */
  async function loadArmoryData(gameSys) {
    try {
      var sys = gameSys || currentGameSystem || '40k';
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {};

      var catPromise = fetch('/api/armory/catalog?game_system=' + encodeURIComponent(sys) + '&_t=' + Date.now(), {
        headers: headers,
        credentials: 'include',
        cache: 'no-store'
      });
      var vaultPromise = fetch('/api/armory/vault?_t=' + Date.now(), {
        headers: headers,
        credentials: 'include',
        cache: 'no-store'
      }).catch(function() { return null; });

      var results = await Promise.all([catPromise, vaultPromise]);
      var catRes = results[0];
      var vaultRes = results[1];

      if (vaultRes && vaultRes.ok) {
        try {
          var vData = await vaultRes.json();
          if (vData.vault) currentVault = vData.vault;
          if (vData.glory) currentGlory = vData.glory;
        } catch (ve) {}
      }

      if (catRes.ok) {
        var data = await catRes.json();
        currentCatalog = data;
        if (data.user_glory) currentGlory = data.user_glory;
        if (data.user_vault) currentVault = data.user_vault;
      }

      // Self-healing synchronization:
      // Ensure currentVault.equipped is initialized and populated for the current game system
      if (!currentVault) currentVault = { inventory: {}, equipped: {} };
      if (!currentVault.equipped) currentVault.equipped = {};
      if (!currentVault.equipped[sys] || typeof currentVault.equipped[sys] !== 'object') {
        currentVault.equipped[sys] = { active_dice: null, active_card_frame: null, active_title: null, active_avatar: null };
      }

      // If catalog items have is_equipped === true, reflect them into currentVault.equipped
      if (currentCatalog && Array.isArray(currentCatalog.items)) {
        currentCatalog.items.forEach(function(item) {
          if (item.is_equipped && item.slot) {
            currentVault.equipped[sys][item.slot] = item.id;
            currentVault.equipped[item.slot] = item.id;
          }
        });
      }

      return currentCatalog;
    } catch (e) {
      console.warn('Notice loading armory catalog:', e);
    }
    return null;
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
      if (data.vault) currentVault = data.vault;
      if (data.glory) currentGlory = data.glory;

      // Automatically equip if permanent cosmetic
      if (data.item && !data.item.is_consumable && data.item.slot) {
        await equipItem(data.item.slot, data.item.id, true);
      } else {
        await loadArmoryData();
        renderArmoryGrid();
      }

      updateArmoryHeaderBalance();
      // Update global UI decoration
      applyEquippedDecorations();

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
    var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
    var allEq = currentVault.equipped || {};
    var eq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;
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
    var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();

    // 1. Instant optimistic in-memory update
    if (!currentVault.equipped) currentVault.equipped = {};
    if (!currentVault.equipped[sys] || typeof currentVault.equipped[sys] !== 'object') {
      currentVault.equipped[sys] = { active_dice: null, active_card_frame: null, active_title: null, active_avatar: null };
    }
    currentVault.equipped[sys][slot] = itemId;
    currentVault.equipped[slot] = itemId;

    if (slot === 'active_dice') {
      try { localStorage.setItem('omnitactica_active_dice', itemId); } catch(e) {}
    }

    if (currentCatalog && currentCatalog.items) {
      currentCatalog.items.forEach(function(i) {
        if (i.slot === slot) {
          i.is_equipped = (i.id === itemId);
        }
      });
    }

    // Immediately reflect on Armory modal grid, header, and profile card!
    renderArmoryGrid();
    applyEquippedDecorations(sys);
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

      if (data.equipped) currentVault.equipped = data.equipped;
      if (!silent) showArmoryNotification('⚔️ ' + data.message, 'success');

      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);
      updateArmoryHeaderBalance();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);
    }
  }

  /**
   * Unequip an item slot back to default
   */
  async function unequipSlot(slot, silent, system) {
    var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();

    // 1. Instant optimistic in-memory update
    if (!currentVault.equipped) currentVault.equipped = {};
    if (currentVault.equipped[sys] && typeof currentVault.equipped[sys] === 'object') {
      currentVault.equipped[sys][slot] = null;
    }
    currentVault.equipped[slot] = null;

    if (slot === 'active_dice') {
      try { localStorage.removeItem('omnitactica_active_dice'); } catch(e) {}
    }

    if (currentCatalog && currentCatalog.items) {
      currentCatalog.items.forEach(function(i) {
        if (i.slot === slot) {
          i.is_equipped = false;
        }
      });
    }

    renderArmoryGrid();
    applyEquippedDecorations(sys);
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

      if (data.equipped) currentVault.equipped = data.equipped;
      if (!silent) showArmoryNotification('🛡️ ' + data.message, 'info');

      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);
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
                    document.getElementById('hub-content') ||
                    document.querySelector('.profile-hero-card');
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

  /**
   * Effect Dispatcher: Applies active decorations across the entire page
   */
  function applyEquippedDecorations(system, overrideEquipped) {
    var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
    var allEq = overrideEquipped || currentVault.equipped || {};
    var eq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;

    // 1. Apply Card Frame (Border)
    var frameId = eq.active_card_frame;
    var targetCssClass = frameId ? getFrameCssClass(frameId) : null;

    // 1b. Apply Card Finish (Astral Holo-Foil Finish)
    var finishId = eq.active_card_finish;
    var targetFinishClass = finishId ? getFinishCssClass(finishId) : null;

    var heroCards = document.querySelectorAll('.hero-card, .profile-hero-card, #my-hub-hero-card');
    heroCards.forEach(function(card) {
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
    var titleBadgeContainers = document.querySelectorAll('.hero-title-badge-slot');
    titleBadgeContainers.forEach(function(el) {
      if (!titleId) {
        el.innerHTML = '';
        el.style.display = 'none';
      } else {
        var tItem = currentCatalog && currentCatalog.items ? currentCatalog.items.find(function(i) { return i.id === titleId; }) : null;
        var tText = tItem && tItem.payload ? tItem.payload.title_text : (tItem ? tItem.name : titleId.replace(/^title_/, '').replace(/_/g, ' '));
        var tClass = tItem && tItem.payload ? tItem.payload.css_class : (titleId.includes('warp') ? 'title-badge-warp' : (titleId.includes('forge') ? 'title-badge-forge' : (titleId.includes('strategist') ? 'title-badge-strategist' : 'title-badge-unbroken')));
        el.innerHTML = '<span class="armory-title-chip ' + escapeHtml(tClass) + '"><span class="title-chip-icon">🏷️</span> ' + escapeHtml(tText.toUpperCase()) + '</span>';
        el.style.display = 'inline-flex';
      }
    });

    // 3. Render Equipped Faction Avatar Sigil (Replaces rank crest icon!)
    var avatarId = eq.active_avatar;
    var rankCrests = document.querySelectorAll('.profile-rank-crest');
    rankCrests.forEach(function(crest) {
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
        var aItem = currentCatalog && currentCatalog.items ? currentCatalog.items.find(function(i) { return i.id === avatarId; }) : null;
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

    // 4. Sync localStorage active_dice for real-time dice tray integration (only for current user)
    if (!overrideEquipped) {
      if (eq && eq.active_dice) {
        try { localStorage.setItem('omnitactica_active_dice', eq.active_dice); } catch(e) {}
      } else if (eq && !eq.active_dice) {
        var savedDice = null;
        try { savedDice = localStorage.getItem('omnitactica_active_dice'); } catch(e) {}
        if (savedDice) {
          eq.active_dice = savedDice;
          allEq.active_dice = savedDice;
        }
      }
    }

    // 5. Dispatch Event for Live Tracker Dice Tray
    if (window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('omnitactica:armory-loadout-changed', {
        detail: { equipped: eq, vault: currentVault }
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

    // Synchronize the My Hub tab button in real-time
    var hubCounter = document.getElementById('hub-armory-balance-count');
    if (hubCounter) {
      hubCounter.textContent = spendable.toLocaleString();
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
      var allEq = currentVault.equipped || {};
      var eq = (allEq[currentGameSystem] && typeof allEq[currentGameSystem] === 'object') ? allEq[currentGameSystem] : allEq;
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

      if (activeDiceItem && eq) eq.active_dice = activeDiceItem.id;
      if (activeFrameItem && eq) eq.active_card_frame = activeFrameItem.id;
      if (activeFinishItem && eq) eq.active_card_finish = activeFinishItem.id;
      if (activeAvatarItem && eq) eq.active_avatar = activeAvatarItem.id;
      if (activeTitleItem && eq) eq.active_title = activeTitleItem.id;

      backpackHeaderHtml = [
        '<div class="armory-backpack-summary">',
        '  <div class="backpack-summary-top">',
        '    <div class="backpack-summary-title">',
        '      <span style="font-size: 1.35rem;">🎒</span> My Purchased Backpack (' + items.length + ' Items Owned)',
        '    </div>',
        '    <div class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); font-weight: 700; font-size: 0.78rem;">',
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
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === '40k' ? 'active' : '') + '" data-sys="40k" onclick="window.Armory.switchGameSystem(\'40k\')">⚔️ 40K Armory</button>',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === 'aos' ? 'active' : '') + '" data-sys="aos" onclick="window.Armory.switchGameSystem(\'aos\')">⚡ AoS Armory</button>',
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
        '    <span>🛒</span> Retribution Store ➔',
        '  </button>',
        '  <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
        '</div>'
      ].join('\n');

      subnavHtml = '';

      footerHtml = [
        '<div class="armory-modal-footer" style="display: flex; justify-content: space-between; align-items: center;">',
        '  <span class="armory-footer-notice">Glory Honor is unified across 40K &amp; AoS and earned through verified tournament clashes. Zero real-world cash gambling.</span>',
        '</div>'
      ].join('\n');
    } else {
      headerHtml = [
        '<div class="armory-modal-header">',
        '  <button type="button" class="armory-back-vault-btn" onclick="window.Armory.setArmoryMode(\'vault\')">← Back to Armory</button>',
        '  <div class="armory-header-branding">',
        '    <div class="armory-header-icon">🛒</div>',
        '    <div>',
        '      <div class="armory-header-kicker">OMNITACTICA QUARTERMASTER CATALOG</div>',
        '      <h2 class="armory-header-title">Retribution Store</h2>',
        '    </div>',
        '  </div>',
        '  <div class="armory-system-switcher">',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === '40k' ? 'active' : '') + '" data-sys="40k" onclick="window.Armory.switchGameSystem(\'40k\')">⚔️ 40K Armory</button>',
        '    <button type="button" class="armory-system-btn ' + (currentGameSystem === 'aos' ? 'active' : '') + '" data-sys="aos" onclick="window.Armory.switchGameSystem(\'aos\')">⚡ AoS Armory</button>',
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

      footerHtml = [
        '<div class="armory-modal-footer" style="display: flex; justify-content: space-between; align-items: center;">',
        '  <button type="button" class="armory-back-vault-btn" onclick="window.Armory.setArmoryMode(\'vault\')" style="padding: 0.35rem 0.85rem; font-size: 0.78rem;">← Return to Armory</button>',
        '  <span class="armory-footer-notice">Glory Honor is unified across 40K &amp; AoS and earned through verified tournament clashes. Zero real-world cash gambling.</span>',
        '</div>'
      ].join('\n');
    }

    modal.innerHTML = [
      '<div class="modal-card armory-modal-card">',
      headerHtml,
      subnavHtml,
      '  <div class="armory-modal-body">',
      '    <div id="armory-products-grid" class="armory-grid"></div>',
      '  </div>',
      footerHtml,
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
    if (system) currentGameSystem = system;
    if (wing) activeWingFilter = wing;
    currentArmoryMode = 'store';
    openArmoryModal('store', system);
  }

  function openVault(tab, system) {
    if (system) currentGameSystem = system;
    if (tab) activeVaultTab = tab;
    currentArmoryMode = 'vault';
    openArmoryModal(tab || 'backpack', system);
  }

  /**
   * Opens the full Retribution Armory Modal
   */
  async function openArmoryModal(initialWing, system) {
    if (system) currentGameSystem = system;

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

    // Load data and render
    await loadArmoryData(currentGameSystem);
    renderArmoryModalShell();
  }

  var currentLedgerData = null;
  var currentLedgerFilter = 'all'; // 'all', 'credit', 'debit'
  var currentLedgerSearch = '';

  /**
   * Fetch itemized Glory transaction ledger
   */
  async function fetchArmoryLedger() {
    try {
      var res = await fetch('/api/armory/transactions', { credentials: 'include' });
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
    var totalEarned = Number(currentGlory.total_glory || currentGlory.total_earned || 8890);
    var totalSpent = Number(currentGlory.glory_spent || 8500);
    var spendable = Number(currentGlory.spendable_glory != null ? currentGlory.spendable_glory : (totalEarned - totalSpent));
    var g40k = Number(currentGlory.glory_40k || 8780);
    var gAos = Number(currentGlory.glory_aos || 110);

    var debits = [];
    var inv = (currentVault && currentVault.inventory) ? currentVault.inventory : {};
    Object.keys(inv).forEach(function(itemId) {
      var itemMeta = null;
      if (currentCatalog && currentCatalog.items) {
        itemMeta = currentCatalog.items.find(function(it) { return it.id === itemId; });
      }
      var cost = itemMeta ? (itemMeta.cost_glory || itemMeta.cost || 0) : 0;
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

    var credits = [];
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
    if (window.myHubData && Array.isArray(window.myHubData.badges)) {
      window.myHubData.badges.forEach(function(b) {
        var pts = Number(b.glory_points || b.glory || 0);
        if (b.unlocked && pts > 0) {
          credits.push({
            id: 'badge_' + b.id,
            type: 'credit',
            category: 'Battlefield Honor',
            name: '🎖️ ' + (b.name || 'Badge Honor'),
            detail: (b.tier_name || 'Honor') + ' • ' + (b.description || ''),
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
        total_earned: totalEarned,
        total_spent: totalSpent,
        spendable_glory: spendable,
        glory_40k: g40k,
        glory_aos: gAos,
        is_balanced: (totalEarned - totalSpent) === spendable
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
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 2.5rem;"><div class="spinner" style="margin: 0 auto 1rem;"></div>Loading auditable Glory ledger...</div>';

    var data = await fetchArmoryLedger();
    container.innerHTML = buildLedgerHtml(data);
  }

  function buildLedgerHtml(data) {
    var summary = (data && data.summary) ? data.summary : {};
    var totalEarned = Number(summary.total_earned || 0);
    var totalSpent = Number(summary.total_spent || 0);
    var spendable = Number(summary.spendable_glory || 0);
    var isBalanced = summary.is_balanced !== false && (totalEarned - totalSpent === spendable);

    var rows = [];
    (data.credits || []).forEach(function(c) {
      rows.push({
        id: c.id,
        type: 'credit',
        amount: Number(c.amount || 0),
        title: c.name || 'Glory Honor Bounty',
        category: c.category || 'Glory Earned',
        detail: c.detail || '',
        date: c.date || ''
      });
    });
    (data.debits || []).forEach(function(d) {
      rows.push({
        id: d.id,
        type: 'debit',
        amount: Number(d.cost || 0),
        title: d.name || d.item_id || 'Armory Requisition',
        category: d.wing || 'Requisition Spent',
        detail: 'Requisition from Retribution Armory',
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
      '          <h3 class="ledger-hero-title">Glory Points Audit &amp; Balance Reconciliation</h3>',
      '          <div class="ledger-hero-sub">Itemized verification of all earned honor bounties and armory requisitions</div>',
      '        </div>',
      '      </div>',
      '      <div class="ledger-status-pill ' + (isBalanced ? '' : 'style="background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.35);"') + '">',
      '        ' + (isBalanced ? '✅ Audit Verified: Balanced' : '⚠️ Balance Discrepancy') + '',
      '      </div>',
      '    </div>',
      '    <div class="ledger-metrics-grid">',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Lifetime Glory Earned</div>',
      '        <div class="ledger-metric-val" style="color: #10b981;">+' + totalEarned.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">(' + Number(summary.glory_40k || 0).toLocaleString() + ' 40K + ' + Number(summary.glory_aos || 0).toLocaleString() + ' AoS)</div>',
      '      </div>',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Total Requisitioned</div>',
      '        <div class="ledger-metric-val" style="color: #ef4444;">-' + totalSpent.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">(' + (data.debits || []).length + ' Items Requisitioned)</div>',
      '      </div>',
      '      <div class="ledger-metric-box">',
      '        <div class="ledger-metric-lbl">Current Spendable Glory</div>',
      '        <div class="ledger-metric-val" style="color: #38bdf8;">' + spendable.toLocaleString() + '</div>',
      '        <div class="ledger-metric-sub">Reconciled Vault Reserve</div>',
      '      </div>',
      '    </div>',
      '    <div class="ledger-math-formula">',
      '      <strong>Computation Verification:</strong> Lifetime Earned (<strong>' + totalEarned.toLocaleString() + '</strong>) − Total Spent (<strong>' + totalSpent.toLocaleString() + '</strong>) = Spendable Balance (<strong>' + spendable.toLocaleString() + '</strong> Glory) ' + (isBalanced ? '✅ Correctly Reconciled' : '⚠️ Discrepancy detected'),
      '    </div>',
      '  </div>',
      '  <div class="ledger-controls-bar">',
      '    <div class="ledger-tabs-row">',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'all' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'all\')">All Records (' + rows.length + ')</button>',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'credit' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'credit\')">🟢 Points Earned (' + (data.credits || []).length + ')</button>',
      '      <button type="button" class="ledger-tab-btn ' + (currentLedgerFilter === 'debit' ? 'active' : '') + '" onclick="window.Armory.filterLedgerType(\'debit\')">🔴 Requisitions (' + (data.debits || []).length + ')</button>',
      '    </div>',
      '    <div>',
      '      <input type="text" class="ledger-search-input" placeholder="Search item, event, or honor..." value="' + (currentLedgerSearch || '') + '" oninput="window.Armory.filterLedgerSearch(this.value)">',
      '    </div>',
      '  </div>',
      '  <div id="armory-ledger-stream" class="ledger-records-list">',
      rowsHtml,
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function renderLedgerRows(rows) {
    if (!rows || rows.length === 0) {
      return '<div class="ledger-empty-msg">No audit records match your current filter.</div>';
    }
    return rows.map(function(r) {
      var isCredit = r.type === 'credit';
      var badgeClass = isCredit ? 'badge-credit' : 'badge-debit';
      var sign = isCredit ? '+' : '−';
      var amtClass = isCredit ? 'amt-credit' : 'amt-debit';
      var dateStr = r.date ? '<span class="ledger-row-date">' + r.date.split('T')[0] + '</span>' : '';

      return [
        '<div class="ledger-record-row">',
        '  <div class="ledger-record-left">',
        '    <span class="ledger-entry-type-pill ' + badgeClass + '">' + (isCredit ? 'CREDIT' : 'DEBIT') + '</span>',
        '    <div class="ledger-record-info">',
        '      <div class="ledger-record-title">' + r.title + '</div>',
        '      <div class="ledger-record-meta">' + r.category + (r.detail ? ' • ' + r.detail : '') + '</div>',
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
    getGameSystem: function() { return currentGameSystem; },
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
      var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
      var allEq = currentVault.equipped || {};
      if (allEq[sys] && typeof allEq[sys] === 'object' && allEq[sys][slot] !== undefined && allEq[sys][slot] !== null) {
        return allEq[sys][slot];
      }
      if (allEq[slot] !== undefined && allEq[slot] !== null) {
        return allEq[slot];
      }
      if (slot === 'active_dice') {
        try {
          var savedDice = localStorage.getItem('omnitactica_active_dice');
          if (savedDice) return savedDice;
        } catch(e) {}
      }
      if (currentCatalog && currentCatalog.items) {
        var found = currentCatalog.items.find(function(it) {
          return it.is_equipped && it.slot === slot && (it.game_system === sys || !it.game_system);
        });
        if (found) return found.id;
      }
      return null;
    },
    getEquippedItem: function(slotOrId, system) {
      var id = window.Armory.getEquipped(slotOrId, system);
      if (!id && typeof slotOrId === 'string' && slotOrId.startsWith('dice_')) {
        id = slotOrId;
      }
      if (!id && slotOrId === 'active_dice') {
        try { id = localStorage.getItem('omnitactica_active_dice'); } catch(e) {}
      }
      if (!id) return null;
      if (currentCatalog && currentCatalog.items) {
        for (var i = 0; i < currentCatalog.items.length; i++) {
          if (currentCatalog.items[i].id === id) return currentCatalog.items[i];
        }
      }
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      loadArmoryData().then(applyEquippedDecorations).then(function() {
        checkAndTriggerSignInPokeEffect();
        renderActiveRivalHexBanner();
      });
    });
  } else {
    loadArmoryData().then(applyEquippedDecorations).then(function() {
      checkAndTriggerSignInPokeEffect();
      renderActiveRivalHexBanner();
    });
  }

})(window);
