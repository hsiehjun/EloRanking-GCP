/**
 * Factions and Detachments for Warhammer 40,000 11th Edition
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
      { value: "imperial-knights", label: "Imperial Knights" }
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

export function getFactionName(slug) {
  return slug && ALL_FACTIONS[slug] ? ALL_FACTIONS[slug].label : null;
}

const detachment = (name, disposition, dp) => ({ name, disposition, dp });

const SPACE_MARINE_DETACHMENTS = [
  detachment("Fulguris Task Force", "recon", 1),
  detachment("Librarius Conclave", "recon", 1),
  detachment("Subversion Assets", "disruption", 1),
  detachment("Vengeful Hosts", "hold", 1),
  detachment("1st Company Task Force", "purge", 2),
  detachment("Anvil Siege Force", "hold", 2),
  detachment("Armoured Speartip", "hold", 3),
  detachment("Bastion Task Force", "hold", 2),
  detachment("Blade of Ultramar", "priority", 3),
  detachment("Ceramite Sentinels", "hold", 3),
  detachment("Emperor’s Shield", "purge", 2),
  detachment("Firestorm Assault Force", "priority", 2),
  detachment("Forgefather’s Seekers", "priority", 2),
  detachment("Gladius Task Force", "priority", 3),
  detachment("Hammer of Avernii", "purge", 2),
  detachment("Headhunter Task Force", "priority", 2),
  detachment("Ironstorm Spearhead", "hold", 2),
  detachment("Orbital Assault Force", "hold", 2),
  detachment("Reclamation Force", "hold", 2),
  detachment("Shadowmark Talon", "disruption", 2),
  detachment("Spearpoint Task Force", "disruption", 2),
  detachment("Stormlance Task Force", "disruption", 3),
  detachment("Vanguard Spearhead", "recon", 2)
];

export const DETACHMENTS_BY_FACTION = {
  "space-marines": SPACE_MARINE_DETACHMENTS,
  "imperial-fists": SPACE_MARINE_DETACHMENTS,
  "iron-hands": SPACE_MARINE_DETACHMENTS,
  "raven-guard": SPACE_MARINE_DETACHMENTS,
  salamanders: SPACE_MARINE_DETACHMENTS,
  ultramarines: SPACE_MARINE_DETACHMENTS,
  "white-scars": SPACE_MARINE_DETACHMENTS,
  "dark-angels": [
    detachment("Dark Age Arsenal", "priority", 1),
    detachment("Darkflight Pursuit", "recon", 1),
    detachment("Interrogation Conclave", "hold", 1),
    detachment("Company of Hunters", "disruption", 2),
    detachment("Inner Circle Task Force", "priority", 2),
    detachment("Lion’s Blade Task Force", "purge", 2),
    detachment("Unforgiven Task Force", "hold", 2),
    detachment("Wrath of the Rock", "priority", 3)
  ],
  "blood-angels": [
    detachment("Encarmine Speartip", "disruption", 1),
    detachment("Legacy of Grace", "priority", 1),
    detachment("Wrath of the Doomed", "purge", 1),
    detachment("Angelic Inheritors", "priority", 3),
    detachment("Liberator Assault Group", "hold", 3),
    detachment("Rage-cursed Onslaught", "purge", 3),
    detachment("The Angelic Host", "disruption", 2),
    detachment("The Lost Brethren", "purge", 2)
  ],
  "space-wolves": [
    detachment("Champions of Fenris", "priority", 1),
    detachment("Legends of Saga and Song", "hold", 1),
    detachment("Veterans of the Fang", "disruption", 1),
    detachment("Saga of the Beastslayer", "purge", 2),
    detachment("Saga of the Bold", "priority", 2),
    detachment("Saga of the Great Wolf", "hold", 2),
    detachment("Saga of the Hunter", "disruption", 2)
  ],
  "black-templars": [
    detachment("Marshal's Household", "priority", 1),
    detachment("The Living Miracle", "disruption", 1),
    detachment("Wrathful Procession", "hold", 1),
    detachment("Companions of Vehemence", "purge", 2),
    detachment("Godhammer Assault Force", "purge", 2),
    detachment("Vindication Task Force", "priority", 2)
  ],
  deathwatch: [
    detachment("Black Spear Task Force", "purge", 3)
  ],
  "grey-knights": [
    detachment("Argent Assault", "priority", 1),
    detachment("Fires of Purgation", "disruption", 1),
    detachment("Immaterial Interdiction", "recon", 1),
    detachment("Augurium Task Force", "recon", 2),
    detachment("Banishers", "disruption", 2),
    detachment("Brotherhood Strike", "purge", 2),
    detachment("Hallowed Conclave", "hold", 2),
    detachment("Sanctic Spearhead", "priority", 2),
    detachment("Warpbane Task Force", "hold", 3)
  ],
  "astra-militarum": [
    detachment("Abhuman Auxiliaries", "hold", 1),
    detachment("Bridgehead Strike", "priority", 1),
    detachment("Designation Force", "recon", 1),
    detachment("Armoured Infantry", "hold", 2),
    detachment("Combined Arms", "hold", 2),
    detachment("Grizzled Company", "priority", 3),
    detachment("Hammer of the Emperor", "purge", 2),
    detachment("Mechanised Assault", "recon", 2),
    detachment("Recon Element", "recon", 3),
    detachment("Siege Regiment", "disruption", 2),
    detachment("Steel Hammer", "purge", 2)
  ],
  "adepta-sororitas": [
    detachment("Chorus of Condemnation", "recon", 1),
    detachment("Sacred Champions", "hold", 1),
    detachment("Sanctified Orators", "disruption", 1),
    detachment("Army of Faith", "hold", 2),
    detachment("Bringers of Flame", "priority", 2),
    detachment("Champions of Faith", "disruption", 2),
    detachment("Hallowed Martyrs", "priority", 3),
    detachment("Penitent Host", "purge", 2)
  ],
  "adeptus-mechanicus": [
    detachment("Cohort Acquisitus", "recon", 1),
    detachment("Lords of the Forge", "priority", 1),
    detachment("Luminen Auto-Choir", "disruption", 1),
    detachment("Cohort Cybernetica", "hold", 2),
    detachment("Data-psalm Conclave", "disruption", 2),
    detachment("Eradication Cohort", "purge", 3),
    detachment("Explorator Maniple", "priority", 2),
    detachment("Haloscreed Battle Clade", "priority", 3),
    detachment("Rad-Zone Corps", "hold", 2),
    detachment("Skitarii Hunter Cohort", "recon", 2)
  ],
  "imperial-knights": [
    detachment("Dominus Foebreakers", "priority", 1),
    detachment("Questor Forgepact", "disruption", 1),
    detachment("Throne-bonded Outriders", "recon", 1),
    detachment("Freeblade Company", "priority", 3),
    detachment("Gate Warden Lance", "hold", 2),
    detachment("Questoris Companions", "hold", 3),
    detachment("Spearhead-at-Arms", "recon", 2),
    detachment("Valourstrike Lance", "purge", 2)
  ],
  "adeptus-custodes": [
    detachment("Might of the Moritoi", "hold", 1),
    detachment("Silent Hunters", "recon", 1),
    detachment("Tharanatoi Hammerblow", "priority", 1),
    detachment("Auric Champions", "priority", 2),
    detachment("Lions of the Emperor", "disruption", 2),
    detachment("Null Maiden Vigil", "recon", 2),
    detachment("Shield Host", "purge", 2),
    detachment("Solar Spearhead", "hold", 2),
    detachment("Talons of the Emperor", "hold", 3)
  ],
  "agents-of-imperium": [
    detachment("Imperialis Fleet", "recon", 2),
    detachment("Ordo Hereticus, Purgation Force", "hold", 2),
    detachment("Ordo Malleus, Daemon Hunters", "priority", 2),
    detachment("Ordo Xenos, Alien Hunters", "purge", 2),
    detachment("Veiled Blade Elimination Force", "disruption", 1)
  ],
  "chaos-space-marines": [
    detachment("Cabal of Chaos", "disruption", 1),
    detachment("Devotees of Destruction", "priority", 1),
    detachment("Murdertalon Raiders", "recon", 1),
    detachment("Chaos Cult", "priority", 2),
    detachment("Creations of Bile", "purge", 3),
    detachment("Cult of the Arkifane", "priority", 2),
    detachment("Deceptors", "disruption", 2),
    detachment("Dread Talons", "disruption", 2),
    detachment("Fellhammer Siege-host", "hold", 2),
    detachment("Huron’s Marauders", "disruption", 3),
    detachment("Nightmare Hunt", "disruption", 2),
    detachment("Pactbound Zealots", "priority", 3),
    detachment("Renegade Raiders", "recon", 3),
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
  "world-eaters": [
    detachment("Butchers of Khorne", "hold", 1),
    detachment("Brazen Engines", "disruption", 1),
    detachment("Vessels of Wrath", "priority", 1),
    detachment("Berzerker Warband", "purge", 3),
    detachment("Cult of Blood", "priority", 2),
    detachment("Goretrack Onslaught", "hold", 2),
    detachment("Khorne Daemonkin", "recon", 2),
    detachment("Possessed Slaughterband", "purge", 2)
  ],
  "emperors-children": [
    detachment("Elegant Brutes", "hold", 1),
    detachment("Frenzied Host", "recon", 1),
    detachment("Spectacle of Slaughter", "disruption", 1),
    detachment("Carnival of Excess", "disruption", 2),
    detachment("Coterie of the Conceited", "priority", 3),
    detachment("Court of the Phoenician", "purge", 2),
    detachment("Mercurial Host", "recon", 2),
    detachment("Peerless Bladesmen", "priority", 2),
    detachment("Rapid Evisceration", "disruption", 2),
    detachment("Slaanesh’s Chosen", "purge", 2)
  ],
  "death-guard": [
    detachment("Paragons of Putrescence", "priority", 1),
    detachment("Contagion Engines", "recon", 1),
    detachment("Flyblown Host", "recon", 1),
    detachment("Champions of Contagion", "hold", 2),
    detachment("Death Lord’s Chosen", "priority", 2),
    detachment("Mortarion’s Hammer", "purge", 2),
    detachment("Shamblerot Vectorium", "disruption", 2),
    detachment("Tallyband Summoners", "disruption", 2),
    detachment("Virulent Vectorium", "hold", 3)
  ],
  "thousand-sons": [
    detachment("Ritual of Regeneration", "hold", 1),
    detachment("Sekhetar Cohort", "disruption", 1),
    detachment("Servants of Change", "recon", 1),
    detachment("Changehost of Deceit", "recon", 2),
    detachment("Grand Coven", "priority", 3),
    detachment("Hexwarp Thrallband", "hold", 3),
    detachment("Rubricae Phalanx", "hold", 3),
    detachment("Warpforged Cabal", "priority", 2),
    detachment("Warpmeld Pact", "purge", 2)
  ],
  "chaos-knights": [
    detachment("Bastions of Tyranny", "priority", 1),
    detachment("Hunting Warpack", "recon", 1),
    detachment("Iconoclast Fiefdom", "hold", 1),
    detachment("Helhunt Lance", "disruption", 2),
    detachment("Houndpack Lance", "recon", 2),
    detachment("Infernal Lance", "priority", 3),
    detachment("Lords of Dread", "hold", 2),
    detachment("Traitoris Lance", "purge", 2)
  ],
  "chaos-daemons": [
    detachment("Cavalcade of Chaos", "disruption", 1),
    detachment("Lords of the Warp", "hold", 1),
    detachment("Warptide", "recon", 1),
    detachment("Blood Legion", "purge", 2),
    detachment("Daemonic Incursion", "disruption", 3),
    detachment("Legion of Excess", "priority", 2),
    detachment("Plague Legion", "hold", 2),
    detachment("Scintillating Legion", "priority", 2),
    detachment("Shadow Legion", "purge", 2)
  ],
  aeldari: [
    detachment("Armoured Warhost", "recon", 1),
    detachment("Fateful Performance", "disruption", 1),
    detachment("Path of the Outcast", "recon", 1),
    detachment("Twilight Flickers", "hold", 1),
    detachment("Aspect Host", "disruption", 3),
    detachment("Corsair Coterie", "priority", 2),
    detachment("Devoted of Ynnead", "priority", 2),
    detachment("Eldritch Raiders", "purge", 2),
    detachment("Ghosts of the Webway", "disruption", 2),
    detachment("Guardian Battlehost", "hold", 2),
    detachment("Seer Council", "priority", 2),
    detachment("Serpent’s Brood", "purge", 2),
    detachment("Spirit Conclave", "hold", 2),
    detachment("Warhost", "recon", 3),
    detachment("Windrider Host", "disruption", 2)
  ],
  drukhari: [
    detachment("Exhibition of Slaughter", "recon", 1),
    detachment("Kabalite Agonysts", "disruption", 1),
    detachment("Tools of Torment", "hold", 1),
    detachment("Covenite Coterie", "hold", 2),
    detachment("Kabalite Cartel", "disruption", 2),
    detachment("Realspace Raiders", "priority", 2),
    detachment("Reaper’s Wager", "purge", 3),
    detachment("Skysplinter Assault", "recon", 2),
    detachment("Spectacle of Spite", "purge", 2)
  ],
  tyranids: [
    detachment("Ambush Predators", "disruption", 1),
    detachment("Talons of the Norn Queen", "hold", 1),
    detachment("Warrior Bioform Onslaught", "hold", 1),
    detachment("Assimilation Swarm", "priority", 2),
    detachment("Crusher Stampede", "purge", 2),
    detachment("Invasion Fleet", "hold", 3),
    detachment("Subterranean Assault", "disruption", 3),
    detachment("Synaptic Nexus", "disruption", 2),
    detachment("Unending Swarm", "hold", 2),
    detachment("Vanguard Onslaught", "recon", 2)
  ],
  "genestealer-cults": [
    detachment("Heroes of the Uprising", "disruption", 1),
    detachment("Purestrain Broodswarm", "priority", 1),
    detachment("Xenocult Masses", "recon", 1),
    detachment("Biosanctic Broodsurge", "hold", 2),
    detachment("Brood Brothers Auxilia", "hold", 2),
    detachment("Final Day", "purge", 2),
    detachment("Host of Ascension", "hold", 3),
    detachment("Outlander Claw", "recon", 2),
    detachment("Xenocreed Congregation", "priority", 2)
  ],
  necrons: [
    detachment("Hand of the Dynasty", "hold", 1),
    detachment("Skyshroud Spearhead", "recon", 1),
    detachment("The Phaeron's Armoury", "priority", 1),
    detachment("Annihilation Legion", "purge", 2),
    detachment("Awakened Dynasty", "hold", 3),
    detachment("Canoptek Court", "hold", 3),
    detachment("Cryptek Conclave", "priority", 2),
    detachment("Cursed Legion", "purge", 2),
    detachment("Hypercrypt Legion", "recon", 2),
    detachment("Obeisance Phalanx", "disruption", 2),
    detachment("Pantheon of Woe", "disruption", 2),
    detachment("Starshatter Arsenal", "priority", 3)
  ],
  orks: [
    detachment("Equatorial Hordes", "disruption", 1),
    detachment("More Dakka!", "disruption", 1),
    detachment("Rollin' Deff", "priority", 1),
    detachment("Taktikal Brigade", "recon", 1),
    detachment("Blitz Brigade", "recon", 2),
    detachment("Bully Boyz", "purge", 2),
    detachment("Da Big Hunt", "purge", 2),
    detachment("Dread Mob", "priority", 2),
    detachment("Freebooter Krew", "hold", 2),
    detachment("Green Tide", "hold", 3),
    detachment("Kult of Speed", "disruption", 2),
    detachment("Speedwaaagh!", "recon", 2),
    detachment("War Horde", "hold", 3)
  ],
  "tau-empire": [
    detachment("Advanced Acquisition Cadre", "recon", 1),
    detachment("Auxiliary Cadre", "disruption", 1),
    detachment("Experimental Prototype Cadre", "priority", 1),
    detachment("Kauyon", "recon", 2),
    detachment("Kroot Hunting Pack", "hold", 2),
    detachment("Mont’ka", "priority", 3),
    detachment("Retaliation Cadre", "purge", 3)
  ],
  "leagues-of-votann": [
    detachment("Armoured Trailblazers", "disruption", 1),
    detachment("Farseekers", "recon", 1),
    detachment("Hearthguard Covenant", "priority", 1),
    detachment("Brandfast Oathband", "hold", 2),
    detachment("Dêlve Assault Shift", "purge", 2),
    detachment("Hearthband", "priority", 3),
    detachment("Hearthfyre Arsenal", "priority", 2),
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

export function getFactionDetachments(factionSlug) {
  if (!factionSlug) return [];
  return DETACHMENTS_BY_FACTION[factionSlug] || [];
}

export function getDetachmentInfo(factionSlug, detachmentName) {
  const detachments = getFactionDetachments(factionSlug);
  return detachments.find(d => d.name === detachmentName) || null;
}
