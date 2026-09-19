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
      var res = await fetch('/api/armory/catalog?game_system=' + encodeURIComponent(sys), { headers: headers });
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
   * Equip an owned item into an active slot
   */
  async function equipItem(slot, itemId, silent, system) {
    try {
      var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
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

      currentVault.equipped = data.equipped;
      if (!silent) showArmoryNotification('⚔️ ' + data.message, 'success');

      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);
      updateArmoryHeaderBalance();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
    }
  }

  /**
   * Unequip an item slot back to default
   */
  async function unequipSlot(slot, silent, system) {
    try {
      var sys = (system || currentGameSystem || window.currentGameSystem || '40k').toLowerCase();
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

      currentVault.equipped = data.equipped;
      if (!silent) showArmoryNotification('🛡️ ' + data.message, 'info');

      await loadArmoryData(sys);
      renderArmoryGrid();
      applyEquippedDecorations(sys);

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
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

  /**
   * Effect Dispatcher: Applies active decorations across the entire page
   */
  function applyEquippedDecorations(system) {
    var sys = (system || window.currentGameSystem || '40k').toLowerCase();
    var allEq = currentVault.equipped || {};
    var eq = (allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : allEq;

    // 1. Apply Card Frame
    var frameId = eq.active_card_frame;
    var allFrames = [
      'frame-astral-holofoil', 'frame-molten-core', 'frame-cyber-matrix',
      'frame-warp-corruption', 'frame-realm-chamon', 'frame-ghur-feral',
      'frame-shyish-obsidian', 'frame-hysh-celestial',
      'frame-peak-veteran', 'frame-peak-captain', 'frame-peak-commander',
      'frame-peak-dark-angels', 'frame-peak-necrons', 'frame-peak-grand-marshal',
      'frame-peak-high-warlord', 'frame-peak-warmaster', 'frame-peak-primarch',
      'frame-peak-everchosen'
    ];
    var heroCards = document.querySelectorAll('.hero-card, .profile-hero-card, #my-hub-hero-card');
    heroCards.forEach(function(card) {
      allFrames.forEach(function(f) { card.classList.remove(f); });
      Array.from(card.classList).forEach(function(c) {
        if (c.startsWith('frame-')) card.classList.remove(c);
      });
      if (frameId) {
        var item = currentCatalog && currentCatalog.items ? currentCatalog.items.find(function(i) { return i.id === frameId; }) : null;
        var cssCls = item && item.payload ? item.payload.css_class : frameId;
        if (cssCls) card.classList.add(cssCls);
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
        var tText = tItem && tItem.payload ? tItem.payload.title_text : (tItem ? tItem.name : 'The Unbroken');
        var tClass = tItem && tItem.payload ? tItem.payload.css_class : 'title-badge-unbroken';
        el.innerHTML = '<span class="armory-title-chip ' + escapeHtml(tClass) + '"><span class="title-chip-icon">🏷️</span> ' + escapeHtml(tText.toUpperCase()) + '</span>';
        el.style.display = 'inline-flex';
      }
    });

    // 3. Render Equipped Faction Avatar (Replaces the icon next to player name!)
    var avatarId = eq.active_avatar;
    var avatarSlots = document.querySelectorAll('.hero-avatar-sigil-slot');
    var defaultIcons = document.querySelectorAll('.hero-crest-default-icon');
    var rankCrests = document.querySelectorAll('.profile-rank-crest');
    if (!avatarId) {
      avatarSlots.forEach(function(el) { el.innerHTML = ''; el.style.display = 'none'; });
      defaultIcons.forEach(function(el) { el.style.display = ''; });
      rankCrests.forEach(function(c) {
        c.style.borderColor = '';
        c.style.boxShadow = '';
      });
    } else {
      var svgCode = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(avatarId) : '';
      var aItem = currentCatalog && currentCatalog.items ? currentCatalog.items.find(function(i) { return i.id === avatarId; }) : null;
      var aColor = aItem && aItem.payload ? aItem.payload.badge_color : '#38bdf8';
      var aFaction = aItem && aItem.payload ? aItem.payload.faction : 'Faction';
      avatarSlots.forEach(function(el) {
        if (svgCode) {
          el.innerHTML = svgCode;
        } else {
          var aIcon = aItem && aItem.payload ? aItem.payload.avatar_icon : (aItem ? aItem.icon : '🛡️');
          el.innerHTML = '<span class="armory-avatar-sigil" style="font-size: 2rem; filter: drop-shadow(0 0 10px ' + aColor + ');">' + aIcon + '</span>';
        }
        el.style.display = 'flex';
      });
      defaultIcons.forEach(function(el) { el.style.display = 'none'; });
      rankCrests.forEach(function(c) {
        c.style.borderColor = aColor;
        c.style.boxShadow = '0 0 20px ' + aColor + '55, inset 0 0 14px ' + aColor + '22';
      });
    }

    // 4. Dispatch Event for Live Tracker Dice Tray
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
    if (balEl) balEl.textContent = Number(currentGlory.spendable_glory || 0).toLocaleString();
    var spentEl = document.getElementById('armory-total-spent-val');
    if (spentEl) spentEl.textContent = Number(currentGlory.glory_spent || 0).toLocaleString();
    var subEl = document.getElementById('armory-glory-breakdown-sub');
    if (subEl) {
      if (currentGlory.glory_40k || currentGlory.glory_aos) {
        subEl.textContent = '(' + Number(currentGlory.glory_40k || 0).toLocaleString() + ' 40K + ' + Number(currentGlory.glory_aos || 0).toLocaleString() + ' AoS)';
      } else {
        subEl.textContent = '';
      }
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

    var items = currentCatalog.items.filter(function(item) {
      if (activeWingFilter === 'all') return true;
      return item.wing === activeWingFilter;
    });

    if (items.length === 0) {
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
            '<button type="button" class="btn armory-action-btn btn-equipped" onclick="window.Armory.unequipSlot(\'' + item.slot + '\')">',
            '  <span>✓ Equipped</span>',
            '  <span style="font-size: 0.72rem; opacity: 0.7;">(Click to Unequip)</span>',
            '</button>'
          ].join('');
        } else {
          actionBtnHtml = [
            '<button type="button" class="btn armory-action-btn btn-equip" onclick="window.Armory.equipItem(\'' + item.slot + '\', \'' + item.id + '\')">',
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

    container.innerHTML = cardsHtml;
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
      '        <span class="armory-wallet-lbl">Unified Glory</span>',
      '        <span class="armory-wallet-sub" id="armory-glory-breakdown-sub" style="font-size: 0.65rem; color: #94a3b8; font-family: var(--font-mono, monospace);"></span>',
      '      </div>',
      '      <div class="armory-wallet-stat desktop-only">',
      '        <span class="armory-wallet-val text-muted" id="armory-total-spent-val">0</span>',
      '        <span class="armory-wallet-lbl">Requisitioned</span>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="modal-close" onclick="window.Armory.closeArmoryModal()" aria-label="Close">✕</button>',
      '  </div>',
      '  <!-- Wing Filter Nav Tabs -->',
      '  <div class="armory-wings-bar">',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'all' ? 'active' : '') + '" data-wing="all" onclick="window.Armory.setWingFilter(\'all\')">',
      '      <span>🌐</span> All Wings',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'dice_forge' ? 'active' : '') + '" data-wing="dice_forge" onclick="window.Armory.setWingFilter(\'dice_forge\')">',
      '      <span>🎲</span> Dice Forge',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'profile_forge' ? 'active' : '') + '" data-wing="profile_forge" onclick="window.Armory.setWingFilter(\'profile_forge\')">',
      '      <span>✨</span> Profile Forge',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'avatars' ? 'active' : '') + '" data-wing="avatars" onclick="window.Armory.setWingFilter(\'avatars\')">',
      '      <span>👤</span> Faction Sigils',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'titles' ? 'active' : '') + '" data-wing="titles" onclick="window.Armory.setWingFilter(\'titles\')">',
      '      <span>🏷️</span> Titles',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'pokes' ? 'active' : '') + '" data-wing="pokes" onclick="window.Armory.setWingFilter(\'pokes\')">',
      '      <span>👉</span> Player Pokes',
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
    pokePlayer: pokePlayer,
    openPokeRivalModal: openPokeRivalModal,
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
      if (!id || !catalog) return null;
      for (var i = 0; i < catalog.length; i++) {
        if (catalog[i].id === id) return catalog[i];
      }
      return null;
    },
    getVault: function() { return currentVault; },
    getGlory: function() { return currentGlory; }
  };

  // Auto-init decorations when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      loadArmoryData().then(applyEquippedDecorations);
    });
  } else {
    loadArmoryData().then(applyEquippedDecorations);
  }

})(window);
