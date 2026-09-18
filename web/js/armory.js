/**
 * OmniTactica Retribution Armory
 * Client-Side Engine, Store Modal & Effect Dispatcher
 */

(function(window) {
  'use strict';

  var currentCatalog = null;
  var currentVault = { inventory: {}, equipped: { active_dice: null, active_card_frame: null, active_title: null } };
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
   * Fetch latest catalog & user vault from server
   */
  async function loadArmoryData() {
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      var res = await fetch('/api/armory/catalog', { headers: headers });
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
        updateArmoryHeaderBalance();
      }

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
  async function equipItem(slot, itemId, silent) {
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/equip', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ slot: slot, item_id: itemId })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to equip item');

      currentVault.equipped = data.equipped;
      if (!silent) showArmoryNotification('⚔️ ' + data.message, 'success');

      await loadArmoryData();
      renderArmoryGrid();
      applyEquippedDecorations();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
    }
  }

  /**
   * Unequip an item slot back to default
   */
  async function unequipSlot(slot) {
    try {
      var token = window.api ? window.api.getAuthToken() : (localStorage.getItem('auth_token') || '');
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var res = await fetch('/api/armory/unequip', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ slot: slot })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to unequip slot');

      currentVault.equipped = data.equipped;
      showArmoryNotification('🛡️ ' + data.message, 'info');

      await loadArmoryData();
      renderArmoryGrid();
      applyEquippedDecorations();

    } catch (err) {
      showArmoryNotification('❌ ' + err.message, 'error');
    }
  }

  /**
   * Effect Dispatcher: Applies active decorations across the entire page
   */
  function applyEquippedDecorations() {
    var eq = currentVault.equipped || {};

    // 1. Apply Card Frame
    var frameId = eq.active_card_frame;
    var heroCards = document.querySelectorAll('.hero-card, .profile-hero-card, #my-hub-hero-card');
    heroCards.forEach(function(card) {
      card.classList.remove('frame-astral-holofoil', 'frame-molten-core', 'frame-cyber-matrix');
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
        var tText = tItem && tItem.payload ? tItem.payload.title_text : 'The Unbroken';
        var tClass = tItem && tItem.payload ? tItem.payload.css_class : 'title-badge-unbroken';
        el.innerHTML = '<span class="armory-title-chip ' + escapeHtml(tClass) + '"><span class="title-chip-icon">🏷️</span> ' + escapeHtml(tText.toUpperCase()) + '</span>';
        el.style.display = 'inline-flex';
      }
    });

    // 3. Dispatch Event for Live Tracker Dice Tray
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
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 2.5rem;">No requisitions available in this wing.</div>';
      return;
    }

    var rarities = currentCatalog.rarity_config || {};

    var cardsHtml = items.map(function(item) {
      var rMeta = rarities[item.rarity] || { label: item.rarity, color: '#94a3b8', badge_bg: 'rgba(255,255,255,0.06)' };
      var isOwned = !!item.is_owned;
      var isEquipped = !!item.is_equipped;
      var meetsPrereq = item.meets_prerequisite !== false;
      var affordable = (currentGlory.spendable_glory || 0) >= item.cost_glory;

      // Card action button state
      var actionBtnHtml = '';
      if (item.is_consumable) {
        var charges = item.charges_remaining || 0;
        var chargesBadge = isOwned ? '<div class="armory-charges-badge"><span>Stock: ' + charges + '</span></div>' : '';
        actionBtnHtml = [
          chargesBadge,
          '<button type="button" id="armory-buy-btn-' + item.id + '" class="btn armory-action-btn btn-buy ' + (affordable ? 'affordable' : 'unaffordable') + '" ',
          '        onclick="window.Armory.purchaseItem(\'' + item.id + '\')" ' + (!affordable ? 'disabled' : '') + '>',
          '  <span>' + (isOwned ? '+ Requisition More' : 'Requisition') + '</span>',
          '  <span class="armory-btn-cost">💰 ' + item.cost_glory + '</span>',
          '</button>'
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
      } else if (item.wing === 'profile_forge') {
        var glow = item.payload && item.payload.border_glow ? item.payload.border_glow : 'none';
        var cls = item.payload && item.payload.css_class ? item.payload.css_class : '';
        previewGraphic = [
          '<div class="armory-frame-preview-tile ' + cls + '" style="box-shadow: ' + glow + ';">',
          '  <div class="preview-mini-avatar">👤</div>',
          '  <div class="preview-mini-title">TACTICA HERO</div>',
          '</div>'
        ].join('');
      } else if (item.wing === 'titles') {
        var tCls = item.payload && item.payload.css_class ? item.payload.css_class : '';
        previewGraphic = [
          '<div class="armory-title-preview-tile">',
          '  <span class="armory-title-chip ' + tCls + '">🏷️ ' + escapeHtml(item.payload.title_text || item.name) + '</span>',
          '</div>'
        ].join('');
      } else {
        previewGraphic = '<div class="armory-generic-preview-tile"><span style="font-size: 2.2rem;">' + (item.icon || '📦') + '</span></div>';
      }

      return [
        '<div class="armory-product-card rarity-' + escapeHtml(item.rarity) + (isEquipped ? ' is-equipped' : '') + '">',
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
  async function openArmoryModal(initialWing) {
    if (initialWing) activeWingFilter = initialWing;

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
      '    <div class="armory-wallet-hud">',
      '      <div class="armory-wallet-stat">',
      '        <span class="armory-wallet-val" id="armory-spendable-balance-val">--</span>',
      '        <span class="armory-wallet-lbl">Spendable Glory</span>',
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
      '      <span>🌐</span> All Requisitions',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'dice_forge' ? 'active' : '') + '" data-wing="dice_forge" onclick="window.Armory.setWingFilter(\'dice_forge\')">',
      '      <span>🎲</span> Dice Forge',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'profile_forge' ? 'active' : '') + '" data-wing="profile_forge" onclick="window.Armory.setWingFilter(\'profile_forge\')">',
      '      <span>✨</span> Profile Forge',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'titles' ? 'active' : '') + '" data-wing="titles" onclick="window.Armory.setWingFilter(\'titles\')">',
      '      <span>🏷️</span> Titles',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'reactions' ? 'active' : '') + '" data-wing="reactions" onclick="window.Armory.setWingFilter(\'reactions\')">',
      '      <span>🫡</span> Salutes',
      '    </button>',
      '    <button type="button" class="armory-wing-pill ' + (activeWingFilter === 'oracle' ? 'active' : '') + '" data-wing="oracle" onclick="window.Armory.setWingFilter(\'oracle\')">',
      '      <span>🔮</span> GT Oracle',
      '    </button>',
      '  </div>',
      '  <!-- Products Scrollable Grid -->',
      '  <div class="armory-modal-body">',
      '    <div id="armory-products-grid" class="armory-grid"></div>',
      '  </div>',
      '  <!-- Footer -->',
      '  <div class="armory-modal-footer">',
      '    <span class="armory-footer-notice">Glory Honor is earned through verified tournament matches &amp; annual campaigns. Zero real-world cash gambling.</span>',
      '    <button type="button" class="btn btn-secondary" onclick="window.Armory.closeArmoryModal()">Return to Fleet</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(modal);

    // Load data and render
    await loadArmoryData();
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
    openArmoryModal: openArmoryModal,
    closeArmoryModal: closeArmoryModal,
    setWingFilter: setWingFilter,
    purchaseItem: purchaseItem,
    equipItem: equipItem,
    unequipSlot: unequipSlot,
    applyEquippedDecorations: applyEquippedDecorations,
    getEquipped: function(slot) { return (currentVault.equipped || {})[slot]; },
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
