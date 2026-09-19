/**
 * OmniTactica Retribution Armory
 * Authentic Warhammer 40,000 & Age of Sigmar Faction SVG Emblems
 */

(function(window) {
  "use strict";

  var FACTION_SVGS = {};
  FACTION_SVGS["avatar_dark_angels"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-dark-angels">
  <defs>
    <radialGradient id="da-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.6"/>
      <stop offset="60%" stop-color="#064e3b" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#022c22" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="da-blade" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="50%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
    <linearGradient id="da-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#a16207"/>
    </linearGradient>
    <linearGradient id="da-wing-left" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="50%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <linearGradient id="da-wing-right" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="50%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#da-glow)"/>
  <!-- Left Angel Wing -->
  <path d="M46 38 C40 22 25 15 12 20 C18 28 25 32 30 38 C20 34 14 38 10 44 C18 48 24 51 32 54 C20 52 14 58 12 66 C20 67 28 66 38 64 C30 67 22 74 20 82 C30 79 38 72 44 64 Z" fill="url(#da-wing-left)" stroke="#022c22" stroke-width="1.2"/>
  <path d="M46 42 C38 28 28 24 16 26 M44 50 C34 42 26 42 16 48 M42 58 C34 54 26 56 20 66" stroke="#6ee7b7" stroke-width="0.8" fill="none"/>
  <!-- Right Angel Wing -->
  <path d="M54 38 C60 22 75 15 88 20 C82 28 75 32 70 38 C80 34 86 38 90 44 C82 48 76 51 68 54 C80 52 86 58 88 66 C80 67 72 66 62 64 C70 67 78 74 80 82 C70 79 62 72 56 64 Z" fill="url(#da-wing-right)" stroke="#022c22" stroke-width="1.2"/>
  <path d="M54 42 C62 28 72 24 84 26 M56 50 C66 42 74 42 84 48 M58 58 C66 54 74 56 80 66" stroke="#6ee7b7" stroke-width="0.8" fill="none"/>
  <!-- Downward Longsword Blade -->
  <path d="M47.5 28 L52.5 28 L52 76 L50 88 L48 76 Z" fill="url(#da-blade)" stroke="#334155" stroke-width="1"/>
  <line x1="50" y1="29" x2="50" y2="78" stroke="#f1f5f9" stroke-width="0.9"/>
  <!-- Crossguard -->
  <path d="M35 27 C35 24 65 24 65 27 L63 32 L37 32 Z" fill="url(#da-gold)" stroke="#78350f" stroke-width="1"/>
  <circle cx="37" cy="29.5" r="2" fill="#fef08a"/>
  <circle cx="63" cy="29.5" r="2" fill="#fef08a"/>
  <!-- Hilt Grip -->
  <rect x="48.5" y="16" width="3" height="11" fill="#78350f" rx="1"/>
  <line x1="48.5" y1="19" x2="51.5" y2="19" stroke="#fbbf24" stroke-width="0.8"/>
  <line x1="48.5" y1="22" x2="51.5" y2="22" stroke="#fbbf24" stroke-width="0.8"/>
  <!-- Skull Pommel -->
  <circle cx="50" cy="14" r="4.5" fill="url(#da-gold)" stroke="#78350f" stroke-width="1"/>
  <circle cx="50" cy="14" r="2" fill="#10b981"/>
</svg>`;
  FACTION_SVGS["avatar_necrons"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-necrons">
  <defs>
    <radialGradient id="nec-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.8"/>
      <stop offset="40%" stop-color="#10b981" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#022c22" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="nec-metal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#nec-core)"/>
  <!-- Outer Dynastic Cartouche -->
  <polygon points="50,6 88,24 88,76 50,94 12,76 12,24" fill="url(#nec-metal)" stroke="#10b981" stroke-width="2.2" stroke-linejoin="round"/>
  <!-- Inner Glyphs & Circuit Lines -->
  <polygon points="50,14 80,29 80,71 50,86 20,71 20,29" fill="none" stroke="#059669" stroke-width="1" stroke-dasharray="6,3"/>
  <!-- Ankh of the Triarch -->
  <!-- Upper Loop -->
  <path d="M50 20 C40 20 38 34 46 38 C48 39 52 39 54 38 C62 34 60 20 50 20 Z M50 25 C54 25 55 31 51 33 C49 34 47 33 46 31 C45 28 47 25 50 25 Z" fill="#34d399" stroke="#6ee7b7" stroke-width="0.8"/>
  <!-- Stepped Crossbar -->
  <path d="M28 42 L72 42 L68 47 L56 47 L56 50 L44 50 L44 47 L32 47 Z" fill="#10b981" stroke="#6ee7b7" stroke-width="1"/>
  <!-- Vertical Stem with Nodes -->
  <path d="M46 50 L54 50 L52 82 L48 82 Z" fill="#10b981" stroke="#34d399" stroke-width="1"/>
  <rect x="47" y="55" width="6" height="4" fill="#a7f3d0" rx="1"/>
  <rect x="47.5" y="63" width="5" height="4" fill="#a7f3d0" rx="1"/>
  <circle cx="50" cy="74" r="2.5" fill="#a7f3d0"/>
  <!-- Dynastic Sun Rays -->
  <line x1="26" y1="28" x2="36" y2="34" stroke="#34d399" stroke-width="1.5"/>
  <line x1="74" y1="28" x2="64" y2="34" stroke="#34d399" stroke-width="1.5"/>
  <line x1="26" y1="72" x2="36" y2="66" stroke="#34d399" stroke-width="1.5"/>
  <line x1="74" y1="72" x2="64" y2="66" stroke="#34d399" stroke-width="1.5"/>
</svg>`;
  FACTION_SVGS["avatar_adeptus_astartes"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-astartes">
  <defs>
    <linearGradient id="aquila-gold" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="35%" stop-color="#eab308"/>
      <stop offset="85%" stop-color="#a16207"/>
      <stop offset="100%" stop-color="#713f12"/>
    </linearGradient>
    <radialGradient id="aquila-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#aquila-glow)"/>
  <!-- Left Wing (Sighted Imperial Head) -->
  <path d="M48 38 C42 22 28 14 10 18 C14 26 22 32 30 36 C18 35 12 40 8 48 C16 50 24 52 32 54 C20 56 14 62 12 70 C22 68 30 65 38 60 C32 66 26 73 24 82 C34 78 40 70 46 62 Z" fill="url(#aquila-gold)" stroke="#78350f" stroke-width="1.2"/>
  <!-- Right Wing (Blind Mechanical Head) -->
  <path d="M52 38 C58 22 72 14 90 18 C86 26 78 32 70 36 C82 35 88 40 92 48 C84 50 76 52 68 54 C80 56 86 62 88 70 C78 68 70 65 62 60 C68 66 74 73 76 82 C66 78 60 70 54 62 Z" fill="url(#aquila-gold)" stroke="#78350f" stroke-width="1.2"/>
  <!-- Eagle Left Head (Crowned) -->
  <path d="M48 34 C46 28 42 24 38 25 C34 26 36 29 40 30 C34 32 36 36 44 37 Z" fill="url(#aquila-gold)" stroke="#78350f" stroke-width="1"/>
  <circle cx="42" cy="27" r="1.2" fill="#fff"/>
  <!-- Eagle Right Head (Blind) -->
  <path d="M52 34 C54 28 58 24 62 25 C66 26 64 29 60 30 C66 32 64 36 56 37 Z" fill="url(#aquila-gold)" stroke="#78350f" stroke-width="1"/>
  <line x1="57" y1="26" x2="61" y2="28" stroke="#78350f" stroke-width="1"/>
  <!-- Center Skull with Crux -->
  <circle cx="50" cy="46" r="6" fill="#f8fafc" stroke="#64748b" stroke-width="1"/>
  <rect x="47" y="49" width="6" height="4.5" fill="#f8fafc" stroke="#64748b" stroke-width="0.8"/>
  <circle cx="48" cy="45.5" r="1.2" fill="#0f172a"/>
  <circle cx="52" cy="45.5" r="1.2" fill="#0f172a"/>
  <path d="M48.5 48.5 L50 47.5 L51.5 48.5 Z" fill="#0f172a"/>
  <!-- Clutched Lightning Bolts -->
  <polygon points="44,66 40,78 47,73 45,86 55,70 48,72" fill="#fef08a" stroke="#d97706" stroke-width="0.8"/>
</svg>`;
  FACTION_SVGS["avatar_chaos_space_marines"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-chaos">
  <defs>
    <radialGradient id="chaos-flame" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#7f1d1d" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#180505" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="chaos-iron" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#b91c1c"/>
      <stop offset="50%" stop-color="#7f1d1d"/>
      <stop offset="100%" stop-color="#450a0a"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#chaos-flame)"/>
  <!-- Inner Ring -->
  <circle cx="50" cy="50" r="22" fill="none" stroke="#ef4444" stroke-width="2.5"/>
  <circle cx="50" cy="50" r="18" fill="none" stroke="#7f1d1d" stroke-width="1.2" stroke-dasharray="4,2"/>
  <!-- 8 Barbed Star Points (N, NE, E, SE, S, SW, W, NW) -->
  <!-- North -->
  <polygon points="50,8 45,24 48,22 48,34 52,34 52,22 55,24" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- South -->
  <polygon points="50,92 45,76 48,78 48,66 52,66 52,78 55,76" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- East -->
  <polygon points="92,50 76,45 78,48 66,48 66,52 78,52 76,55" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- West -->
  <polygon points="8,50 24,45 22,48 34,48 34,52 22,52 24,55" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- NE -->
  <polygon points="80,20 68,30 70,33 60,39 63,42 73,36 75,39" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- NW -->
  <polygon points="20,20 32,30 30,33 40,39 37,42 27,36 25,39" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- SE -->
  <polygon points="80,80 68,70 70,67 60,61 63,58 73,64 75,61" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- SW -->
  <polygon points="20,80 32,70 30,67 40,61 37,58 27,64 25,61" fill="url(#chaos-iron)" stroke="#f87171" stroke-width="0.8"/>
  <!-- Center Horned Daemon Skull -->
  <path d="M42 42 C38 34 32 32 28 34 C26 38 32 44 38 46 M58 42 C62 34 68 32 72 34 C74 38 68 44 62 46" stroke="#fca5a5" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <circle cx="50" cy="50" r="10" fill="#1e1b4b" stroke="#ef4444" stroke-width="1.5"/>
  <circle cx="46.5" cy="48" r="2.2" fill="#ef4444"/>
  <circle cx="53.5" cy="48" r="2.2" fill="#ef4444"/>
  <circle cx="46.5" cy="48" r="0.8" fill="#fef08a"/>
  <circle cx="53.5" cy="48" r="0.8" fill="#fef08a"/>
  <polygon points="50,52 48,55 52,55" fill="#ef4444"/>
  <line x1="46" y1="58" x2="54" y2="58" stroke="#ef4444" stroke-width="1.2"/>
</svg>`;
  FACTION_SVGS["avatar_orks"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-orks">
  <defs>
    <radialGradient id="ork-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#22c55e" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#15803d" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="iron-jaw" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#64748b"/>
      <stop offset="50%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ork-glow)"/>
  <!-- Ork Skull Base -->
  <path d="M26 36 C24 20 40 14 50 14 C60 14 76 20 74 36 C76 46 70 54 66 58 L34 58 C30 54 24 46 26 36 Z" fill="#15803d" stroke="#14532d" stroke-width="2"/>
  <!-- Pointed Goblinoid Ears -->
  <polygon points="26,38 12,32 24,46" fill="#16a34a" stroke="#14532d" stroke-width="1.2"/>
  <polygon points="74,38 88,32 76,46" fill="#16a34a" stroke="#14532d" stroke-width="1.2"/>
  <!-- Heavy Brow Ridge -->
  <path d="M28 34 C36 38 44 38 50 36 C56 38 64 38 72 34 L70 40 C62 44 54 44 50 42 C46 44 38 44 30 40 Z" fill="#14532d"/>
  <!-- Red Go Fasta Eye Warpaint -->
  <polygon points="28,26 46,38 42,46 24,34" fill="#dc2626" opacity="0.85"/>
  <!-- Glowing Vicious Red Eyes -->
  <circle cx="38" cy="40" r="3.5" fill="#ef4444"/>
  <circle cx="62" cy="40" r="3.5" fill="#ef4444"/>
  <circle cx="38" cy="40" r="1.2" fill="#fef08a"/>
  <circle cx="62" cy="40" r="1.2" fill="#fef08a"/>
  <!-- Snout Nostril Slits -->
  <line x1="47" y1="48" x2="45" y2="52" stroke="#14532d" stroke-width="2"/>
  <line x1="53" y1="48" x2="55" y2="52" stroke="#14532d" stroke-width="2"/>
  <!-- The Brutal Iron Gob (Welded Jaw Plate) -->
  <polygon points="22,54 78,54 74,86 50,92 26,86" fill="url(#iron-jaw)" stroke="#94a3b8" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- Steel Rivets -->
  <circle cx="26" cy="58" r="1.8" fill="#cbd5e1"/>
  <circle cx="74" cy="58" r="1.8" fill="#cbd5e1"/>
  <circle cx="30" cy="82" r="1.8" fill="#cbd5e1"/>
  <circle cx="70" cy="82" r="1.8" fill="#cbd5e1"/>
  <circle cx="50" cy="88" r="1.8" fill="#cbd5e1"/>
  <!-- Jagged Metal Teeth Jutting Upwards -->
  <polygon points="32,66 36,54 40,66" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <polygon points="42,70 46,52 50,70" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <polygon points="50,70 54,52 58,70" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <polygon points="60,66 64,54 68,66" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
</svg>`;
  FACTION_SVGS["avatar_black_templars"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-black-templars">
  <defs>
    <radialGradient id="bt-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.3"/>
      <stop offset="80%" stop-color="#64748b" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#bt-glow)"/>
  <!-- Maltese Crusader Cross -->
  <path d="M50 12 L59 35 L76 18 L65 41 L88 50 L65 59 L76 82 L59 65 L50 88 L41 65 L24 82 L35 59 L12 50 L35 41 L24 18 L41 35 Z" fill="#090d16" stroke="#f8fafc" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- Inner Cross Lines -->
  <path d="M50 20 L56 38 L70 24 L60 43 L79 50 L60 57 L70 76 L56 62 L50 80 L44 62 L30 76 L40 57 L21 50 L40 43 L30 24 L44 38 Z" fill="#0f172a" stroke="#cbd5e1" stroke-width="0.8"/>
  <!-- Corner Holy Rivets -->
  <circle cx="50" cy="30" r="1.5" fill="#f8fafc"/>
  <circle cx="50" cy="70" r="1.5" fill="#f8fafc"/>
  <circle cx="30" cy="50" r="1.5" fill="#f8fafc"/>
  <circle cx="70" cy="50" r="1.5" fill="#f8fafc"/>
  <!-- Center Skull Relic -->
  <circle cx="50" cy="50" r="6" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>
  <rect x="47.5" y="53" width="5" height="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.8"/>
  <circle cx="48" cy="49" r="1.2" fill="#0f172a"/>
  <circle cx="52" cy="49" r="1.2" fill="#0f172a"/>
</svg>`;
  FACTION_SVGS["avatar_blood_angels"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-blood-angels">
  <defs>
    <radialGradient id="ba-ruby" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#fda4af"/>
      <stop offset="30%" stop-color="#f43f5e"/>
      <stop offset="70%" stop-color="#be123c"/>
      <stop offset="100%" stop-color="#4c0519"/>
    </radialGradient>
    <linearGradient id="ba-wings" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#854d0e"/>
    </linearGradient>
  </defs>
  <!-- Left Angel Wing -->
  <path d="M48 40 C38 20 22 14 8 18 C14 26 22 30 28 36 C16 34 10 38 6 46 C14 48 22 50 28 54 C18 56 12 62 10 70 C20 68 28 64 36 58 C30 64 24 72 22 80 C32 76 38 68 44 58 Z" fill="url(#ba-wings)" stroke="#78350f" stroke-width="1.2"/>
  <!-- Right Angel Wing -->
  <path d="M52 40 C62 20 78 14 92 18 C86 26 78 30 72 36 C84 34 90 38 94 46 C86 48 78 50 72 54 C82 56 88 62 90 70 C80 68 72 64 64 58 C70 64 76 72 78 80 C68 76 62 68 56 58 Z" fill="url(#ba-wings)" stroke="#78350f" stroke-width="1.2"/>
  <!-- Center Faceted Ruby Blood Drop -->
  <path d="M50 26 C50 26 34 50 34 64 C34 74 41 82 50 82 C59 82 66 74 66 64 C66 50 50 26 50 26 Z" fill="url(#ba-ruby)" stroke="#9f1239" stroke-width="1.5"/>
  <!-- Gem Facet Reflections -->
  <path d="M50 28 L40 56 L50 78 L60 56 Z" fill="none" stroke="#fecdd3" stroke-width="0.8" opacity="0.75"/>
  <circle cx="45" cy="50" r="3" fill="#fff" opacity="0.4"/>
</svg>`;
  FACTION_SVGS["avatar_space_wolves"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-space-wolves">
  <defs>
    <radialGradient id="sw-frost" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#0284c7" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#082f49" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sw-slate" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#475569"/>
      <stop offset="50%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sw-frost)"/>
  <!-- Roaring Dire Wolf Silhouette Profile -->
  <path d="M22 66 C20 54 26 42 34 32 C38 22 42 16 46 12 C48 18 48 24 46 28 C52 24 58 18 64 12 C62 20 60 26 56 32 C66 30 76 26 84 22 C78 30 74 36 66 40 C76 42 84 46 88 52 C80 54 72 54 64 52 L56 56 C64 58 72 62 76 68 C68 68 60 66 54 62 L46 66 C52 70 58 76 62 84 C52 82 44 76 38 68 C32 76 26 82 18 86 C22 78 22 72 22 66 Z" fill="url(#sw-slate)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/>
  <!-- Sharp Bared Fangs -->
  <polygon points="62,44 66,50 64,44" fill="#f8fafc"/>
  <polygon points="58,45 60,51 60,45" fill="#f8fafc"/>
  <!-- Piercing Ice-Blue Eye -->
  <polygon points="46,36 52,38 48,40" fill="#38bdf8"/>
  <circle cx="48" cy="38" r="1.5" fill="#f0f9ff"/>
</svg>`;
  FACTION_SVGS["avatar_adeptus_custodes"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-custodes">
  <defs>
    <radialGradient id="cust-sun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fef08a" stop-opacity="0.8"/>
      <stop offset="40%" stop-color="#eab308" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#713f12" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cust-auramite" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef9c3"/>
      <stop offset="40%" stop-color="#facc15"/>
      <stop offset="80%" stop-color="#ca8a04"/>
      <stop offset="100%" stop-color="#854d0e"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#cust-sun)"/>
  <!-- Solar Sunburst Rays Behind -->
  <g stroke="#fde047" stroke-width="1.2" opacity="0.75">
    <line x1="50" y1="6" x2="50" y2="18"/>
    <line x1="50" y1="82" x2="50" y2="94"/>
    <line x1="6" y1="50" x2="18" y2="50"/>
    <line x1="82" y1="50" x2="94" y2="50"/>
    <line x1="18" y1="18" x2="28" y2="28"/>
    <line x1="72" y1="72" x2="82" y2="82"/>
    <line x1="82" y1="18" x2="72" y2="28"/>
    <line x1="18" y1="82" x2="28" y2="72"/>
  </g>
  <!-- Auramite Raptor Head & Chestplate -->
  <path d="M50 20 C36 20 28 32 26 46 C24 64 36 82 50 86 C64 82 76 64 74 46 C72 32 64 20 50 20 Z" fill="url(#cust-auramite)" stroke="#78350f" stroke-width="2"/>
  <!-- Majestic Eagle Profile Head -->
  <path d="M42 34 C44 26 56 24 64 28 C72 32 74 40 68 44 C64 46 62 44 60 42 C56 46 48 46 44 40 Z" fill="#fef08a" stroke="#a16207" stroke-width="1"/>
  <!-- Hooked Auramite Beak -->
  <path d="M68 36 C76 38 80 44 74 48 C72 46 70 44 66 43 Z" fill="#ca8a04"/>
  <circle cx="56" cy="32" r="2" fill="#dc2626"/>
  <!-- Lightning Bundles -->
  <polygon points="46,54 36,68 44,66 40,78 54,62 46,64" fill="#fef08a" stroke="#ca8a04" stroke-width="1"/>
</svg>`;
  FACTION_SVGS["avatar_adeptus_mechanicus"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-admech">
  <defs>
    <radialGradient id="admech-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.6"/>
      <stop offset="80%" stop-color="#991b1b" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#admech-glow)"/>
  <!-- 16-Toothed Cog Wheel -->
  <!-- Red Left Half / White Right Half -->
  <circle cx="50" cy="50" r="38" fill="#991b1b" stroke="#7f1d1d" stroke-width="2"/>
  <path d="M50 12 A38 38 0 0 1 50 88 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <!-- Central Split Opus Machina Skull -->
  <circle cx="50" cy="50" r="20" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
  <!-- Flesh Left Half -->
  <path d="M50 34 C42 34 38 40 38 50 C38 60 42 66 50 66 Z" fill="#f1f5f9"/>
  <circle cx="45" cy="48" r="2.5" fill="#0f172a"/>
  <!-- Bionic Iron Right Half -->
  <path d="M50 34 C58 34 62 40 62 50 C62 60 58 66 50 66 Z" fill="#334155"/>
  <circle cx="55" cy="48" r="3.2" fill="#ef4444" stroke="#fca5a5" stroke-width="0.8"/>
  <circle cx="55" cy="48" r="1" fill="#fff"/>
  <line x1="50" y1="34" x2="50" y2="66" stroke="#ef4444" stroke-width="1.5"/>
</svg>`;
  FACTION_SVGS["avatar_tyranids"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-tyranids">
  <defs>
    <radialGradient id="tyr-synapse" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#7e22ce" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#2e1065" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tyr-chitin" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#581c87"/>
      <stop offset="50%" stop-color="#3b0764"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#tyr-synapse)"/>
  <!-- Outer Chitinous Synapse Horns -->
  <path d="M50 14 C36 14 22 28 16 46 C24 44 32 46 36 54 C32 42 40 28 50 26 C60 28 68 42 64 54 C68 46 76 44 84 46 C78 28 64 14 50 14 Z" fill="url(#tyr-chitin)" stroke="#a855f7" stroke-width="1.8"/>
  <!-- Central Bio-Carapace Plate -->
  <path d="M50 28 C42 28 34 38 34 52 C34 68 44 84 50 88 C56 84 66 68 66 52 C66 38 58 28 50 28 Z" fill="#3b0764" stroke="#c084fc" stroke-width="1.5"/>
  <!-- Glowing Synapse Brain Ridges -->
  <path d="M42 44 C46 42 54 42 58 44 M40 52 C46 50 54 50 60 52 M42 60 C46 58 54 58 58 60 M44 68 C48 66 52 66 56 68" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
  <!-- Bio-Venom Glands -->
  <circle cx="50" cy="36" r="3.5" fill="#4ade80"/>
  <circle cx="50" cy="36" r="1.5" fill="#fef08a"/>
</svg>`;
  FACTION_SVGS["avatar_tau_empire"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-tau">
  <defs>
    <radialGradient id="tau-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ea580c" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#9a3412" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#tau-glow)"/>
  <!-- Outer Segmented Caste Ring -->
  <circle cx="50" cy="50" r="36" fill="none" stroke="#f8fafc" stroke-width="6"/>
  <circle cx="50" cy="50" r="36" fill="none" stroke="#ea580c" stroke-width="6" stroke-dasharray="35 15 20 15"/>
  <!-- Precision Aerodynamic Cutouts -->
  <circle cx="50" cy="50" r="22" fill="#0f172a" stroke="#ea580c" stroke-width="3"/>
  <!-- Center Core Caste Disc -->
  <circle cx="50" cy="50" r="12" fill="#f8fafc"/>
  <circle cx="50" cy="50" r="6" fill="#ea580c"/>
  <!-- Horizontal Horizon Indicator Line -->
  <line x1="20" y1="50" x2="38" y2="50" stroke="#f8fafc" stroke-width="3"/>
  <line x1="62" y1="50" x2="80" y2="50" stroke="#f8fafc" stroke-width="3"/>
</svg>`;
  FACTION_SVGS["avatar_aeldari"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-aeldari">
  <defs>
    <radialGradient id="ael-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.7"/>
      <stop offset="60%" stop-color="#0284c7" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ael-bone" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="50%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ael-glow)"/>
  <!-- Psychoplastic Wraithbone Rune of Isha / Ulthwe -->
  <path d="M50 12 C32 12 24 28 24 44 C24 64 38 82 50 88 C62 82 76 64 76 44 C76 28 68 12 50 12 Z M50 20 C62 20 68 32 68 44 C68 60 58 74 50 80 C42 74 32 60 32 44 C32 32 38 20 50 20 Z" fill="url(#ael-bone)" stroke="#38bdf8" stroke-width="1.8"/>
  <!-- Curved Upper Antlers / Horns -->
  <path d="M30 32 C18 24 16 12 22 8 C26 14 32 20 38 24 M70 32 C82 24 84 12 78 8 C74 14 68 20 62 24" stroke="url(#ael-bone)" stroke-width="3" stroke-linecap="round" fill="none"/>
  <!-- Central Radiant Spirit Stone Gem -->
  <path d="M50 36 C44 42 42 50 46 56 C50 62 54 58 56 52 C58 46 56 38 50 36 Z" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5"/>
  <circle cx="48" cy="46" r="2" fill="#e0f2fe"/>
</svg>`;
  FACTION_SVGS["avatar_death_guard"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-death-guard">
  <defs>
    <radialGradient id="dg-rot" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#84cc16" stop-opacity="0.7"/>
      <stop offset="60%" stop-color="#4d7c0f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#14532d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="dg-bronze" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a16207"/>
      <stop offset="50%" stop-color="#713f12"/>
      <stop offset="100%" stop-color="#3f2305"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#dg-rot)"/>
  <!-- Mark III Corroded Helm Silhouette -->
  <path d="M32 40 C32 26 42 22 50 22 C58 22 68 26 68 40 L70 66 C70 78 58 84 50 86 C42 84 30 78 30 66 Z" fill="url(#dg-bronze)" stroke="#4d7c0f" stroke-width="2"/>
  <!-- Mutated Calcified Horn -->
  <path d="M50 22 C50 14 54 8 62 6 C58 14 56 18 52 24 Z" fill="#84cc16" stroke="#365314" stroke-width="1"/>
  <!-- Narrow Mark III Eye Slit (Glowing Toxic Orange) -->
  <polygon points="36,46 64,46 62,50 38,50" fill="#f97316" stroke="#ea580c" stroke-width="1"/>
  <!-- Nurgle Tri-Lobe Spheres -->
  <circle cx="50" cy="62" r="5" fill="#65a30d" stroke="#365314" stroke-width="1.2"/>
  <circle cx="42" cy="74" r="5" fill="#65a30d" stroke="#365314" stroke-width="1.2"/>
  <circle cx="58" cy="74" r="5" fill="#65a30d" stroke="#365314" stroke-width="1.2"/>
</svg>`;
  FACTION_SVGS["avatar_stormcast_eternals"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-stormcast">
  <defs>
    <radialGradient id="se-azyr" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#1e3a8a" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="se-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#a16207"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#se-azyr)"/>
  <!-- Twin Comet Tails -->
  <path d="M50 14 C44 26 24 48 18 78 C26 72 36 64 42 54 M50 14 C56 26 76 48 82 78 C74 72 64 64 58 54" stroke="#60a5fa" stroke-width="3" stroke-linecap="round" fill="none"/>
  <!-- Comet Core Star -->
  <polygon points="50,8 54,20 66,22 56,30 58,42 50,34 42,42 44,30 34,22 46,20" fill="url(#se-gold)" stroke="#78350f" stroke-width="1.2"/>
  <!-- Crossed Ghal Maraz Warhammers -->
  <g stroke="url(#se-gold)" stroke-width="2.5" stroke-linecap="round">
    <line x1="28" y1="36" x2="72" y2="80"/>
    <line x1="72" y1="36" x2="28" y2="80"/>
  </g>
  <rect x="24" y="32" width="10" height="7" fill="#fef08a" stroke="#a16207" stroke-width="1"/>
  <rect x="66" y="32" width="10" height="7" fill="#fef08a" stroke="#a16207" stroke-width="1"/>
</svg>`;
  FACTION_SVGS["avatar_khorne_bloodbound"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-khorne">
  <defs>
    <radialGradient id="kh-blood" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.8"/>
      <stop offset="70%" stop-color="#7f1d1d" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="kh-brass" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="50%" stop-color="#b45309"/>
      <stop offset="100%" stop-color="#78350f"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#kh-blood)"/>
  <!-- 8-Cut Brass Skull Rune of Khorne -->
  <polygon points="50,14 68,32 60,40 50,30 40,40 32,32" fill="url(#kh-brass)" stroke="#ef4444" stroke-width="1.8"/>
  <polygon points="26,38 36,48 24,60 14,50" fill="url(#kh-brass)" stroke="#ef4444" stroke-width="1.8"/>
  <polygon points="74,38 86,50 76,60 64,48" fill="url(#kh-brass)" stroke="#ef4444" stroke-width="1.8"/>
  <!-- Central Skull Cutout Bar -->
  <path d="M34 52 L66 52 L62 82 L50 88 L38 82 Z" fill="url(#kh-brass)" stroke="#ef4444" stroke-width="2"/>
  <!-- Fanged Skull Face Cavities -->
  <circle cx="44" cy="62" r="3.5" fill="#450a0a"/>
  <circle cx="56" cy="62" r="3.5" fill="#450a0a"/>
  <polygon points="50,68 46,74 54,74" fill="#450a0a"/>
</svg>`;
  FACTION_SVGS["avatar_gloomspite_gitz"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-gloomspite">
  <defs>
    <radialGradient id="gm-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#facc15" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#ca8a04" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#713f12" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#gm-glow)"/>
  <!-- Crescent Bad Moon Profile with Hooked Nose -->
  <path d="M68 12 C40 16 22 38 24 66 C26 84 42 94 62 92 C42 86 36 68 38 52 C38 48 34 46 28 44 C36 42 42 40 44 32 C48 22 56 16 68 12 Z" fill="#facc15" stroke="#ca8a04" stroke-width="2.5" stroke-linejoin="round"/>
  <!-- Hooked Crooked Nose -->
  <path d="M32 44 C22 42 16 46 12 48 C18 52 24 52 30 50 Z" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>
  <!-- Sinister Squinting Eye -->
  <path d="M40 32 C46 30 52 34 50 38 C46 38 42 36 40 32 Z" fill="#713f12"/>
  <circle cx="46" cy="34" r="1.5" fill="#ef4444"/>
  <!-- Jagged Grot Smile -->
  <path d="M36 58 C42 66 52 68 60 66 L56 62 L50 64 L46 60 L42 62 Z" fill="#713f12" stroke="#ca8a04" stroke-width="1.2"/>
  <!-- Lunar Craters -->
  <circle cx="56" cy="24" r="3" fill="#eab308" opacity="0.6"/>
  <circle cx="48" cy="76" r="4" fill="#eab308" opacity="0.6"/>
</svg>`;
  FACTION_SVGS["avatar_soulblight_gravelords"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-soulblight">
  <defs>
    <radialGradient id="sb-crimson" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e11d48" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#881337" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#4c0519" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sb-crimson)"/>
  <!-- Outstretched Gothic Bat Wings -->
  <path d="M50 36 C42 18 26 14 10 24 C14 36 22 44 26 56 C18 52 12 58 8 68 C18 68 26 64 34 58 C28 66 22 74 18 84 C30 80 40 70 46 58 Z" fill="#1e1b4b" stroke="#e11d48" stroke-width="1.5"/>
  <path d="M50 36 C58 18 74 14 90 24 C86 36 78 44 74 56 C82 52 88 58 92 68 C82 68 74 64 66 58 C72 66 78 74 82 84 C70 80 60 70 54 58 Z" fill="#1e1b4b" stroke="#e11d48" stroke-width="1.5"/>
  <!-- Vampiric Blood Chalice -->
  <path d="M42 46 C42 58 46 66 50 66 C54 66 58 58 58 46 Z" fill="#e11d48" stroke="#f43f5e" stroke-width="1.5"/>
  <line x1="50" y1="66" x2="50" y2="82" stroke="#e2e8f0" stroke-width="2.5"/>
  <path d="M40 82 L60 82" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round"/>
</svg>`;
  FACTION_SVGS["avatar_sylvaneth"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-sylvaneth">
  <defs>
    <radialGradient id="sylv-life" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#4ade80" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#15803d" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sylv-life)"/>
  <!-- Spiraling Ironbark Heart Rune -->
  <path d="M50 86 C34 74 18 56 18 38 C18 24 28 14 42 16 C48 17 50 22 50 22 C50 22 52 17 58 16 C72 14 82 24 82 38 C82 56 66 74 50 86 Z" fill="#14532d" stroke="#4ade80" stroke-width="2.2"/>
  <!-- Inner Life Spiral -->
  <path d="M50 32 C44 32 38 38 40 46 C42 54 52 56 54 64 C56 70 52 76 50 78" fill="none" stroke="#86efac" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="50" cy="32" r="3" fill="#bbf7d0"/>
</svg>`;

  // Backward compatibility ID aliases
  FACTION_SVGS["avatar_40k_ultramarines"] = FACTION_SVGS["avatar_adeptus_astartes"];
  FACTION_SVGS["avatar_40k_world_eaters"] = FACTION_SVGS["avatar_chaos_space_marines"];
  FACTION_SVGS["avatar_40k_necrons"] = FACTION_SVGS["avatar_necrons"];
  FACTION_SVGS["avatar_40k_orks"] = FACTION_SVGS["avatar_orks"];
  FACTION_SVGS["avatar_40k_custodes"] = FACTION_SVGS["avatar_adeptus_custodes"];
  FACTION_SVGS["avatar_aos_stormcast"] = FACTION_SVGS["avatar_stormcast_eternals"];
  FACTION_SVGS["avatar_aos_gloomspite"] = FACTION_SVGS["avatar_gloomspite_gitz"];

  function getArmoryAvatarSvg(avatarId, customClass) {
    if (!avatarId) return "";
    var svg = FACTION_SVGS[avatarId];
    if (!svg) return "";
    if (customClass) {
      return svg.replace("class=\"faction-svg", "class=\"faction-svg " + customClass);
    }
    return svg;
  }

  window.ARMORY_FACTION_SVGS = FACTION_SVGS;
  window.getArmoryAvatarSvg = getArmoryAvatarSvg;

})(window);
