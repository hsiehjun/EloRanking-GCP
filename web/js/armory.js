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
      var res = await fetch('/api/armory/catalog?game_system=' + encodeURIComponent(sys) + '&_t=' + Date.now(), {
        headers: headers,
        cache: 'no-store'
      });
      if (res.ok) {
        var data = await res.json();
        currentCatalog = data;
        if (data.user_glory) currentGlory = data.user_glory;
        if (data.user_vault) currentVault = data.user_vault;
        return data;
      }
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

  /**
   * Effect Dispatcher: Applies active decorations across the entire page
   */
  function applyEquippedDecorations(system) {
    var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
    var allEq = currentVault.equipped || {};
    var eq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;

    // 1. Apply Card Frame (Borders & Hologram)
    var frameId = eq.active_card_frame;
    var targetCssClass = frameId ? getFrameCssClass(frameId) : null;

    var heroCards = document.querySelectorAll('.hero-card, .profile-hero-card, #my-hub-hero-card');
    heroCards.forEach(function(card) {
      Array.from(card.classList).forEach(function(c) {
        if (c.startsWith('frame-') || c.startsWith('frame_')) card.classList.remove(c);
      });
      if (targetCssClass) {
        card.classList.add(targetCssClass);
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
        var tClass = tItem && tItem.payload ? tItem.payload.css_class : 'title-badge-unbroken';
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

    // 4. Sync localStorage active_dice for real-time dice tray integration
    if (eq && eq.active_dice) {
      try { localStorage.setItem('omnitactica_active_dice', eq.active_dice); } catch(e) {}
    } else {
      try { localStorage.removeItem('omnitactica_active_dice'); } catch(e) {}
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
    activeWingFilter = wingId;
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

    if (!currentCatalog || !currentCatalog.items) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 2rem;">Loading requisition manifests...</div>';
      return;
    }

    var countSpans = document.querySelectorAll('.backpack-count-span');
    var bCount = getOwnedItemsCount();
    countSpans.forEach(function(s) { s.textContent = bCount; });

    var items = currentCatalog.items.filter(function(item) {
      if (activeWingFilter === 'backpack' || activeWingFilter === 'vault') {
        return !!item.is_owned;
      }
      if (activeWingFilter === 'all') return true;
      return item.wing === activeWingFilter;
    });

    if (items.length === 0) {
      if (activeWingFilter === 'backpack' || activeWingFilter === 'vault') {
        container.innerHTML = [
          '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 3rem 1.5rem;">',
          '  <div style="font-size: 3.2rem; margin-bottom: 0.75rem;">🎒</div>',
          '  <h3 style="color: #fff; font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem;">Your Armory Backpack is Empty</h3>',
          '  <p style="color: #94a3b8; font-size: 0.88rem; max-width: 440px; margin: 0 auto 1.5rem;">You haven\'t requisitioned any items for ' + (currentGameSystem === 'aos' ? 'Age of Sigmar' : 'Warhammer 40,000') + ' yet. Requisition tactical dice, frames, heraldic sigils, and titles using your Unified Glory!</p>',
          '  <button type="button" class="btn btn-primary" onclick="window.Armory.setWingFilter(\'all\')" style="font-weight: 700; padding: 0.6rem 1.5rem;">',
          '    🌐 Browse All Requisitions',
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
    if (activeWingFilter === 'backpack' || activeWingFilter === 'vault') {
      var allEq = currentVault.equipped || {};
      var eq = (allEq[currentGameSystem] && typeof allEq[currentGameSystem] === 'object') ? allEq[currentGameSystem] : allEq;
      var activeDiceItem = currentCatalog.items.find(function(i) { return i.id === eq.active_dice; });
      var activeFrameItem = currentCatalog.items.find(function(i) { return i.id === eq.active_card_frame; });
      var activeAvatarItem = currentCatalog.items.find(function(i) { return i.id === eq.active_avatar; });
      var activeTitleItem = currentCatalog.items.find(function(i) { return i.id === eq.active_title; });

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
        '      <span class="slot-chip-label">✨ Frame:</span> <strong>' + (activeFrameItem ? escapeHtml(activeFrameItem.name) : '<span style="color:#64748b;">Standard</span>') + '</strong>',
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
   * Opens the full Retribution Armory Store Modal
   */
  async function openArmoryModal(initialWing, system) {
    if (initialWing) activeWingFilter = initialWing;
    if (system) currentGameSystem = system;

    var existing = document.getElementById('retribution-armory-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'retribution-armory-modal';
    modal.className = 'modal-backdrop active';
    modal.style.zIndex = '100005';

    modal.innerHTML = [
      '<div class="modal-card armory-modal-card">',
      '  <!-- Header & Glory Balance Strip -->',
      '  <div class="armory-modal-header">',
      '    <div class="armory-header-branding">',
      '      <div class="armory-header-icon">🏛️</div>',
      '      <div>',
      '        <div class="armory-header-kicker">OMNITACTICA QUARTERMASTER</div>',
      '        <h2 class="armory-header-title">Retribution Armory</h2>',
      '      </div>',
      '    </div>',
      '    <!-- Store System Switcher Pills -->',
      '    <div class="armory-system-switcher">',
      '      <button type="button" class="armory-system-btn ' + (currentGameSystem === '40k' ? 'active' : '') + '" data-sys="40k" onclick="window.Armory.switchGameSystem(\'40k\')">',
      '        ⚔️ 40K Armory',
      '      </button>',
      '      <button type="button" class="armory-system-btn ' + (currentGameSystem === 'aos' ? 'active' : '') + '" data-sys="aos" onclick="window.Armory.switchGameSystem(\'aos\')">',
      '        ⚡ AoS Armory',
      '      </button>',
      '    </div>',
      '    <div class="armory-wallet-hud">',
      '      <div class="armory-wallet-stat">',
      '        <span class="armory-wallet-val" id="armory-spendable-balance-val">--</span>',
      '        <span class="armory-wallet-lbl">Spendable Glory</span>',
      '        <span class="armory-wallet-sub" id="armory-glory-breakdown-sub" style="font-size: 0.65rem; color: #94a3b8; font-family: var(--font-mono, monospace);"></span>',
      '      </div>',
      '      <div class="armory-wallet-stat desktop-only">',
      '        <span class="armory-wallet-val text-muted" id="armory-total-spent-val">0</span>',
      '        <span class="armory-wallet-lbl">Total Requisitioned</span>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
      '  </div>',
      '  <!-- Wing Filter Nav Tabs -->',
      '  <div class="armory-wings-bar">',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'all' ? 'active' : '') + '" data-wing="all" onclick="window.Armory.setWingFilter(\'all\')">',
      '      <span>🌐</span> <span class="wing-pill-desktop">All Wings</span><span class="wing-pill-mobile">All</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'backpack' ? 'active' : '') + '" data-wing="backpack" onclick="window.Armory.setWingFilter(\'backpack\')">',
      '      <span>🎒</span> <span class="wing-pill-desktop">My Backpack (<span class="backpack-count-span">' + getOwnedItemsCount() + '</span>)</span><span class="wing-pill-mobile">Backpack (<span class="backpack-count-span">' + getOwnedItemsCount() + '</span>)</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'dice_forge' ? 'active' : '') + '" data-wing="dice_forge" onclick="window.Armory.setWingFilter(\'dice_forge\')">',
      '      <span>🎲</span> <span class="wing-pill-desktop">Dice Forge</span><span class="wing-pill-mobile">Dice</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'profile_forge' ? 'active' : '') + '" data-wing="profile_forge" onclick="window.Armory.setWingFilter(\'profile_forge\')">',
      '      <span>✨</span> <span class="wing-pill-desktop">Profile Forge</span><span class="wing-pill-mobile">Frames</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'avatars' ? 'active' : '') + '" data-wing="avatars" onclick="window.Armory.setWingFilter(\'avatars\')">',
      '      <span>🛡️</span> <span class="wing-pill-desktop">Faction Sigils</span><span class="wing-pill-mobile">Sigils</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'titles' ? 'active' : '') + '" data-wing="titles" onclick="window.Armory.setWingFilter(\'titles\')">',
      '      <span>🏷️</span> <span class="wing-pill-desktop">Titles</span><span class="wing-pill-mobile">Titles</span>',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'pokes' ? 'active' : '') + '" data-wing="pokes" onclick="window.Armory.setWingFilter(\'pokes\')">',
      '      <span>👉</span> <span class="wing-pill-desktop">Player Pokes</span><span class="wing-pill-mobile">Pokes</span>',
      '    </button>',
      '  </div>',
      '  <!-- Products Scrollable Grid -->',
      '  <div class="armory-modal-body">',
      '    <div id="armory-products-grid" class="armory-grid"></div>',
      '  </div>',
      '  <!-- Footer -->',
      '  <div class="armory-modal-footer">',
      '    <span class="armory-footer-notice">Glory Honor is unified across 40K &amp; AoS and earned through verified tournament clashes. Zero real-world cash gambling.</span>',
      '    <button type="button" class="btn btn-secondary" onclick="window.Armory.closeArmoryModal()">Return to Fleet</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);

    // Load data and render
    await loadArmoryData(currentGameSystem);
    updateArmoryHeaderBalance();
    renderArmoryGrid();
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
      if (allEq[sys] && typeof allEq[sys] === 'object' && allEq[sys][slot] !== undefined) {
        return allEq[sys][slot];
      }
      return allEq[slot];
    },
    getEquippedItem: function(slot, system) {
      var id = window.Armory.getEquipped(slot, system);
      if (!id || !currentCatalog || !currentCatalog.items) return null;
      for (var i = 0; i < currentCatalog.items.length; i++) {
        if (currentCatalog.items[i].id === id) return currentCatalog.items[i];
      }
      return null;
    },
    getVault: function() { return currentVault; },
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
