/**
 * Age of Sigmar (4th Edition) Grand Alliances, Factions, Battle Formations & Armies of Renown
 * Derived from NewRecruit AoS 4.0 Catalogue (id_system = 4255553472) & General's Handbook 2025-26
 */

export const AOS_FACTIONS = [
  // --- ORDER ---
  {
    id: "stormcast-eternals",
    name: "Stormcast Eternals",
    grandAlliance: "Order",
    icon: "⚡",
    battleFormations: [
      "Vanguard Wing",
      "Sentinels of the Bleak Citadels",
      "Thunderhead Host",
      "Lightning Echelon",
      "Sacrosanct Convocation",
      "Draconith Skywing",
      "Heroes of the First-Forged",
      "Ruination Brotherhood"
    ]
  },
  {
    id: "cities-of-sigmar",
    name: "Cities of Sigmar",
    grandAlliance: "Order",
    icon: "🏰",
    battleFormations: [
      "Stalwart Guardians",
      "Collegiate Exemplars",
      "Zealous Hordes",
      "Swift Reinforcements",
      "Thrall Warhost",
      "Grudgebound War Throng",
      "Veteran Cannoneers",
      "Fearless Exemplars",
      "Allies of the Free Cities",
      "The Iron March"
    ]
  },
  {
    id: "seraphon",
    name: "Seraphon",
    grandAlliance: "Order",
    icon: "🦎",
    battleFormations: [
      "Thunderquake Starhost",
      "Eternal Starhost",
      "Shadowstrike Starhost",
      "Sunclaw Starhost"
    ]
  },
  {
    id: "lumineth-realm-lords",
    name: "Lumineth Realm-lords",
    grandAlliance: "Order",
    icon: "🏹",
    battleFormations: [
      "Scinari Council",
      "Pilgrims of Haixiah",
      "Warhost of Duality",
      "Aelementor Guardians",
      "Aelementiri Conclave",
      "Vanari Paragons"
    ]
  },
  {
    id: "sylvaneth",
    name: "Sylvaneth",
    grandAlliance: "Order",
    icon: "🌳",
    battleFormations: [
      "Lords of the Clan",
      "Followers Of Kurnoth",
      "Glade Defenders",
      "Outcasts",
      "Wargrove of the Burgeoning",
      "Wargrove of Everdusk",
      "Soulpod Guardians",
      "The Evergreen Hunt"
    ]
  },
  {
    id: "kharadron-overlords",
    name: "Kharadron Overlords",
    grandAlliance: "Order",
    icon: "⚓",
    battleFormations: [
      "Veteran Ground Troops",
      "Rapid Redeployment Squadron",
      "Endrineers Guild Expeditionary Force",
      "Pioneers and Scavengers",
      "Grundstok Expeditionary Force",
      "Pioneer Outpost",
      "The Magnate's Crew"
    ]
  },
  {
    id: "idoneth-deepkin",
    name: "Idoneth Deepkin",
    grandAlliance: "Order",
    icon: "🌊",
    battleFormations: [
      "Soul-raid Ambushers",
      "Namarti Corps",
      "Isharann Council",
      "Akhelian Beastmasters",
      "Deep-Sea Stalkers",
      "Ethersea Predators",
      "The First Phalanx of Ionrach",
      "Wardens of the Chorrileum"
    ]
  },
  {
    id: "daughters-of-khaine",
    name: "Daughters of Khaine",
    grandAlliance: "Order",
    icon: "🗡️",
    battleFormations: [
      "Coven of Blood",
      "Frenzied Devotees",
      "Cold-Hearted Murderers",
      "Fervent Ritualists",
      "Coven Zealots",
      "Arena Veterans",
      "Champions of the Arena",
      "The Croneseer's Pariahs",
      "Zainthar Kai"
    ]
  },
  {
    id: "fyreslayers",
    name: "Fyreslayers",
    grandAlliance: "Order",
    icon: "🔥",
    battleFormations: [
      "Forge Brethren",
      "Scales of Vulcatrix",
      "Warrior Kinband",
      "Lords of the Lodge",
      "Lofnir Drothkeepers"
    ]
  },

  // --- CHAOS ---
  {
    id: "skaven",
    name: "Skaven",
    grandAlliance: "Chaos",
    icon: "🐀",
    battleFormations: [
      "Warpcog Convocation",
      "Fleshmeld Menagerie",
      "Virulent Procession",
      "Claw-horde",
      "Kill-pack",
      "Envoys of the Deepengnaw",
      "Gathering of the Clans",
      "Thanquol's Mutated Menagerie",
      "The Great-grand Gnawhorde"
    ]
  },
  {
    id: "blades-of-khorne",
    name: "Blades of Khorne",
    grandAlliance: "Chaos",
    icon: "🩸",
    battleFormations: [
      "Brass Stampede",
      "Khornate Legion",
      "Murderhost",
      "Bloodbound Warhorde",
      "Tournament of Skulls",
      "The Goretide",
      "Gorechosen Champions",
      "The Baleful Lords"
    ]
  },
  {
    id: "disciples-of-tzeentch",
    name: "Disciples of Tzeentch",
    grandAlliance: "Chaos",
    icon: "👁️",
    battleFormations: [
      "Fated Blades",
      "Malevolent Schemers",
      "Denizens of the Silver Tower",
      "Mutants and Mad Things",
      "Masters of Fate",
      "Spellweaver Coven",
      "Change-cult Uprising",
      "The Oracles of Fate"
    ]
  },
  {
    id: "maggotkin-of-nurgle",
    name: "Maggotkin of Nurgle",
    grandAlliance: "Chaos",
    icon: "🪰",
    battleFormations: [
      "Affliction Cyst",
      "Tallyband of Nurgle",
      "Nurgle's Menagerie",
      "Plague Cyst",
      "Cycle of Corruption",
      "The Gardeners of Nurgle"
    ]
  },
  {
    id: "hedonites-of-slaanesh",
    name: "Hedonites of Slaanesh",
    grandAlliance: "Chaos",
    icon: "💜",
    battleFormations: [
      "Depraved Carnival",
      "Godseeker Cavalcade",
      "Artisans Of Torment",
      "Lurid Dreamers",
      "Pretenders",
      "Invaders",
      "Court of the Godlings",
      "The Decadent Host"
    ]
  },
  {
    id: "slaves-to-darkness",
    name: "Slaves to Darkness",
    grandAlliance: "Chaos",
    icon: "⚔️",
    battleFormations: [
      "Darkoath Horde",
      "Legion of Chaos",
      "Despoilers",
      "Godswrath Warband",
      "Chaos Horde",
      "Champions of Chaos",
      "Legion of the First Prince",
      "The Swords of Chaos",
      "Tribes of the Snow Peaks"
    ]
  },
  {
    id: "helsmiths-of-hashut",
    name: "Helsmiths of Hashut",
    grandAlliance: "Chaos",
    icon: "⚒️",
    battleFormations: [
      "Hashutite Host",
      "Castigation Battery",
      "The Bullfather's Horns",
      "Daemonsmith Cabal",
      "Domination Force",
      "Industrial Polluters",
      "Taar's Grand Forgehost",
      "Ziggurat Stampede"
    ]
  },
  {
    id: "beasts-of-chaos",
    name: "Beasts of Chaos",
    grandAlliance: "Chaos",
    icon: "🐐",
    battleFormations: [
      "Almighty Beastherd",
      "Hungering Warherd",
      "Thunderscorn Stormherd",
      "Marauding Brayherd"
    ]
  },

  // --- DEATH ---
  {
    id: "soulblight-gravelords",
    name: "Soulblight Gravelords",
    grandAlliance: "Death",
    icon: "🦇",
    battleFormations: [
      "Deathstench Drove",
      "Bacchanal of Blood",
      "Deathmarch",
      "Legion of Shyish",
      "Legions of Ulfenkarn",
      "Cryptmasters",
      "Skinshifters",
      "Barrow Legion",
      "Knights of the Crimson Keep",
      "Scions of Nulahmia"
    ]
  },
  {
    id: "ossiarch-bonereapers",
    name: "Ossiarch Bonereapers",
    grandAlliance: "Death",
    icon: "💀",
    battleFormations: [
      "Border Guards",
      "The Inevitable Empire",
      "Ruthless Legion",
      "Remorseless Conquerors",
      "Tithe Guards",
      "Hekatos Drillmasters",
      "The Lance of Ossia",
      "The Null Myriad"
    ]
  },
  {
    id: "nighthaunt",
    name: "Nighthaunt",
    grandAlliance: "Death",
    icon: "👻",
    battleFormations: [
      "Quicksilver Gheists",
      "Death Stalkers",
      "Royal Procession",
      "Shrieker Host",
      "Hungry Nexus",
      "Deathrust Gheists",
      "The Clattering Procession",
      "The Eternal Nightmare"
    ]
  },
  {
    id: "flesh-eater-courts",
    name: "Flesh-eater Courts",
    grandAlliance: "Death",
    icon: "👑",
    battleFormations: [
      "Royal Menagerie",
      "Knightly Echelon",
      "The Royal Hunt",
      "Lords of the Manor",
      "Impassioned Serfs",
      "Questing Courtiers",
      "New Summercourt",
      "The Equinox Feast"
    ]
  },

  // --- DESTRUCTION ---
  {
    id: "ironjawz",
    name: "Ironjawz",
    grandAlliance: "Destruction",
    icon: "🐗",
    battleFormations: [
      "Weirdfist",
      "Ironjawz Brawl",
      "Grunta Stampede",
      "Ironfist",
      "Brutefist",
      "Bigsnikkaz",
      "Big Waaagh!",
      "Krazogg's Grunta Stampede",
      "Zoggrok's Ironmongerz"
    ]
  },
  {
    id: "kruleboyz",
    name: "Kruleboyz",
    grandAlliance: "Destruction",
    icon: "🐊",
    battleFormations: [
      "Light Finga",
      "Trophy Finga",
      "Kruleboyz Klaw",
      "Middul Finga",
      "Swamphorde Bullies",
      "Badmouthing Baiterz",
      "Big Waaagh!",
      "Murkvast Menagerie"
    ]
  },
  {
    id: "orruk-warclans",
    name: "Orruk Warclans",
    grandAlliance: "Destruction",
    icon: "⚔️",
    battleFormations: [
      "Big Waaagh!",
      "Ironjawz Brawl",
      "Grunta Stampede",
      "Ironfist",
      "Weirdfist",
      "Brutefist",
      "Bigsnikkaz",
      "Kruleboyz Klaw",
      "Light Finga",
      "Trophy Finga",
      "Middul Finga",
      "Swamphorde Bullies",
      "Badmouthing Baiterz",
      "Krazogg's Grunta Stampede",
      "Zoggrok's Ironmongerz",
      "Murkvast Menagerie"
    ]
  },
  {
    id: "gloomspite-gitz",
    name: "Gloomspite Gitz",
    grandAlliance: "Destruction",
    icon: "🍄",
    battleFormations: [
      "Squigalanche",
      "Troggherd",
      "Gitmob Pack",
      "Gloomspite Horde",
      "Sunbiter Pack",
      "Gittish Tide",
      "Da King's Gitz",
      "Droggz's Gitmob",
      "Trugg's Troggherd"
    ]
  },
  {
    id: "ogor-mawtribes",
    name: "Ogor Mawtribes",
    grandAlliance: "Destruction",
    icon: "🍖",
    battleFormations: [
      "Hunger-Filled Tribe",
      "Vanguard of the Mawpath",
      "Hinterland Hunters",
      "Maw-Cult Fanatics",
      "Mawpath Menaces",
      "Greedy Eaters",
      "Beastclaw Alfrostun",
      "Mawseeker Gollop",
      "Meatfist Mawtribe",
      "The Roving Maw"
    ]
  },
  {
    id: "sons-of-behemat",
    name: "Sons of Behemat",
    grandAlliance: "Destruction",
    icon: "🦶",
    battleFormations: [
      "Looting Leviathans",
      "Conquering Stomp",
      "Eager Louts",
      "Heirs of the Old Ways",
      "Manskittle Mob",
      "Big Toes",
      "King Brodd's Stomp",
      "Matriarch's Mob",
      "Stomper Tribe"
    ]
  },
  {
    id: "bonesplitterz",
    name: "Bonesplitterz",
    grandAlliance: "Destruction",
    icon: "🦴",
    battleFormations: [
      "Kop Rukk",
      "Kunnin' Rukk",
      "Snaga Rukk",
      "Brutal Rukk"
    ]
  }
];

let _aosFormationsHydrated = false;
let _aosFormationsPromise = null;

/**
 * Dynamically hydrates AoS 4.0 Battle Formations & Armies of Renown directly from
 * NewRecruit's live catalogue via GET /api/nr/aos/battle_formations.
 */
export async function hydrateAosFormationsFromNewRecruit() {
  if (_aosFormationsHydrated) return AOS_FACTIONS;
  if (_aosFormationsPromise) return _aosFormationsPromise;
  if (typeof window === "undefined" || typeof fetch !== "function") return AOS_FACTIONS;

  _aosFormationsPromise = (async () => {
    try {
      const resp = await fetch("/api/nr/aos/battle_formations");
      if (!resp.ok) return AOS_FACTIONS;
      const data = await resp.json();
      const subMap = data?.subfactions_by_faction || {};
      const formMap = data?.formations_by_faction || {};
      let updated = false;
      for (const fac of AOS_FACTIONS) {
        const nrSubs = subMap[fac.id];
        if (Array.isArray(nrSubs) && nrSubs.length > 0) {
          fac.battleFormations = nrSubs;
          updated = true;
        }
        const nrDetails = formMap[fac.id];
        if (Array.isArray(nrDetails) && nrDetails.length > 0) {
          fac.formationsDetails = nrDetails;
        }
      }
      if (updated) {
        _aosFormationsHydrated = true;
        window.dispatchEvent(new CustomEvent("aos_formations_hydrated", { detail: data }));
      }
    } catch (err) {
      // Fallback to bundled NewRecruit AoS 4.0 formations
    } finally {
      _aosFormationsPromise = null;
    }
    return AOS_FACTIONS;
  })();

  return _aosFormationsPromise;
}

export function getFactionsByAlliance(alliance) {
  if (!alliance || alliance === "All") return AOS_FACTIONS;
  return AOS_FACTIONS.filter(f => f.grandAlliance === alliance);
}

export function getFactionById(factionId) {
  if (!factionId) return null;
  const raw = String(factionId).trim();
  const low = raw.toLowerCase();
  const slug = low.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    AOS_FACTIONS.find(
      f =>
        f.id === raw ||
        f.id === low ||
        f.id === slug ||
        f.name.toLowerCase() === low
    ) || null
  );
}
