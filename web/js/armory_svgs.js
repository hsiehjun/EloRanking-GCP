/**
 * OmniTactica Retribution Armory
 * Complete Authentic Warhammer 40,000 & Age of Sigmar Faction SVG Emblems
 * Total Factions: 53 (29 in 40K, 24 in AoS)
 */

(function(window) {
  "use strict";

  var FACTION_SVGS = {};
  FACTION_SVGS["avatar_adepta_sororitas"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-adepta-sororitas">
  <defs>
    <radialGradient id="as-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="#7f1d1d" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="as-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#a16207"/>
    </linearGradient>
    <linearGradient id="as-petal" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="50%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#as-glow)"/>
  <!-- Martyr Halo of Thorns -->
  <circle cx="50" cy="48" r="38" fill="none" stroke="url(#as-gold)" stroke-width="1.8" stroke-dasharray="6,4"/>
  <!-- Central Fleur-de-lis Petal -->
  <path d="M50 16 C45 28 42 42 50 64 C58 42 55 28 50 16 Z" fill="url(#as-petal)" stroke="#475569" stroke-width="1.2"/>
  <line x1="50" y1="18" x2="50" y2="62" stroke="#cbd5e1" stroke-width="1"/>
  <!-- Left Petal -->
  <path d="M47 50 C38 46 22 42 20 28 C16 46 32 58 46 60 Z" fill="url(#as-petal)" stroke="#475569" stroke-width="1.2"/>
  <path d="M22 30 C28 38 36 46 45 52" stroke="#cbd5e1" stroke-width="0.8" fill="none"/>
  <!-- Right Petal -->
  <path d="M53 50 C62 46 78 42 80 28 C84 46 68 58 54 60 Z" fill="url(#as-petal)" stroke="#475569" stroke-width="1.2"/>
  <path d="M78 30 C72 38 64 46 55 52" stroke="#cbd5e1" stroke-width="0.8" fill="none"/>
  <!-- Base Crossbar & Sacred Flame -->
  <rect x="36" y="60" width="28" height="5" rx="2" fill="url(#as-gold)" stroke="#78350f" stroke-width="1"/>
  <path d="M45 65 L40 82 C46 84 54 84 60 82 L55 65 Z" fill="url(#as-petal)" stroke="#475569" stroke-width="1.2"/>
  <circle cx="50" cy="73" r="3.5" fill="#ef4444"/>
  <circle cx="50" cy="73" r="1.5" fill="#fef08a"/>
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
  FACTION_SVGS["avatar_astra_militarum"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-astra-militarum">
  <defs>
    <radialGradient id="am-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#16a34a" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#14532d" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="am-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#854d0e"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#am-glow)"/>
  <!-- Cadian Fortress Winged Chevron Gate -->
  <path d="M50 14 L86 38 L86 54 L50 36 L14 54 L14 38 Z" fill="url(#am-gold)" stroke="#713f12" stroke-width="1.2"/>
  <path d="M50 24 L78 42 L78 52 L50 38 L22 52 L22 42 Z" fill="#ca8a04"/>
  <!-- Crossed Bayonet Lasguns -->
  <line x1="22" y1="22" x2="78" y2="78" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
  <line x1="78" y1="22" x2="22" y2="78" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
  <!-- Central Imperial Winged Skull -->
  <path d="M50 42 C43 42 38 46 38 53 C38 60 44 65 50 65 C56 65 62 60 62 53 C62 46 57 42 50 42 Z" fill="#f8fafc" stroke="#334155" stroke-width="1.2"/>
  <rect x="45" y="65" width="10" height="7" fill="#f8fafc" stroke="#334155" stroke-width="1"/>
  <circle cx="45" cy="52" r="2.5" fill="#0f172a"/>
  <circle cx="55" cy="52" r="2.5" fill="#0f172a"/>
  <!-- Skull Winglets -->
  <path d="M38 50 C26 48 18 54 14 62 C24 64 32 60 38 56 Z" fill="url(#am-gold)"/>
  <path d="M62 50 C74 48 82 54 86 62 C76 64 68 60 62 56 Z" fill="url(#am-gold)"/>
</svg>`;
  FACTION_SVGS["avatar_beasts_of_chaos"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-beasts-of-chaos">
  <defs>
    <radialGradient id="boc-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#b45309" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#78350f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#271506" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#boc-glow)"/>
  <!-- Great Curled Horns of the Herd -->
  <path d="M38 46 C24 38 12 24 18 14 C28 18 30 32 40 40 Z" fill="#d97706" stroke="#451a03" stroke-width="1.5"/>
  <path d="M62 46 C76 38 88 24 82 14 C72 18 70 32 60 40 Z" fill="#d97706" stroke="#451a03" stroke-width="1.5"/>
  <!-- Gor Beast Skull -->
  <path d="M50 34 C40 34 36 44 38 58 L44 76 L50 82 L56 76 L62 58 C64 44 60 34 50 34 Z" fill="#fef3c7" stroke="#78350f" stroke-width="1.4"/>
  <ellipse cx="44" cy="50" rx="3" ry="4" fill="#451a03"/>
  <ellipse cx="56" cy="50" rx="3" ry="4" fill="#451a03"/>
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
  FACTION_SVGS["avatar_chaos_daemons"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-chaos-daemons">
  <defs>
    <radialGradient id="cd-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.6"/>
      <stop offset="60%" stop-color="#9333ea" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#581c87" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#cd-glow)"/>
  <!-- Sweeping Demon Horns -->
  <path d="M34 44 C22 36 12 24 16 12 C24 16 28 28 38 34 Z" fill="#fda4af" stroke="#9f1239" stroke-width="1.2"/>
  <path d="M66 44 C78 36 88 24 84 12 C76 16 72 28 62 34 Z" fill="#fda4af" stroke="#9f1239" stroke-width="1.2"/>
  <!-- Daemon Prince Visage -->
  <path d="M50 28 C36 28 32 40 34 56 C36 68 44 76 50 86 C56 76 64 68 66 56 C68 40 64 28 50 28 Z" fill="#be123c" stroke="#4c0519" stroke-width="1.4"/>
  <!-- Burning Warp Eyes -->
  <ellipse cx="42" cy="50" rx="4" ry="2" fill="#fbbf24" transform="rotate(-15 42 50)"/>
  <ellipse cx="58" cy="50" rx="4" ry="2" fill="#fbbf24" transform="rotate(15 58 50)"/>
  <circle cx="42" cy="50" r="1.5" fill="#7f1d1d"/>
  <circle cx="58" cy="50" r="1.5" fill="#7f1d1d"/>
  <!-- Fanged Maw -->
  <path d="M42 66 Q50 72 58 66 Q50 78 42 66 Z" fill="#4c0519"/>
  <polygon points="44,66 46,70 48,66" fill="#fecdd3"/>
  <polygon points="52,66 54,70 56,66" fill="#fecdd3"/>
</svg>`;
  FACTION_SVGS["avatar_chaos_knights"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-chaos-knights">
  <defs>
    <radialGradient id="ck-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ea580c" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#7c2d12" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#451a03" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ck-glow)"/>
  <!-- Spiked Knight Visor -->
  <path d="M50 16 L74 32 L68 76 L50 88 L32 76 L26 32 Z" fill="#1e293b" stroke="#f97316" stroke-width="1.8"/>
  <!-- Slit Eye Visor -->
  <path d="M36 44 L64 44 L60 52 L40 52 Z" fill="#dc2626"/>
  <line x1="38" y1="48" x2="62" y2="48" stroke="#fef08a" stroke-width="1.5"/>
  <!-- Barbed Despoiler Spikes -->
  <polygon points="28,26 22,12 34,20" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
  <polygon points="72,26 78,12 66,20" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
  <polygon points="50,14 50,4 53,15" fill="#f97316"/>
  <!-- Chaos Barbed Trim -->
  <circle cx="50" cy="68" r="4" fill="#dc2626"/>
  <line x1="50" y1="64" x2="50" y2="72" stroke="#fef08a" stroke-width="1"/>
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
  FACTION_SVGS["avatar_cities_of_sigmar"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-cities-of-sigmar">
  <defs>
    <radialGradient id="cos-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#fbbf24" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#1e1b4b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#cos-glow)"/>
  <!-- Castelite Shield Wall -->
  <path d="M28 20 L72 20 L72 56 C72 72 50 84 50 84 C50 84 28 72 28 56 Z" fill="#1e3a8a" stroke="#fbbf24" stroke-width="2"/>
  <!-- Freeguild Rampant Lion -->
  <path d="M50 30 C44 30 40 36 44 42 C40 46 42 54 46 56 C44 62 48 68 54 66 C58 64 58 56 56 50 C60 46 58 36 50 30 Z" fill="#fbbf24" stroke="#78350f" stroke-width="1"/>
  <circle cx="50" cy="36" r="1.5" fill="#b91c1c"/>
</svg>`;
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
  FACTION_SVGS["avatar_daughters_of_khaine"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-daughters-of-khaine">
  <defs>
    <radialGradient id="dok-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e11d48" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#881337" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#4c0519" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#dok-glow)"/>
  <!-- Khaine Sacrifice Blade -->
  <polygon points="50,14 54,64 50,78 46,64" fill="#f8fafc" stroke="#e11d48" stroke-width="1.4"/>
  <line x1="50" y1="16" x2="50" y2="76" stroke="#e11d48" stroke-width="1"/>
  <!-- Coiled Serpentine Wings of Morathi -->
  <path d="M46 38 C32 28 20 36 16 48 C28 52 38 48 45 44 Z" fill="#be123c" stroke="#fda4af" stroke-width="1"/>
  <path d="M54 38 C68 28 80 36 84 48 C72 52 62 48 55 44 Z" fill="#be123c" stroke="#fda4af" stroke-width="1"/>
  <circle cx="50" cy="78" r="3" fill="#be123c"/>
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
  FACTION_SVGS["avatar_deathwatch"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-deathwatch">
  <defs>
    <radialGradient id="dw-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="#0369a1" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#082f49" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#dw-glow)"/>
  <!-- Silver Rim -->
  <circle cx="50" cy="50" r="42" fill="#0f172a" stroke="#cbd5e1" stroke-width="2.5"/>
  <!-- Inquisitorial Crossbar 'I' -->
  <rect x="34" y="22" width="32" height="6" rx="1.5" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <rect x="34" y="72" width="32" height="6" rx="1.5" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <rect x="46" y="24" width="8" height="52" fill="#f8fafc" stroke="#475569" stroke-width="1"/>
  <!-- Deathwatch Skull -->
  <circle cx="50" cy="46" r="10" fill="#e2e8f0" stroke="#334155" stroke-width="1.2"/>
  <rect x="46" y="54" width="8" height="5" fill="#e2e8f0" stroke="#334155" stroke-width="1"/>
  <circle cx="47" cy="45" r="2.2" fill="#ef4444"/>
  <circle cx="53" cy="45" r="2.2" fill="#ef4444"/>
</svg>`;
  FACTION_SVGS["avatar_disciples_of_tzeentch"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-disciples-of-tzeentch">
  <defs>
    <radialGradient id="dot-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#a855f7" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#3b0764" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#dot-glow)"/>
  <!-- Shifting Nine-fold Fate Sigil -->
  <circle cx="50" cy="50" r="28" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5,3"/>
  <path d="M50 20 Q64 36 50 50 Q36 64 50 80 Q64 64 50 50 Q36 36 50 20 Z" fill="#a855f7" stroke="#f472b6" stroke-width="1.5"/>
  <!-- Mystic Flame Eye -->
  <circle cx="50" cy="50" r="6" fill="#facc15"/>
  <circle cx="50" cy="50" r="2.5" fill="#0f172a"/>
</svg>`;
  FACTION_SVGS["avatar_drukhari"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-drukhari">
  <defs>
    <radialGradient id="dk-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="#701a75" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#4a044e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#dk-glow)"/>
  <!-- Barbed Kabalite Blade -->
  <path d="M50 12 C44 26 40 46 36 68 C42 64 46 68 50 88 C54 68 58 64 64 68 C60 46 56 26 50 12 Z" fill="#042f2e" stroke="#10b981" stroke-width="1.6"/>
  <!-- Barbed Flayer Hooks -->
  <path d="M38 48 C24 40 18 52 14 60 C26 58 32 54 37 54 Z" fill="#134e4a" stroke="#2dd4bf" stroke-width="1"/>
  <path d="M62 48 C76 40 82 52 86 60 C74 58 68 54 63 54 Z" fill="#134e4a" stroke="#2dd4bf" stroke-width="1"/>
  <!-- Poison Rune Core -->
  <polygon points="50,32 54,42 50,52 46,42" fill="#a855f7" stroke="#e879f9" stroke-width="1"/>
  <circle cx="50" cy="42" r="2" fill="#fdf4ff"/>
</svg>`;
  FACTION_SVGS["avatar_emperors_children"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-emperors-children">
  <defs>
    <radialGradient id="ec-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#a21caf" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#701a75" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ec-glow)"/>
  <!-- Slaaneshi Barbed Crescent -->
  <path d="M50 18 C30 18 20 34 26 54 C32 74 50 82 64 78 C52 74 38 66 38 52 C38 38 48 26 62 26 Z" fill="#db2777" stroke="#fbcfe8" stroke-width="1.5"/>
  <!-- Sonic Wave Rings -->
  <path d="M58 32 C68 38 74 48 70 60" fill="none" stroke="#f472b6" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M68 28 C82 36 88 52 82 68" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="5" fill="#fbbf24" stroke="#78350f" stroke-width="1"/>
</svg>`;
  FACTION_SVGS["avatar_flesh_eater_courts"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-flesh-eater-courts">
  <defs>
    <radialGradient id="fec-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#be123c" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#713f12" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#1c1917" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#fec-glow)"/>
  <!-- Deluded Royal Bone Chalice -->
  <path d="M34 24 L66 24 L62 52 C60 62 52 66 50 66 C48 66 40 62 38 52 Z" fill="#fef3c7" stroke="#78350f" stroke-width="1.8"/>
  <rect x="47" y="66" width="6" height="14" fill="#fef3c7" stroke="#78350f" stroke-width="1"/>
  <ellipse cx="50" cy="80" rx="14" ry="4" fill="#fef3c7" stroke="#78350f" stroke-width="1"/>
  <!-- Gory Wine Spill -->
  <ellipse cx="50" cy="26" rx="14" ry="3" fill="#be123c"/>
</svg>`;
  FACTION_SVGS["avatar_fyreslayers"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-fyreslayers">
  <defs>
    <radialGradient id="fs-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#dc2626" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#fs-glow)"/>
  <!-- Grimnir Flaming Greataxe -->
  <line x1="50" y1="16" x2="50" y2="84" stroke="#78350f" stroke-width="4"/>
  <!-- Dual Magmic Axe Heads -->
  <path d="M48 24 C36 20 22 28 20 44 C26 48 38 46 48 40 Z" fill="#ea580c" stroke="#fde047" stroke-width="1.5"/>
  <path d="M52 24 C64 20 78 28 80 44 C74 48 62 46 52 40 Z" fill="#ea580c" stroke="#fde047" stroke-width="1.5"/>
  <!-- Ur-Gold Burning Rune -->
  <circle cx="50" cy="32" r="4" fill="#facc15"/>
</svg>`;
  FACTION_SVGS["avatar_genestealer_cults"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-genestealer-cults">
  <defs>
    <radialGradient id="gsc-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#eab308" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#3b0764" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#gsc-glow)"/>
  <!-- Industrial Mining Half-Cog -->
  <path d="M22 50 C22 65 34 78 50 78 C65 78 78 65 78 50" fill="none" stroke="#ca8a04" stroke-width="4" stroke-dasharray="6,4"/>
  <!-- Wyrm Patriarch Three-Clawed Sigil -->
  <path d="M50 20 C42 32 38 48 40 68 C46 62 54 62 60 68 C62 48 58 32 50 20 Z" fill="#6b21a8" stroke="#c084fc" stroke-width="1.4"/>
  <path d="M38 34 C26 40 22 52 24 62 C32 56 36 50 40 44 Z" fill="#7e22ce" stroke="#d8b4fe" stroke-width="1"/>
  <path d="M62 34 C74 40 78 52 76 62 C68 56 64 50 60 44 Z" fill="#7e22ce" stroke="#d8b4fe" stroke-width="1"/>
  <circle cx="50" cy="46" r="3.5" fill="#facc15"/>
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
  FACTION_SVGS["avatar_grey_knights"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-grey-knights">
  <defs>
    <radialGradient id="gk-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#1e3a8a" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#gk-glow)"/>
  <!-- Open Sanctified Tome -->
  <path d="M50 62 C40 56 26 56 18 60 L18 78 C28 74 40 74 50 80 C60 74 72 74 82 78 L82 60 C74 56 60 56 50 62 Z" fill="#f1f5f9" stroke="#334155" stroke-width="1.4"/>
  <line x1="50" y1="62" x2="50" y2="80" stroke="#94a3b8" stroke-width="1.2"/>
  <!-- Upright Nemesis Force Sword -->
  <polygon points="50,12 53,46 51,68 49,68 47,46" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.2"/>
  <line x1="50" y1="14" x2="50" y2="66" stroke="#38bdf8" stroke-width="1"/>
  <!-- Golden Crossguard -->
  <rect x="36" y="44" width="28" height="4" rx="1.5" fill="#eab308" stroke="#713f12" stroke-width="1"/>
  <circle cx="50" cy="46" r="3" fill="#38bdf8"/>
</svg>`;
  FACTION_SVGS["avatar_hedonites_of_slaanesh"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-hedonites-of-slaanesh">
  <defs>
    <radialGradient id="hos-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d946ef" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#f472b6" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#4a044e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#hos-glow)"/>
  <!-- Sensuous Sigil Curve -->
  <path d="M50 16 C34 16 26 28 30 46 C34 62 48 70 54 82 C60 70 66 58 64 42 C62 26 58 16 50 16 Z" fill="#c026d3" stroke="#fde047" stroke-width="1.6"/>
  <circle cx="50" cy="42" r="5" fill="#fde047"/>
</svg>`;
  FACTION_SVGS["avatar_idoneth_deepkin"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-idoneth-deepkin">
  <defs>
    <radialGradient id="idk-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#0284c7" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#082f49" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#idk-glow)"/>
  <!-- Abyssal Wave Rune -->
  <path d="M50 16 C38 32 26 50 32 68 C38 82 56 82 66 70 C72 62 70 50 62 46 C54 42 46 48 48 56 C50 60 56 60 58 56" fill="none" stroke="#22d3ee" stroke-width="3" stroke-linecap="round"/>
  <!-- Ethersea Pearl -->
  <circle cx="50" cy="34" r="5" fill="#f8fafc" stroke="#67e8f9" stroke-width="1"/>
</svg>`;
  FACTION_SVGS["avatar_imperial_agents"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-imperial-agents">
  <defs>
    <radialGradient id="ia-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#854d0e" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ia-glow)"/>
  <!-- Triple Inquisitorial Crossbar Seal -->
  <rect x="26" y="20" width="48" height="6" rx="2" fill="#ca8a04" stroke="#713f12" stroke-width="1"/>
  <rect x="32" y="48" width="36" height="5" rx="1.5" fill="#ca8a04" stroke="#713f12" stroke-width="1"/>
  <rect x="26" y="74" width="48" height="6" rx="2" fill="#ca8a04" stroke="#713f12" stroke-width="1"/>
  <rect x="46" y="16" width="8" height="68" fill="#ca8a04" stroke="#713f12" stroke-width="1.2"/>
  <!-- Central Inquisition Crimson Skull -->
  <circle cx="50" cy="48" r="8.5" fill="#ef4444" stroke="#991b1b" stroke-width="1.2"/>
  <circle cx="47" cy="47" r="2" fill="#1e293b"/>
  <circle cx="53" cy="47" r="2" fill="#1e293b"/>
  <rect x="47" y="55" width="6" height="4" fill="#ef4444" stroke="#991b1b" stroke-width="0.8"/>
</svg>`;
  FACTION_SVGS["avatar_imperial_knights"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-imperial-knights">
  <defs>
    <radialGradient id="ik-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#1e3a8a" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ik-glow)"/>
  <!-- Knightly Heater Shield -->
  <path d="M30 18 L70 18 L70 54 C70 70 50 84 50 84 C50 84 30 70 30 54 Z" fill="#1e3a8a" stroke="#fbbf24" stroke-width="2"/>
  <!-- Cog of Mars Half -->
  <path d="M50 24 L50 78 C62 68 64 54 64 48 L64 24 Z" fill="#b91c1c"/>
  <!-- Chivalric Sword -->
  <line x1="50" y1="22" x2="50" y2="76" stroke="#f8fafc" stroke-width="2"/>
  <line x1="42" y1="32" x2="58" y2="32" stroke="#fde047" stroke-width="2"/>
  <circle cx="50" cy="20" r="3" fill="#fde047"/>
</svg>`;
  FACTION_SVGS["avatar_kharadron_overlords"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-kharadron-overlords">
  <defs>
    <radialGradient id="ko-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#eab308" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#0284c7" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ko-glow)"/>
  <!-- Aether-Gold Compass Rim -->
  <circle cx="50" cy="50" r="32" fill="#0f172a" stroke="#f59e0b" stroke-width="3"/>
  <!-- 4-Way Compass Points -->
  <polygon points="50,22 54,46 50,50 46,46" fill="#facc15"/>
  <polygon points="50,78 54,54 50,50 46,54" fill="#ca8a04"/>
  <polygon points="22,50 46,46 50,50 46,54" fill="#ca8a04"/>
  <polygon points="78,50 54,46 50,50 54,54" fill="#facc15"/>
  <circle cx="50" cy="50" r="4" fill="#0284c7"/>
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
  FACTION_SVGS["avatar_leagues_of_votann"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-leagues-of-votann">
  <defs>
    <radialGradient id="lov-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#0891b2" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#lov-glow)"/>
  <!-- Ancestor Core Runic Octagon -->
  <polygon points="50,14 75,25 86,50 75,75 50,86 25,75 14,50 25,25" fill="#0e7490" stroke="#f97316" stroke-width="2"/>
  <!-- Inner Magma Core -->
  <circle cx="50" cy="50" r="20" fill="#ea580c" stroke="#fef08a" stroke-width="1.8"/>
  <!-- Kinband Crossed Runic Bars -->
  <rect x="47" y="34" width="6" height="32" fill="#fef08a" rx="1"/>
  <rect x="34" y="47" width="32" height="6" fill="#fef08a" rx="1"/>
  <circle cx="50" cy="50" r="5" fill="#0e7490"/>
</svg>`;
  FACTION_SVGS["avatar_lumineth_realm_lords"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-lumineth-realm-lords">
  <defs>
    <radialGradient id="lrl-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.7"/>
      <stop offset="60%" stop-color="#38bdf8" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#lrl-glow)"/>
  <!-- Teclian Twin Sun Crescent -->
  <path d="M50 16 C30 16 18 36 24 58 C30 78 50 84 66 78 C54 74 38 64 38 50 C38 34 50 24 64 24 Z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1.8"/>
  <!-- Hyshian Solar Rays -->
  <circle cx="62" cy="38" r="8" fill="#fde047" stroke="#ca8a04" stroke-width="1"/>
  <line x1="62" y1="26" x2="62" y2="22" stroke="#fde047" stroke-width="1.5"/>
  <line x1="74" y1="38" x2="78" y2="38" stroke="#fde047" stroke-width="1.5"/>
</svg>`;
  FACTION_SVGS["avatar_maggotkin_of_nurgle"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-maggotkin-of-nurgle">
  <defs>
    <radialGradient id="mon-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#84cc16" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#4d7c0f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#14532d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#mon-glow)"/>
  <!-- Nurgle Tri-Globe Crest -->
  <circle cx="50" cy="32" r="11" fill="#4d7c0f" stroke="#a3e635" stroke-width="2"/>
  <circle cx="34" cy="62" r="11" fill="#4d7c0f" stroke="#a3e635" stroke-width="2"/>
  <circle cx="66" cy="62" r="11" fill="#4d7c0f" stroke="#a3e635" stroke-width="2"/>
  <circle cx="50" cy="32" r="4" fill="#a3e635"/>
  <circle cx="34" cy="62" r="4" fill="#a3e635"/>
  <circle cx="66" cy="62" r="4" fill="#a3e635"/>
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
  FACTION_SVGS["avatar_nighthaunt"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-nighthaunt">
  <defs>
    <radialGradient id="nh-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2dd4bf" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#0f766e" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#042f2e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#nh-glow)"/>
  <!-- Spectral Veiled Skull -->
  <path d="M50 16 C34 16 28 32 30 52 C32 68 40 76 50 86 C60 76 68 68 70 52 C72 32 66 16 50 16 Z" fill="#134e4a" stroke="#5eead4" stroke-width="1.8"/>
  <!-- Ethereal Eye Cavities -->
  <ellipse cx="43" cy="48" rx="3.5" ry="5" fill="#5eead4"/>
  <ellipse cx="57" cy="48" rx="3.5" ry="5" fill="#5eead4"/>
</svg>`;
  FACTION_SVGS["avatar_ogor_mawtribes"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-ogor-mawtribes">
  <defs>
    <radialGradient id="om-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#b45309" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#78350f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#271506" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#om-glow)"/>
  <!-- Gulping Maw Tooth Ring -->
  <circle cx="50" cy="50" r="30" fill="#1e293b" stroke="#f59e0b" stroke-width="3"/>
  <!-- Serrated Teeth -->
  <polygon points="50,22 47,30 53,30" fill="#fef3c7"/>
  <polygon points="50,78 47,70 53,70" fill="#fef3c7"/>
  <polygon points="22,50 30,47 30,53" fill="#fef3c7"/>
  <polygon points="78,50 70,47 70,53" fill="#fef3c7"/>
  <polygon points="30,30 36,36 32,38" fill="#fef3c7"/>
  <polygon points="70,30 64,36 68,38" fill="#fef3c7"/>
  <polygon points="30,70 36,64 32,62" fill="#fef3c7"/>
  <polygon points="70,70 64,64 68,62" fill="#fef3c7"/>
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
  FACTION_SVGS["avatar_orruk_warclans"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-orruk-warclans">
  <defs>
    <radialGradient id="ow-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#eab308" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#15803d" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ow-glow)"/>
  <!-- Beaten Yellow Iron Jaw -->
  <path d="M26 34 L74 34 L68 76 L50 86 L32 76 Z" fill="#ca8a04" stroke="#713f12" stroke-width="2"/>
  <!-- Brutal Orruk Tusks -->
  <polygon points="30,58 20,40 34,48" fill="#fef08a" stroke="#713f12" stroke-width="1.2"/>
  <polygon points="70,58 80,40 66,48" fill="#fef08a" stroke="#713f12" stroke-width="1.2"/>
  <rect x="42" y="58" width="16" height="8" fill="#15803d"/>
</svg>`;
  FACTION_SVGS["avatar_ossiarch_bonereapers"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-ossiarch-bonereapers">
  <defs>
    <radialGradient id="obr-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#0f766e" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#042f2e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#obr-glow)"/>
  <!-- Katakros Nadirite Shield -->
  <polygon points="50,16 76,28 68,74 50,86 32,74 24,28" fill="#0f766e" stroke="#5eead4" stroke-width="1.8"/>
  <!-- Ivory Mortuary Seal -->
  <circle cx="50" cy="48" r="14" fill="#fef3c7" stroke="#134e4a" stroke-width="1.4"/>
  <circle cx="50" cy="48" r="5" fill="#14b8a6"/>
</svg>`;
  FACTION_SVGS["avatar_seraphon"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-seraphon">
  <defs>
    <radialGradient id="ser-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#eab308" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#083344" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ser-glow)"/>
  <!-- Old One Solar Glyphs -->
  <polygon points="50,16 58,34 78,34 62,48 68,68 50,56 32,68 38,48 22,34 42,34" fill="#0891b2" stroke="#facc15" stroke-width="1.8"/>
  <circle cx="50" cy="46" r="6" fill="#facc15"/>
</svg>`;
  FACTION_SVGS["avatar_skaven"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-skaven">
  <defs>
    <radialGradient id="sk-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#84cc16" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#4d7c0f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#14532d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sk-glow)"/>
  <!-- Horned Rat Triangular Glyph -->
  <polygon points="50,20 78,74 22,74" fill="#292524" stroke="#84cc16" stroke-width="2.5"/>
  <!-- Two Gnawing Incisors -->
  <rect x="45" y="70" width="4" height="10" fill="#fef08a"/>
  <rect x="51" y="70" width="4" height="10" fill="#fef08a"/>
  <!-- Toxic Warp Eye -->
  <circle cx="50" cy="48" r="5" fill="#a3e635"/>
</svg>`;
  FACTION_SVGS["avatar_slaves_to_darkness"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-slaves-to-darkness">
  <defs>
    <radialGradient id="std-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ea580c" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#dc2626" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#std-glow)"/>
  <!-- Archaon Ascendant Chaos Star -->
  <line x1="50" y1="14" x2="50" y2="86" stroke="#f97316" stroke-width="2.5"/>
  <line x1="14" y1="50" x2="86" y2="50" stroke="#f97316" stroke-width="2.5"/>
  <line x1="24" y1="24" x2="76" y2="76" stroke="#f97316" stroke-width="2.5"/>
  <line x1="76" y1="24" x2="24" y2="76" stroke="#f97316" stroke-width="2.5"/>
  <!-- Crown of Domination Center -->
  <polygon points="50,14 46,24 54,24" fill="#ea580c"/>
  <polygon points="50,86 46,76 54,76" fill="#ea580c"/>
  <polygon points="14,50 24,46 24,54" fill="#ea580c"/>
  <polygon points="86,50 76,46 76,54" fill="#ea580c"/>
  <circle cx="50" cy="50" r="9" fill="#1c1917" stroke="#fbbf24" stroke-width="1.8"/>
  <circle cx="50" cy="50" r="3.5" fill="#ea580c"/>
</svg>`;
  FACTION_SVGS["avatar_sons_of_behemat"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-sons-of-behemat">
  <defs>
    <radialGradient id="sob-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d97706" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#78350f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#292524" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sob-glow)"/>
  <!-- Giant Mountain Footprint -->
  <ellipse cx="50" cy="60" rx="16" ry="22" fill="#78350f" stroke="#f59e0b" stroke-width="1.8"/>
  <circle cx="38" cy="34" r="4" fill="#f59e0b"/>
  <circle cx="45" cy="30" r="4.5" fill="#f59e0b"/>
  <circle cx="53" cy="30" r="4.5" fill="#f59e0b"/>
  <circle cx="61" cy="34" r="4" fill="#f59e0b"/>
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
  FACTION_SVGS["avatar_space_marines"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-space-marines">
  <defs>
    <radialGradient id="sm-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#1d4ed8" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#sm-glow)"/>
  <!-- Laurel Crown of Victory -->
  <path d="M26 50 C26 36 36 24 50 24 C64 24 74 36 74 50 C74 66 60 76 50 76 C40 76 26 66 26 50 Z" fill="none" stroke="#eab308" stroke-width="2.5" stroke-dasharray="8,4"/>
  <!-- Imperial Gladius -->
  <polygon points="50,16 53,60 50,72 47,60" fill="#f8fafc" stroke="#475569" stroke-width="1.2"/>
  <line x1="42" y1="30" x2="58" y2="30" stroke="#ca8a04" stroke-width="2"/>
  <circle cx="50" cy="74" r="3" fill="#eab308"/>
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
  FACTION_SVGS["avatar_thousand_sons"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-thousand-sons">
  <defs>
    <radialGradient id="ts-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#d97706" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#042f2e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#ts-glow)"/>
  <!-- Mystic Horned Crest of Tzeentch -->
  <path d="M50 14 C36 22 28 36 32 50 C38 42 44 42 50 44 C56 42 62 42 68 50 C72 36 64 22 50 14 Z" fill="#0284c7" stroke="#f59e0b" stroke-width="1.6"/>
  <!-- All-Seeing Eye of Magnus -->
  <path d="M30 60 Q50 42 70 60 Q50 78 30 60 Z" fill="#fef08a" stroke="#d97706" stroke-width="1.5"/>
  <circle cx="50" cy="60" r="7" fill="#0891b2"/>
  <circle cx="50" cy="60" r="3" fill="#0f172a"/>
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
  FACTION_SVGS["avatar_world_eaters"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="faction-svg faction-world-eaters">
  <defs>
    <radialGradient id="we-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.7"/>
      <stop offset="70%" stop-color="#b45309" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#we-glow)"/>
  <!-- Crossed Chainaxes -->
  <line x1="20" y1="20" x2="80" y2="80" stroke="#78350f" stroke-width="4"/>
  <polygon points="18,18 34,14 30,34" fill="#b91c1c" stroke="#f59e0b" stroke-width="1.2"/>
  <line x1="80" y1="20" x2="20" y2="80" stroke="#78350f" stroke-width="4"/>
  <polygon points="82,18 66,14 70,34" fill="#b91c1c" stroke="#f59e0b" stroke-width="1.2"/>
  <!-- Khorne Brass Skull-Maw -->
  <path d="M38 42 L62 42 L58 68 L50 78 L42 68 Z" fill="#b45309" stroke="#fde047" stroke-width="1.5"/>
  <rect x="42" y="52" width="16" height="6" fill="#7f1d1d"/>
  <polygon points="44,52 46,56 48,52" fill="#fff"/>
  <polygon points="52,52 54,56 56,52" fill="#fff"/>
</svg>`;

  // Backward compatibility ID aliases
  FACTION_SVGS["avatar_40k_ultramarines"] = FACTION_SVGS["avatar_adeptus_astartes"];
  FACTION_SVGS["avatar_40k_world_eaters"] = FACTION_SVGS["avatar_world_eaters"] || FACTION_SVGS["avatar_chaos_space_marines"];
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
