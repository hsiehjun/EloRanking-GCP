/**
 * Factions and Detachments for Warhammer 40,000 11th Edition (MFM v1.5)
 */

export const FACTIONS_BY_CATEGORY = [
  {
    label: "Imperium",
    factions: [
      { value: "adepta-sororitas", label: "Adepta Sororitas" },
      { value: "adeptus-custodes", label: "Adeptus Custodes" },
      { value: "adeptus-mechanicus", label: "Adeptus Mechanicus" },
      { value: "astra-militarum", label: "Astra Militarum" },
      { value: "grey-knights", label: "Grey Knights" },
      { value: "agents-of-imperium", label: "Imperial Agents" },
      { value: "imperial-knights", label: "Imperial Knights" },
      { value: "titan-legions", label: "Titan Legions" }
    ]
  },
  {
    label: "Space Marines",
    factions: [
      { value: "black-templars", label: "Black Templars" },
      { value: "blood-angels", label: "Blood Angels" },
      { value: "dark-angels", label: "Dark Angels" },
      { value: "deathwatch", label: "Deathwatch" },
      { value: "imperial-fists", label: "Imperial Fists" },
      { value: "iron-hands", label: "Iron Hands" },
      { value: "raven-guard", label: "Raven Guard" },
      { value: "salamanders", label: "Salamanders" },
      { value: "space-marines", label: "Space Marines" },
      { value: "space-wolves", label: "Space Wolves" },
      { value: "ultramarines", label: "Ultramarines" },
      { value: "white-scars", label: "White Scars" }
    ]
  },
  {
    label: "Chaos",
    factions: [
      { value: "alpha-legion", label: "Alpha Legion" },
      { value: "black-legion", label: "Black Legion" },
      { value: "chaos-daemons", label: "Chaos Daemons" },
      { value: "chaos-knights", label: "Chaos Knights" },
      { value: "chaos-space-marines", label: "Chaos Space Marines" },
      { value: "chaos-titan-legions", label: "Chaos Titan Legions" },
      { value: "death-guard", label: "Death Guard" },
      { value: "emperors-children", label: "Emperor's Children" },
      { value: "iron-warriors", label: "Iron Warriors" },
      { value: "night-lords", label: "Night Lords" },
      { value: "red-corsairs", label: "Red Corsairs" },
      { value: "thousand-sons", label: "Thousand Sons" },
      { value: "word-bearers", label: "Word Bearers" },
      { value: "world-eaters", label: "World Eaters" }
    ]
  },
  {
    label: "Aeldari",
    factions: [
      { value: "aeldari", label: "Aeldari" },
      { value: "drukhari", label: "Drukhari" }
    ]
  },
  {
    label: "Forces Of The Hive Mind",
    factions: [
      { value: "genestealer-cults", label: "Genestealer Cults" },
      { value: "tyranids", label: "Tyranids" }
    ]
  },
  {
    label: "Xenos",
    factions: [
      { value: "necrons", label: "Necrons" },
      { value: "orks", label: "Orks" },
      { value: "tau-empire", label: "T'au" },
      { value: "leagues-of-votann", label: "Leagues Of Votann" }
    ]
  }
];

const ALL_FACTIONS = Object.fromEntries(
  FACTIONS_BY_CATEGORY.flatMap(cat => cat.factions).map(f => [f.value, f])
);
ALL_FACTIONS["imperial-agents"] = ALL_FACTIONS["agents-of-imperium"];

export function getFactionName(slug) {
  return slug && ALL_FACTIONS[slug] ? ALL_FACTIONS[slug].label : null;
}

const detachment = (name, dispositions, dp, unique = null) => {
  const dispoList = Array.isArray(dispositions) ? dispositions : [dispositions];
  return {
    name,
    disposition: dispoList[0],
    dispositions: dispoList,
    dp,
    ...(unique ? { unique } : {})
  };
};

const SPACE_MARINE_DETACHMENTS = [
  detachment("Assault Brethren", "hold", 1, "DOCTRINES"),
  detachment("Blade of Ultramar", ["hold", "priority"], 3),
  detachment("Ceramite Sentinels", "hold", 2),
  detachment("Deathwatch Support", "disruption", 1),
  detachment("Devastator Brethren", "purge", 1, "DOCTRINES"),
  detachment("Forgefather’s Seekers", "priority", 2),
  detachment("Gauntlet Task Force", "recon", 1),
  detachment("Gladius Task Force", ["hold", "priority"], 3),
  detachment("Gravis Linebreaker Force", "hold", 1, "GRAVIS"),
  detachment("Gravis Siege Force", "hold", 1, "GRAVIS"),
  detachment("Ironclad Champions", "priority", 1),
  detachment("Ironstorm Spearhead", "purge", 1, "IRONSTORM"),
  detachment("Medusa's Wrath", "purge", 2, "IRONSTORM"),
  detachment("Phobos Shadow Force", "disruption", 1, "PHOBOS"),
  detachment("Phobos Shock Force", "disruption", 1, "PHOBOS"),
  detachment("Shadowmark Talon", "disruption", 2, "PHOBOS"),
  detachment("Spearpoint Task Force", "recon", 2),
  detachment("Stormlance Task Force", "recon", 1),
  detachment("Tactical Brethren", "priority", 1, "DOCTRINES"),
  detachment("Tacticus Attack Force", "hold", 1, "TACTICUS"),
  detachment("Tacticus Firestorm Force", "priority", 1, "TACTICUS"),
  detachment("Terminator Storm Force", "priority", 1, "TERMINATOR")
];

// Chapter-specific Space Marine detachments excluded from divergent chapters
const CHAPTER_SPECIFIC_SM_NAMES = [
  "Blade of Ultramar",
  "Ceramite Sentinels",
  "Forgefather’s Seekers",
  "Medusa's Wrath",
  "Shadowmark Talon",
  "Spearpoint Task Force"
];

const CORE_SPACE_MARINE_DETACHMENTS = SPACE_MARINE_DETACHMENTS.filter(
  d => !CHAPTER_SPECIFIC_SM_NAMES.includes(d.name)
);

// Black Templars exclude Gladius Task Force from the core Space Marines pool
const BLACK_TEMPLARS_CORE_DETACHMENTS = CORE_SPACE_MARINE_DETACHMENTS.filter(
  d => d.name !== "Gladius Task Force"
);

// Deathwatch exclude Deathwatch Support from the core Space Marines pool
const DEATHWATCH_CORE_DETACHMENTS = CORE_SPACE_MARINE_DETACHMENTS.filter(
  d => d.name !== "Deathwatch Support"
);

export const DETACHMENTS_BY_FACTION = {
  "space-marines": SPACE_MARINE_DETACHMENTS,
  "imperial-fists": SPACE_MARINE_DETACHMENTS,
  "iron-hands": SPACE_MARINE_DETACHMENTS,
  "raven-guard": SPACE_MARINE_DETACHMENTS,
  salamanders: SPACE_MARINE_DETACHMENTS,
  ultramarines: SPACE_MARINE_DETACHMENTS,
  "white-scars": SPACE_MARINE_DETACHMENTS,
  "dark-angels": [
    detachment("Darkflight Pursuit", "recon", 1),
    detachment("Inner Circle Task Force", "priority", 1),
    detachment("Wrath of the Rock", "hold", 2, "TERMINATOR"),
    ...CORE_SPACE_MARINE_DETACHMENTS
  ],
  "blood-angels": [
    detachment("Angelic Inheritors", ["priority", "purge"], 3),
    detachment("Encarmine Speartip", "disruption", 1),
    detachment("Wrath of the Doomed", "purge", 1),
    ...CORE_SPACE_MARINE_DETACHMENTS
  ],
  "space-wolves": [
    detachment("Champions of Fenris", "priority", 1, "TERMINATOR"),
    detachment("Saga of the Beastslayer", "purge", 1),
    detachment("Saga of the Great Wolf", "hold", 2),
    ...CORE_SPACE_MARINE_DETACHMENTS
  ],
  "black-templars": [
    detachment("Fist of the God-Emperor", "hold", 1),
    detachment("Marshal's Household", "priority", 1),
    detachment("Vow-sworn Crusaders", "purge", 2),
    ...BLACK_TEMPLARS_CORE_DETACHMENTS
  ],
  deathwatch: [
    detachment("Black Spear Task Force", ["priority", "purge"], 3),
    ...DEATHWATCH_CORE_DETACHMENTS
  ],
  "grey-knights": [
    detachment("Argent Assault", "priority", 1),
    detachment("Augurium Task Force", "recon", 2),
    detachment("Banishers", "disruption", 2),
    detachment("Brotherhood Strike", "purge", 2),
    detachment("Fires of Purgation", "disruption", 1),
    detachment("Hallowed Conclave", "hold", 2),
    detachment("Immaterial Interdiction", "recon", 1),
    detachment("Sanctic Spearhead", "priority", 2),
    detachment("Warpbane Task Force", ["hold", "purge"], 3)
  ],
  "astra-militarum": [
    detachment("Abhuman Auxiliaries", "hold", 1, "ABHUMAN"),
    detachment("Armoured Infantry", "hold", 2),
    detachment("Bridgehead Strike", "priority", 1),
    detachment("Combined Arms", "hold", 2),
    detachment("Designation Force", "recon", 1, "RECON"),
    detachment("Grizzled Company", ["priority", "purge"], 3, "ABHUMAN"),
    detachment("Hammer of the Emperor", "purge", 2),
    detachment("Mechanised Assault", "recon", 2),
    detachment("Recon Element", "recon", 2, "RECON"),
    detachment("Siege Regiment", "disruption", 2),
    detachment("Steel Hammer", "purge", 2)
  ],
  "adepta-sororitas": [
    detachment("Army of Faith", "hold", 2),
    detachment("Bringers of Flame", "priority", 2),
    detachment("Champions of Faith", "disruption", 2, "REVEREND"),
    detachment("Chorus of Condemnation", "recon", 1),
    detachment("Hallowed Martyrs", ["hold", "priority"], 3),
    detachment("Penitent Host", "purge", 2),
    detachment("Sacred Champions", "hold", 1, "REVEREND"),
    detachment("Sanctified Orators", "disruption", 1)
  ],
  "adeptus-mechanicus": [
    detachment("Cohort Acquisitus", "recon", 1),
    detachment("Cohort Cybernetica", "hold", 1),
    detachment("Data-psalm Conclave", "disruption", 2, "DATA-PSALM"),
    detachment("Eradication Cohort", "purge", 2),
    detachment("Explorator Maniple", "priority", 2),
    detachment("Haloscreed Battle Clade", ["priority", "purge"], 3),
    detachment("Lords of the Forge", "priority", 2),
    detachment("Luminen Auto-Choir", "disruption", 1, "DATA-PSALM"),
    detachment("Rad-Zone Corps", "hold", 2),
    detachment("Skitarii Hunter Cohort", "recon", 2)
  ],
  "imperial-knights": [
    detachment("Dominus Foebreakers", "priority", 1),
    detachment("Freeblade Company", ["priority", "purge"], 3),
    detachment("Gate Warden Lance", "hold", 2),
    detachment("Questor Forgepact", "disruption", 1),
    detachment("Questoris Companions", ["hold", "recon"], 3),
    detachment("Spearhead-at-Arms", "recon", 2, "ARMIGERS"),
    detachment("Throne-bonded Outriders", "recon", 1, "ARMIGERS"),
    detachment("Valourstrike Lance", "purge", 2)
  ],
  "adeptus-custodes": [
    detachment("Auric Champions", "priority", 2),
    detachment("Lions of the Emperor", ["hold", "disruption"], 3, "LIONS"),
    detachment("Might of the Moritoi", "hold", 1, "ARMOURY"),
    detachment("Null Maiden Vigil", "recon", 2),
    detachment("Shield Host", "purge", 2),
    detachment("Silent Hunters", "recon", 1),
    detachment("Solar Spearhead", "hold", 2, "ARMOURY"),
    detachment("Talons of the Emperor", ["hold", "priority"], 3),
    detachment("Tharanatoi Hammerblow", "disruption", 1, "LIONS")
  ],
  "agents-of-imperium": [
    detachment("Imperialis Fleet", "recon", 2),
    detachment("Ordo Hereticus, Purgation Force", "hold", 2),
    detachment("Ordo Malleus, Daemon Hunters", "priority", 2),
    detachment("Ordo Xenos, Alien Hunters", "purge", 2),
    detachment("Veiled Blade Elimination Force", "disruption", 1)
  ],
  "titan-legions": [],
  "chaos-space-marines": [
    detachment("Cabal of Chaos", "disruption", 1),
    detachment("Chaos Cult", "priority", 2),
    detachment("Creations of Bile", ["hold", "purge"], 3),
    detachment("Cult of the Arkifane", "priority", 2),
    detachment("Deceptors", "disruption", 2),
    detachment("Devotees of Destruction", "priority", 1),
    detachment("Dread Talons", "disruption", 2),
    detachment("Fellhammer Siege-host", "hold", 2),
    detachment("Huron’s Marauders", ["disruption", "purge"], 3),
    detachment("Murdertalon Raiders", "recon", 1, "NIGHTMARE"),
    detachment("Nightmare Hunt", "disruption", 2, "NIGHTMARE"),
    detachment("Pactbound Zealots", ["disruption", "priority"], 3),
    detachment("Renegade Raiders", ["priority", "recon"], 3),
    detachment("Renegade Warband", "priority", 2),
    detachment("Soulforged Warpack", "hold", 2),
    detachment("Veterans of the Long War", "hold", 2),
    detachment("Warpstrike Champions", "disruption", 2)
  ],
  "alpha-legion": [],
  "black-legion": [],
  "iron-warriors": [],
  "night-lords": [],
  "red-corsairs": [],
  "word-bearers": [],
  "chaos-titan-legions": [],
  "world-eaters": [
    detachment("Berzerker Warband", "purge", 2),
    detachment("Brazen Engines", "disruption", 1),
    detachment("Butchers of Khorne", "hold", 1),
    detachment("Cult of Blood", "priority", 2),
    detachment("Goretrack Onslaught", "hold", 2),
    detachment("Khorne Daemonkin", "recon", 2),
    detachment("Possessed Slaughterband", "purge", 2),
    detachment("Vessels of Wrath", "priority", 1)
  ],
  "emperors-children": [
    detachment("Carnival of Excess", ["disruption", "priority"], 3),
    detachment("Coterie of the Conceited", ["priority", "purge"], 3),
    detachment("Court of the Phoenician", "purge", 2),
    detachment("Elegant Brutes", "hold", 1),
    detachment("Frenzied Host", "recon", 1),
    detachment("Mercurial Host", "recon", 2),
    detachment("Peerless Bladesmen", "priority", 2),
    detachment("Rapid Evisceration", "disruption", 2),
    detachment("Slaanesh’s Chosen", "purge", 1),
    detachment("Spectacle of Slaughter", "disruption", 1)
  ],
  "death-guard": [
    detachment("Champions of Contagion", "hold", 2),
    detachment("Contagion Engines", "recon", 1),
    detachment("Death Lord’s Chosen", "priority", 2),
    detachment("Flyblown Host", "recon", 1),
    detachment("Mortarion’s Hammer", "purge", 2),
    detachment("Paragons of Putrescence", "priority", 1),
    detachment("Shamblerot Vectorium", "disruption", 2),
    detachment("Tallyband Summoners", "disruption", 2),
    detachment("Virulent Vectorium", ["hold", "purge"], 3)
  ],
  "thousand-sons": [
    detachment("Changehost of Deceit", "recon", 2),
    detachment("Grand Coven", ["disruption", "priority"], 3),
    detachment("Hexwarp Thrallband", ["hold", "recon"], 3),
    detachment("Ritual of Regeneration", "hold", 1),
    detachment("Rubricae Phalanx", ["hold", "priority"], 3),
    detachment("Sekhetar Cohort", "disruption", 1),
    detachment("Servants of Change", "recon", 1, "MUTANT"),
    detachment("Warpforged Cabal", "priority", 2),
    detachment("Warpmeld Pact", "purge", 2, "MUTANT")
  ],
  "chaos-knights": [
    detachment("Bastions of Tyranny", "priority", 1),
    detachment("Helhunt Lance", "disruption", 2),
    detachment("Houndpack Lance", "recon", 2),
    detachment("Hunting Warpack", "recon", 1),
    detachment("Iconoclast Fiefdom", "hold", 1),
    detachment("Infernal Lance", ["priority", "purge"], 3),
    detachment("Lords of Dread", "hold", 2),
    detachment("Traitoris Lance", "purge", 2)
  ],
  "chaos-daemons": [
    detachment("Blood Legion", "purge", 2),
    detachment("Cavalcade of Chaos", "disruption", 1),
    detachment("Daemonic Incursion", ["hold", "disruption"], 3),
    detachment("Legion of Excess", "priority", 2),
    detachment("Lords of the Warp", "hold", 1),
    detachment("Plague Legion", "hold", 2),
    detachment("Scintillating Legion", "priority", 2),
    detachment("Shadow Legion", "purge", 2),
    detachment("Warptide", "recon", 1)
  ],
  aeldari: [
    detachment("Armoured Warhost", "recon", 1),
    detachment("Aspect Host", ["priority", "recon"], 3),
    detachment("Corsair Coterie", "priority", 2),
    detachment("Devoted of Ynnead", "priority", 2),
    detachment("Eldritch Raiders", "purge", 2),
    detachment("Fateful Performance", "disruption", 1, "ACROBATIC"),
    detachment("Ghosts of the Webway", "disruption", 2, "ACROBATIC"),
    detachment("Guardian Battlehost", "hold", 2),
    detachment("Path of the Outcast", "recon", 1),
    detachment("Seer Council", "priority", 2),
    detachment("Serpent’s Brood", "purge", 2, "ACROBATIC"),
    detachment("Spirit Conclave", "hold", 2),
    detachment("Twilight Flickers", "hold", 1, "ACROBATIC"),
    detachment("Warhost", "recon", 2),
    detachment("Windrider Host", "disruption", 2)
  ],
  drukhari: [
    detachment("Covenite Coterie", "hold", 2, "COVENS"),
    detachment("Exhibition of Slaughter", "recon", 1, "WYCH CULT"),
    detachment("Kabalite Agonysts", "disruption", 1, "KABAL"),
    detachment("Kabalite Cartel", "disruption", 2, "KABAL"),
    detachment("Realspace Raiders", "priority", 2),
    detachment("Reaper’s Wager", ["priority", "purge"], 3),
    detachment("Skysplinter Assault", "recon", 2),
    detachment("Spectacle of Spite", "purge", 2, "WYCH CULT"),
    detachment("Tools of Torment", "hold", 1, "COVENS")
  ],
  tyranids: [
    detachment("Ambush Predators", "disruption", 1),
    detachment("Assimilation Swarm", "priority", 2),
    detachment("Crusher Stampede", "purge", 2),
    detachment("Invasion Fleet", ["hold", "priority"], 3),
    detachment("Subterranean Assault", ["disruption", "recon"], 3),
    detachment("Synaptic Nexus", "disruption", 2),
    detachment("Talons of the Norn Queen", "hold", 1),
    detachment("Unending Swarm", "hold", 2),
    detachment("Vanguard Onslaught", "recon", 2),
    detachment("Warrior Bioform Onslaught", "hold", 1)
  ],
  "genestealer-cults": [
    detachment("Biosanctic Broodsurge", "hold", 2, "PURESTRAIN"),
    detachment("Brood Brothers Auxilia", "hold", 2),
    detachment("Final Day", "purge", 2),
    detachment("Heroes of the Uprising", "disruption", 1),
    detachment("Host of Ascension", ["hold", "recon"], 3, "HOSTS"),
    detachment("Outlander Claw", "recon", 2),
    detachment("Purestrain Broodswarm", "priority", 1, "PURESTRAIN"),
    detachment("Xenocreed Congregation", "priority", 2),
    detachment("Xenocult Masses", "recon", 1, "HOSTS")
  ],
  necrons: [
    detachment("Annihilation Legion", "purge", 2),
    detachment("Awakened Dynasty", ["hold", "priority"], 3, "DYNASTY"),
    detachment("Canoptek Court", "hold", 2),
    detachment("Cryptek Conclave", "priority", 2),
    detachment("Cursed Legion", "purge", 2),
    detachment("Hand of the Dynasty", "hold", 1, "DYNASTY"),
    detachment("Hypercrypt Legion", "recon", 2, "HYPERCRYPT"),
    detachment("Obeisance Phalanx", "disruption", 2),
    detachment("Pantheon of Woe", "disruption", 2),
    detachment("Skyshroud Spearhead", "recon", 1),
    detachment("Starshatter Arsenal", ["priority", "purge"], 3),
    detachment("The Phaeron's Armoury", "priority", 1, "HYPERCRYPT")
  ],
  orks: [
    detachment("Blitz Brigade", "hold", 1),
    detachment("Brute Bosses", "purge", 1),
    detachment("Bully Boyz", "purge", 1),
    detachment("Da Big Hunt", "purge", 1),
    detachment("Dread Mob", "purge", 1),
    detachment("Flyboyz", "recon", 1),
    detachment("Green Tide", "hold", 1),
    detachment("Kult of Speed", "recon", 1),
    detachment("Madcap Meks", "disruption", 1),
    detachment("Runt Swarm", "priority", 1),
    detachment("Shoota Boyz", "purge", 1),
    detachment("Taktikal Brigade", "hold", 1),
    detachment("War Horde", ["hold", "purge"], 3),
    detachment("Wreckas", "priority", 1),
    detachment("Wurrband", "disruption", 1)
  ],
  "tau-empire": [
    detachment("Advanced Acquisition Cadre", "recon", 1),
    detachment("Auxiliary Cadre", "disruption", 1, "AUXILIARY"),
    detachment("Experimental Prototype Cadre", "priority", 1, "BATTLESUIT"),
    detachment("Kauyon", "recon", 2),
    detachment("Kroot Hunting Pack", "hold", 2, "AUXILIARY"),
    detachment("Mont’ka", ["hold", "priority"], 3),
    detachment("Retaliation Cadre", ["purge", "recon"], 3, "BATTLESUIT")
  ],
  "leagues-of-votann": [
    detachment("Armoured Trailblazers", "disruption", 1),
    detachment("Brandfast Oathband", "hold", 2),
    detachment("Dêlve Assault Shift", "purge", 2),
    detachment("Farseekers", "recon", 1),
    detachment("Hearthband", ["priority", "recon"], 3, "HEARTHBAND"),
    detachment("Hearthfyre Arsenal", "priority", 2),
    detachment("Hearthguard Covenant", "priority", 1, "HEARTHBAND"),
    detachment("Mercenary Oathband", "hold", 2),
    detachment("Needgaârd Oathband", "purge", 2),
    detachment("Persecution Prospect", "disruption", 2)
  ]
};

// CSM sub-factions share the CSM detachment list
const CSM_DETACHMENTS = DETACHMENTS_BY_FACTION["chaos-space-marines"];
DETACHMENTS_BY_FACTION["alpha-legion"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["black-legion"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["iron-warriors"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["night-lords"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["red-corsairs"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["word-bearers"] = CSM_DETACHMENTS;
DETACHMENTS_BY_FACTION["imperial-agents"] = DETACHMENTS_BY_FACTION["agents-of-imperium"];

export function getFactionDetachments(factionSlug) {
  if (!factionSlug) return [];
  return DETACHMENTS_BY_FACTION[factionSlug] || [];
}

export function getDetachmentInfo(factionSlug, detachmentName) {
  const detachments = getFactionDetachments(factionSlug);
  return detachments.find(d => d.name === detachmentName) || null;
}
