/**
 * Age of Sigmar (4th Edition) Grand Alliances, Factions, and Battle Formations
 */

export const AOS_FACTIONS = [
  // --- ORDER ---
  {
    id: "stormcast-eternals",
    name: "Stormcast Eternals",
    grandAlliance: "Order",
    icon: "⚡",
    battleFormations: ["Lightning Echelon", "Thunderhead Host", "Bleak Citadel", "Sentinels of the Azyr"]
  },
  {
    id: "cities-of-sigmar",
    name: "Cities of Sigmar",
    grandAlliance: "Order",
    icon: "🏰",
    battleFormations: ["Castelite Formation", "Ironweld Guild Expedition", "Collegiate Arcane", "Freeguild Spearmen"]
  },
  {
    id: "seraphon",
    name: "Seraphon",
    grandAlliance: "Order",
    icon: "🦎",
    battleFormations: ["Sunclaw Starhost", "Thunderquake Host", "Fangs of Sotek", "Coalesced Ancient"]
  },
  {
    id: "lumineth-realm-lords",
    name: "Lumineth Realm-lords",
    grandAlliance: "Order",
    icon: "🏹",
    battleFormations: ["Vanari Phalanx", "Scinari Council", "Alarith Temple", "Hurakan Wind-host"]
  },
  {
    id: "sylvaneth",
    name: "Sylvaneth",
    grandAlliance: "Order",
    icon: "🌳",
    battleFormations: ["Free Spirits", "Noble Spirits", "Outcasts", "Harvestboon Grove"]
  },
  {
    id: "kharadron-overlords",
    name: "Kharadron Overlords",
    grandAlliance: "Order",
    icon: "⚓",
    battleFormations: ["Iron Sky Command", "Endrineers Guild", "Aether-runners Expedition", "Sky-vessel Armada"]
  },
  {
    id: "idoneth-deepkin",
    name: "Idoneth Deepkin",
    grandAlliance: "Order",
    icon: "🌊",
    battleFormations: ["Akhelian Beastmasters", "Namarti Corps", "Isharann Council", "Eel Shock Troops"]
  },
  {
    id: "daughters-of-khaine",
    name: "Daughters of Khaine",
    grandAlliance: "Order",
    icon: "🗡️",
    battleFormations: ["Slaughter Troupe", "Cauldron Guard", "Shadow Patrol", "Blood Sisters Covens"]
  },
  {
    id: "fyreslayers",
    name: "Fyreslayers",
    grandAlliance: "Order",
    icon: "🔥",
    battleFormations: ["Warrior Kinband", "Forge Breakers", "Lofnir Magmadroth Herd", "Vostarg Lodge"]
  },

  // --- CHAOS ---
  {
    id: "skaven",
    name: "Skaven",
    grandAlliance: "Chaos",
    icon: "🐀",
    battleFormations: ["Warpcog Convocation", "Fleshmeld Menagerie", "Claw-horde", "Virulent Procession"]
  },
  {
    id: "blades-of-khorne",
    name: "Blades of Khorne",
    grandAlliance: "Chaos",
    icon: "🩸",
    battleFormations: ["Bloodbound Warhorde", "Daemonforged Host", "Skullfiend Tribe", "Gorechosen Vanguard"]
  },
  {
    id: "disciples-of-tzeentch",
    name: "Disciples of Tzeentch",
    grandAlliance: "Chaos",
    icon: "👁️",
    battleFormations: ["Arcanite Cult", "Daemon Pyros", "Changehost", "Eternal Coven"]
  },
  {
    id: "maggotkin-of-nurgle",
    name: "Maggotkin of Nurgle",
    grandAlliance: "Chaos",
    icon: "🪰",
    battleFormations: ["Tallyband of Nurgle", "Rotbringer Host", "Befouling Host", "Droning Plagueband"]
  },
  {
    id: "hedonites-of-slaanesh",
    name: "Hedonites of Slaanesh",
    grandAlliance: "Chaos",
    icon: "💜",
    battleFormations: ["Pretenders Host", "Invaders Host", "Godseekers Host", "Euphoric Carnival"]
  },
  {
    id: "slaves-to-darkness",
    name: "Slaves to Darkness",
    grandAlliance: "Chaos",
    icon: "⚔️",
    battleFormations: ["Godswrath Warband", "Ravagers Host", "Cabalists Order", "Despoilers Legion"]
  },
  {
    id: "beasts-of-chaos",
    name: "Beasts of Chaos",
    grandAlliance: "Chaos",
    icon: "🐐",
    battleFormations: ["Allherd", "Darkwalkers", "Gavespawn", "Brass Despoilers"]
  },

  // --- DEATH ---
  {
    id: "soulblight-gravelords",
    name: "Soulblight Gravelords",
    grandAlliance: "Death",
    icon: "🦇",
    battleFormations: ["Deathmarch", "Legion of Blood", "Legion of Night", "Kastelai Dynasty"]
  },
  {
    id: "ossiarch-bonereapers",
    name: "Ossiarch Bonereapers",
    grandAlliance: "Death",
    icon: "💀",
    battleFormations: ["Mortisan Council", "Kavalos Lance", "Petrifex Elite", "Crematorians"]
  },
  {
    id: "nighthaunt",
    name: "Nighthaunt",
    grandAlliance: "Death",
    icon: "👻",
    battleFormations: ["Death Stalkers", "Procession of the Doomed", "Scarlet Doom", "Grief-stricken Host"]
  },
  {
    id: "flesh-eater-courts",
    name: "Flesh-eater Courts",
    grandAlliance: "Death",
    icon: "👑",
    battleFormations: ["Lords of the Manor", "Royal Menagerie", "Cannibal Court", "Blisterkin Scavengers"]
  },

  // --- DESTRUCTION ---
  {
    id: "orruk-warclans",
    name: "Orruk Warclans",
    grandAlliance: "Destruction",
    icon: "🐗",
    battleFormations: ["Kruleboyz Warclan", "Ironjawz Big Mob", "Bonesplitterz Tribe", "Big Waaagh!"]
  },
  {
    id: "gloomspite-gitz",
    name: "Gloomspite Gitz",
    grandAlliance: "Destruction",
    icon: "🍄",
    battleFormations: ["Moonclan Skrap", "Squigalanche", "Trogherd", "Spiderfang Stalkers"]
  },
  {
    id: "ogor-mawtribes",
    name: "Ogor Mawtribes",
    grandAlliance: "Destruction",
    icon: "🍖",
    battleFormations: ["Gutstuffers", "Meatfist Mawtribe", "Boulderhead Herd", "Bloodgullet Nomad"]
  },
  {
    id: "sons-of-behemat",
    name: "Sons of Behemat",
    grandAlliance: "Destruction",
    icon: "🦶",
    battleFormations: ["Stomping Megagargant", "King Brodd's Stomp", "Taker Tribe", "Breaker Tribe"]
  }
];

export function getFactionsByAlliance(alliance) {
  if (!alliance || alliance === "All") return AOS_FACTIONS;
  return AOS_FACTIONS.filter(f => f.grandAlliance === alliance);
}

export function getFactionById(factionId) {
  return AOS_FACTIONS.find(f => f.id === factionId || f.name === factionId) || null;
}
