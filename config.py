"""Configuration settings for Best Coast Pairings scraper and multi-game Elo engine."""

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


def get_package_dir() -> Path:
    """Returns the package directory containing config.py, database.py, and web/."""
    file_dir = Path(__file__).resolve().parent
    if (file_dir / "web" / "index.html").exists() or (file_dir / "database.py").exists():
        return file_dir

    if "BUILD_WORKSPACE_DIRECTORY" in os.environ:
        p = Path(os.environ["BUILD_WORKSPACE_DIRECTORY"]) / "experimental" / "users" / "hsiehjun" / "EloRanking"
        if p.exists():
            return p

    for parent in [file_dir, file_dir.parent, file_dir.parent.parent]:
        if (parent / "web" / "index.html").exists() or (parent / "database.py").exists():
            return parent

    return file_dir


# PostgreSQL Database Configuration
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    os.environ.get("POSTGRES_DSN", "postgresql://elo_user:elo_password@localhost:5432/elo_ranking")
)

# Best Coast Pairings API Configuration
BCP_API_BASE = "https://newprod-api.bestcoastpairings.com/v1"
BCP_CLIENT_ID = "web-app"
BCP_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

DEFAULT_HEADERS = {
    "client-id": BCP_CLIENT_ID,
    "env": "bcp",
    "User-Agent": BCP_USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.bestcoastpairings.com",
    "Referer": "https://www.bestcoastpairings.com/",
}

# Canonical Game Systems Catalog (All 120 supported BCP & multi-platform systems sorted by popularity)
BCP_GAME_SYSTEMS_CATALOG: List[Dict[str, Any]] = [
    {
        "slug": "40k",
        "bcp_id": "WGMSzfKFYA",
        "short_name": "40K",
        "name": "Warhammer 40,000",
        "bcp_name": "Warhammer 40,000",
        "manufacturer": "Games Workshop",
        "icon": "⚔️",
        "has_tracker": True,
        "popularity_rank": 1
    },
    {
        "slug": "aos",
        "bcp_id": "OY8FCPBf6O",
        "short_name": "AoS",
        "name": "Age of Sigmar",
        "bcp_name": "Age of Sigmar",
        "manufacturer": "Games Workshop",
        "icon": "⚡",
        "has_tracker": True,
        "popularity_rank": 2
    },
    {
        "slug": "kill_team",
        "bcp_id": "kQGCslQaL7",
        "short_name": "Kill Team",
        "name": "Warhammer 40K: Kill Team",
        "bcp_name": "Kill Team",
        "manufacturer": "Games Workshop",
        "icon": "🎯",
        "has_tracker": False,
        "popularity_rank": 3
    },
    {
        "slug": "the_old_world",
        "bcp_id": "pd0PejEmWE",
        "short_name": "Old World",
        "name": "Warhammer: The Old World",
        "bcp_name": "Warhammer The Old World",
        "manufacturer": "Games Workshop",
        "icon": "🛡️",
        "has_tracker": False,
        "popularity_rank": 4
    },
    {
        "slug": "horus_heresy",
        "bcp_id": "pLmYM0zV1m",
        "short_name": "Horus Heresy",
        "name": "Warhammer: The Horus Heresy",
        "bcp_name": "Horus Heresy",
        "manufacturer": "Games Workshop",
        "icon": "🦅",
        "has_tracker": False,
        "popularity_rank": 5
    },
    {
        "slug": "spearhead",
        "bcp_id": "7T4AAHWA8b",
        "short_name": "Spearhead",
        "name": "Age of Sigmar: Spearhead",
        "bcp_name": "Age of Sigmar: Spearhead",
        "manufacturer": "Games Workshop",
        "icon": "🗡️",
        "has_tracker": False,
        "popularity_rank": 6
    },
    {
        "slug": "blood_bowl",
        "bcp_id": "VxekqWJWRW",
        "short_name": "Blood Bowl",
        "name": "Blood Bowl",
        "bcp_name": "Blood Bowl",
        "manufacturer": "Games Workshop",
        "icon": "🏈",
        "has_tracker": False,
        "popularity_rank": 7
    },
    {
        "slug": "middle_earth",
        "bcp_id": "NogdsFot9Q",
        "short_name": "Middle-earth",
        "name": "Middle-earth SBG",
        "bcp_name": "Middle Earth",
        "manufacturer": "Games Workshop",
        "icon": "💍",
        "has_tracker": False,
        "popularity_rank": 8
    },
    {
        "slug": "underworlds",
        "bcp_id": "Z8rcM0GCLw",
        "short_name": "Underworlds",
        "name": "Warhammer Underworlds",
        "bcp_name": "Warhammer Underworlds",
        "manufacturer": "Games Workshop",
        "icon": "💎",
        "has_tracker": False,
        "popularity_rank": 9
    },
    {
        "slug": "warcry",
        "bcp_id": "8pva9b91NJ",
        "short_name": "Warcry",
        "name": "Warcry",
        "bcp_name": "Warcry",
        "manufacturer": "Games Workshop",
        "icon": "🔥",
        "has_tracker": False,
        "popularity_rank": 10
    },
    {
        "slug": "necromunda",
        "bcp_id": "iHOUMbQAPk",
        "short_name": "Necromunda",
        "name": "Necromunda",
        "bcp_name": "Necromunda",
        "manufacturer": "Games Workshop",
        "icon": "☣️",
        "has_tracker": False,
        "popularity_rank": 11
    },
    {
        "slug": "legions_imp",
        "bcp_id": "uSoKBpnzGY",
        "short_name": "Legions Imp.",
        "name": "Legions Imperialis",
        "bcp_name": "Legions Imperialis",
        "manufacturer": "Games Workshop",
        "icon": "🏛️",
        "has_tracker": False,
        "popularity_rank": 12
    },
    {
        "slug": "bolt_action",
        "bcp_id": "UmFqbjCucw",
        "short_name": "Bolt Action",
        "name": "Bolt Action",
        "bcp_name": "Bolt Action",
        "manufacturer": "Warlord Games",
        "icon": "🪖",
        "has_tracker": False,
        "popularity_rank": 13
    },
    {
        "slug": "mcp",
        "bcp_id": "fQjQW821Cd",
        "short_name": "Crisis Protocol",
        "name": "Marvel: Crisis Protocol",
        "bcp_name": "Crisis Protocol",
        "manufacturer": "Atomic Mass Games",
        "icon": "🦸",
        "has_tracker": False,
        "popularity_rank": 14
    },
    {
        "slug": "sw_legion",
        "bcp_id": "WmHfUlqrcl",
        "short_name": "SW Legion",
        "name": "Star Wars: Legion",
        "bcp_name": "Star Wars Legion",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🪐",
        "has_tracker": False,
        "popularity_rank": 15
    },
    {
        "slug": "shatterpoint",
        "bcp_id": "mg9pmmIegg",
        "short_name": "Shatterpoint",
        "name": "Star Wars: Shatterpoint",
        "bcp_name": "Shatterpoint",
        "manufacturer": "Atomic Mass Games",
        "icon": "🪐",
        "has_tracker": False,
        "popularity_rank": 16
    },
    {
        "slug": "trench_crusade",
        "bcp_id": "67392a1b8a704ed13fbdc5ab",
        "short_name": "Trench Crusade",
        "name": "Trench Crusade",
        "bcp_name": "Trench Crusade",
        "manufacturer": "Trench Crusade",
        "icon": "✝️",
        "has_tracker": False,
        "popularity_rank": 17
    },
    {
        "slug": "battletech_as",
        "bcp_id": "6SU00J8VBy",
        "short_name": "Alpha Strike",
        "name": "BattleTech: Alpha Strike",
        "bcp_name": "Battletech Alpha Strike",
        "manufacturer": "Catalyst",
        "icon": "🦿",
        "has_tracker": False,
        "popularity_rank": 18
    },
    {
        "slug": "battletech",
        "bcp_id": "66db51a9a21310856d0273cb",
        "short_name": "BattleTech",
        "name": "Classic BattleTech",
        "bcp_name": "Classic Battletech",
        "manufacturer": "Catalyst",
        "icon": "🦿",
        "has_tracker": False,
        "popularity_rank": 19
    },
    {
        "slug": "conquest",
        "bcp_id": "h3DLVTOPg3",
        "short_name": "Conquest",
        "name": "Conquest: Last Argument of Kings",
        "bcp_name": "Conquest",
        "manufacturer": "Para Bellum",
        "icon": "⚔️",
        "has_tracker": False,
        "popularity_rank": 20
    },
    {
        "slug": "warmachine",
        "bcp_id": "GCj1RjTY6F",
        "short_name": "Warmachine",
        "name": "Warmachine",
        "bcp_name": "Warmachine",
        "manufacturer": "Steamforged Games",
        "icon": "⚙️",
        "has_tracker": False,
        "popularity_rank": 21
    },
    {
        "slug": "infinity",
        "bcp_id": "OMeSULv5Wo",
        "short_name": "Infinity",
        "name": "Infinity",
        "bcp_name": "Infinity",
        "manufacturer": "Corvus Belli",
        "icon": "🛰️",
        "has_tracker": False,
        "popularity_rank": 22
    },
    {
        "slug": "malifaux",
        "bcp_id": "GJ0BZEcHbF",
        "short_name": "Malifaux",
        "name": "Malifaux",
        "bcp_name": "Malifaux",
        "manufacturer": "Wyrd",
        "icon": "🎩",
        "has_tracker": False,
        "popularity_rank": 23
    },
    {
        "slug": "asoiaf",
        "bcp_id": "uHh26WUNJT",
        "short_name": "ASOIAF",
        "name": "A Song of Ice and Fire TMG",
        "bcp_name": "Song of Fire and Ice",
        "manufacturer": "CMON",
        "icon": "🐺",
        "has_tracker": False,
        "popularity_rank": 24
    },
    {
        "slug": "flames_of_war",
        "bcp_id": "HZzH6H8DRI",
        "short_name": "Flames of War",
        "name": "Flames of War",
        "bcp_name": "Flames of War",
        "manufacturer": "Battlefront Miniatures",
        "icon": "🎖️",
        "has_tracker": False,
        "popularity_rank": 25
    },
    {
        "slug": "grimdark_opr",
        "bcp_id": "vuttDt4BsI",
        "short_name": "Grimdark OPR",
        "name": "Grimdark Future (OPR)",
        "bcp_name": "Grim Dark Future",
        "manufacturer": "One Page Rules",
        "icon": "🌌",
        "has_tracker": False,
        "popularity_rank": 26
    },
    {
        "slug": "halo_flashpt",
        "bcp_id": "677b16d926624e31ba8f551c",
        "short_name": "Halo Flashpoint",
        "name": "Halo: Flashpoint",
        "bcp_name": "Halo: Flashpoint",
        "manufacturer": "Mantic Games",
        "icon": "🪖",
        "has_tracker": False,
        "popularity_rank": 27
    },
    {
        "slug": "guild_ball",
        "bcp_id": "ext_guild_ball",
        "short_name": "Guild Ball",
        "name": "Guild Ball",
        "bcp_name": "Guild Ball",
        "manufacturer": "Steamforged Games",
        "icon": "⚽",
        "has_tracker": False,
        "popularity_rank": 28
    },
    {
        "slug": "one_piece",
        "bcp_id": "r5jWPuzwHN",
        "short_name": "One Piece",
        "name": "One Piece Card Game",
        "bcp_name": "One Piece",
        "manufacturer": "Bandai",
        "icon": "🏴‍☠️",
        "has_tracker": False,
        "popularity_rank": 29
    },
    {
        "slug": "yugioh",
        "bcp_id": "mM4pewNtcT",
        "short_name": "Yu-Gi-Oh!",
        "name": "Yu-Gi-Oh! TCG",
        "bcp_name": "Yu-Gi-Oh!",
        "manufacturer": "Konami",
        "icon": "🔮",
        "has_tracker": False,
        "popularity_rank": 30
    },
    {
        "slug": "mtg",
        "bcp_id": "FM1PYUZbsL",
        "short_name": "MTG",
        "name": "Magic: The Gathering",
        "bcp_name": "Magic the Gathering",
        "manufacturer": "Wizards of the Coast",
        "icon": "🔥",
        "has_tracker": False,
        "popularity_rank": 31
    },
    {
        "slug": "commander",
        "bcp_id": "2UgcKy4txd",
        "short_name": "Commander",
        "name": "MTG: Commander",
        "bcp_name": "Commander",
        "manufacturer": "Wizards of the Coast",
        "icon": "🧙",
        "has_tracker": False,
        "popularity_rank": 32
    },
    {
        "slug": "pokemon",
        "bcp_id": "Y9lj1TOc6A",
        "short_name": "Pokémon",
        "name": "Pokémon TCG",
        "bcp_name": "Pokémon",
        "manufacturer": "Nintendo",
        "icon": "⚡",
        "has_tracker": False,
        "popularity_rank": 33
    },
    {
        "slug": "lorcana",
        "bcp_id": "l0vo0C77Ch",
        "short_name": "Lorcana",
        "name": "Disney Lorcana",
        "bcp_name": "Lorcana",
        "manufacturer": "Ravensburger",
        "icon": "✨",
        "has_tracker": False,
        "popularity_rank": 34
    },
    {
        "slug": "digimon",
        "bcp_id": "0O1SPSSzw2",
        "short_name": "Digimon",
        "name": "Digimon Card Game",
        "bcp_name": "Digimon Card Game",
        "manufacturer": "Bandai",
        "icon": "🦖",
        "has_tracker": False,
        "popularity_rank": 35
    },
    {
        "slug": "riftbound",
        "bcp_id": "ext_riftbound",
        "short_name": "Riftbound",
        "name": "Riftbound: League of Legends TCG",
        "bcp_name": "Riftbound",
        "manufacturer": "Riot Games",
        "icon": "🌀",
        "has_tracker": False,
        "popularity_rank": 36
    },
    {
        "slug": "gundam_tcg",
        "bcp_id": "67ae9f34b9bba6cca026e77f",
        "short_name": "Gundam TCG",
        "name": "Gundam Card Game",
        "bcp_name": "Gundam TCG",
        "manufacturer": "Bandai",
        "icon": "🤖",
        "has_tracker": False,
        "popularity_rank": 37
    },
    {
        "slug": "flesh_blood",
        "bcp_id": "oDXFQoeX0M",
        "short_name": "Flesh & Blood",
        "name": "Flesh and Blood TCG",
        "bcp_name": "Flesh And Blood",
        "manufacturer": "Legend Story Studio",
        "icon": "🩸",
        "has_tracker": False,
        "popularity_rank": 38
    },
    {
        "slug": "sw_unlimited",
        "bcp_id": "SImHT3ZR3V",
        "short_name": "SW Unlimited",
        "name": "Star Wars: Unlimited",
        "bcp_name": "Star Wars Unlimited",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🪐",
        "has_tracker": False,
        "popularity_rank": 39
    },
    {
        "slug": "generic",
        "bcp_id": "H1hbQ5G0eY",
        "short_name": "Generic",
        "name": "Generic / Other Tabletop",
        "bcp_name": "Generic",
        "manufacturer": "Generic",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 40
    },
    {
        "slug": "catan_champ",
        "bcp_id": "VkLBPJ4lQb",
        "short_name": "CATAN Champ.",
        "name": "CATAN Championship",
        "bcp_name": "CATAN Championship",
        "manufacturer": "CATAN",
        "icon": "🏆",
        "has_tracker": False,
        "popularity_rank": 41
    },
    {
        "slug": "shard_bugs_tcg",
        "bcp_id": "6786db6b26624e31ba8f5534",
        "short_name": "Shard Bugs TCG",
        "name": "Shard Bugs TCG",
        "bcp_name": "Shard Bugs TCG",
        "manufacturer": "Shard Bugs",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 42
    },
    {
        "slug": "soul_masters_t",
        "bcp_id": "67af3471bf62de059769280a",
        "short_name": "Soul Masters TCG",
        "name": "Soul Masters TCG",
        "bcp_name": "Soul Masters TCG",
        "manufacturer": "Soul Masters",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 43
    },
    {
        "slug": "catan",
        "bcp_id": "ADvcKMDSFy",
        "short_name": "CATAN",
        "name": "CATAN",
        "bcp_name": "CATAN",
        "manufacturer": "CATAN",
        "icon": "🏝️",
        "has_tracker": False,
        "popularity_rank": 44
    },
    {
        "slug": "dbs_fusion",
        "bcp_id": "hrIkLY89ww",
        "short_name": "DBS Fusion",
        "name": "Dragon Ball Super: Fusion World",
        "bcp_name": "DBS Fusion World",
        "manufacturer": "Bandai",
        "icon": "🐉",
        "has_tracker": False,
        "popularity_rank": 45
    },
    {
        "slug": "dbs",
        "bcp_id": "POYzp05n9p",
        "short_name": "Dragon Ball",
        "name": "Dragon Ball Super Card Game",
        "bcp_name": "Dragon Ball Super",
        "manufacturer": "Bandai",
        "icon": "🐉",
        "has_tracker": False,
        "popularity_rank": 46
    },
    {
        "slug": "union_arena",
        "bcp_id": "66eb85e893f18eaacd38a818",
        "short_name": "Union Arena",
        "name": "Union Arena TCG",
        "bcp_name": "Union Arena",
        "manufacturer": "Bandai",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 47
    },
    {
        "slug": "primal_tcg",
        "bcp_id": "6608f946040ba4024c011a36",
        "short_name": "Primal TCG",
        "name": "Primal TCG",
        "bcp_name": "Primal TCG",
        "manufacturer": "Dattebayo Labs",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 48
    },
    {
        "slug": "final_fantasy_",
        "bcp_id": "8GFaZ0y25D",
        "short_name": "Final Fantasy T…",
        "name": "Final Fantasy TCG",
        "bcp_name": "Final Fantasy TCG",
        "manufacturer": "SQUARE ENIX",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 49
    },
    {
        "slug": "force_of_will",
        "bcp_id": "2s24lv1FXr",
        "short_name": "Force of Will",
        "name": "Force of Will",
        "bcp_name": "Force of Will",
        "manufacturer": "Force of Will",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 50
    },
    {
        "slug": "ww3_team_yanke",
        "bcp_id": "66db52c8fe9b80fb2f18ce94",
        "short_name": "WW3 Team Yankee",
        "name": "WW3 Team Yankee",
        "bcp_name": "WW3 Team Yankee",
        "manufacturer": "Battlefront Miniatures",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 51
    },
    {
        "slug": "aof_opr",
        "bcp_id": "trBDgd23tVbT",
        "short_name": "Age of Fantasy",
        "name": "Age of Fantasy (OPR)",
        "bcp_name": "Age of Fantasy",
        "manufacturer": "One Page Rules",
        "icon": "🐉",
        "has_tracker": False,
        "popularity_rank": 52
    },
    {
        "slug": "battletech_tw",
        "bcp_id": "66db524e0c1f49d6136c487a",
        "short_name": "BT Total War",
        "name": "BattleTech: Total Warfare",
        "bcp_name": "Battletech Total Warfare",
        "manufacturer": "Catalyst",
        "icon": "🦿",
        "has_tracker": False,
        "popularity_rank": 53
    },
    {
        "slug": "cardfight_vang",
        "bcp_id": "6O28cKLVdN",
        "short_name": "Cardfight! Vang…",
        "name": "Cardfight! Vangaurd",
        "bcp_name": "Cardfight! Vangaurd",
        "manufacturer": "Bushiroad",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 54
    },
    {
        "slug": "marcher_empire",
        "bcp_id": "kJ5tCtljRK85",
        "short_name": "Marcher: Empire…",
        "name": "Marcher: Empires at War",
        "bcp_name": "Marcher: Empires at War",
        "manufacturer": "Golden Dragon Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 55
    },
    {
        "slug": "mordheim",
        "bcp_id": "ygDIbtGbFg",
        "short_name": "Mordheim",
        "name": "Mordheim",
        "bcp_name": "Mordheim",
        "manufacturer": "Games Workshop",
        "icon": "🕯️",
        "has_tracker": False,
        "popularity_rank": 56
    },
    {
        "slug": "saga",
        "bcp_id": "nhnF6MNV04",
        "short_name": "SAGA",
        "name": "SAGA",
        "bcp_name": "Saga",
        "manufacturer": "Studio Tomahawk",
        "icon": "🛡️",
        "has_tracker": False,
        "popularity_rank": 57
    },
    {
        "slug": "team_yankee",
        "bcp_id": "66bc4103d5b0ec49b6a2dbfb",
        "short_name": "Team Yankee",
        "name": "Team Yankee",
        "bcp_name": "Team Yankee",
        "manufacturer": "Battlefront Miniatures",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 58
    },
    {
        "slug": "ticket_to_ride",
        "bcp_id": "661e1d2b6d494f1ed7334910",
        "short_name": "Ticket to Ride",
        "name": "Ticket to Ride",
        "bcp_name": "Ticket to Ride",
        "manufacturer": "Asmodee",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 59
    },
    {
        "slug": "wartide",
        "bcp_id": "6674207e3468bc0bc894ade4",
        "short_name": "Wartide",
        "name": "Wartide",
        "bcp_name": "Wartide",
        "manufacturer": "Wartide",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 60
    },
    {
        "slug": "x_wing",
        "bcp_id": "bx62OfZBGb",
        "short_name": "X-Wing",
        "name": "Star Wars: X-Wing",
        "bcp_name": "X-Wing",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🚀",
        "has_tracker": False,
        "popularity_rank": 61
    },
    {
        "slug": "aeronautica",
        "bcp_id": "xQ7Nrr30tj",
        "short_name": "Aeronautica",
        "name": "Aeronautica Imperialis",
        "bcp_name": "Aeronautica",
        "manufacturer": "Games Workshop",
        "icon": "✈️",
        "has_tracker": False,
        "popularity_rank": 62
    },
    {
        "slug": "age_of_fantasy",
        "bcp_id": "B8m83OPe8OnU",
        "short_name": "Age of Fantasy…",
        "name": "Age of Fantasy Skirmish",
        "bcp_name": "Age of Fantasy Skirmish",
        "manufacturer": "One Page Rules",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 63
    },
    {
        "slug": "aos_champions",
        "bcp_id": "5hX6tOfDHv",
        "short_name": "AoS Champions",
        "name": "Age of Sigmar: Champions",
        "bcp_name": "Age of Sigmar: Champions",
        "manufacturer": "Play Fusion",
        "icon": "🃏",
        "has_tracker": False,
        "popularity_rank": 64
    },
    {
        "slug": "annapurna",
        "bcp_id": "Agoe0Asx9M",
        "short_name": "AnnaPurna",
        "name": "AnnaPurna",
        "bcp_name": "AnnaPurna",
        "manufacturer": "Fiat Lucre",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 65
    },
    {
        "slug": "argent_saga",
        "bcp_id": "X0130kMDD6",
        "short_name": "Argent Saga",
        "name": "Argent Saga",
        "bcp_name": "Argent Saga",
        "manufacturer": "Amikon Entertainment",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 66
    },
    {
        "slug": "batman_tmg",
        "bcp_id": "v857jmhYSv",
        "short_name": "Batman : TMG",
        "name": "Batman : TMG",
        "bcp_name": "Batman : TMG",
        "manufacturer": "Knight Models",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 67
    },
    {
        "slug": "battle_spirits",
        "bcp_id": "Z9MvTncufZ",
        "short_name": "Battle Spirits…",
        "name": "Battle Spirits Saga",
        "bcp_name": "Battle Spirits Saga",
        "manufacturer": "Bandai",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 68
    },
    {
        "slug": "beyblade",
        "bcp_id": "itaOMAgBTWqs",
        "short_name": "Beyblade",
        "name": "Beyblade",
        "bcp_name": "Beyblade",
        "manufacturer": "Beyblade",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 69
    },
    {
        "slug": "bi_ho",
        "bcp_id": "65fb7934cdaa32a59a1d4b89",
        "short_name": "Biñho",
        "name": "Biñho",
        "bcp_name": "Biñho",
        "manufacturer": "Binho Board",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 70
    },
    {
        "slug": "blkout",
        "bcp_id": "ro4xyyTWREhF",
        "short_name": "BLKOUT",
        "name": "BLKOUT",
        "bcp_name": "BLKOUT",
        "manufacturer": "BLKOUT",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 71
    },
    {
        "slug": "blood_and_plun",
        "bcp_id": "66db6045abc0360803e9a3a2",
        "short_name": "Blood and Plund…",
        "name": "Blood and Plunder",
        "bcp_name": "Blood and Plunder",
        "manufacturer": "Firelock Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 72
    },
    {
        "slug": "blood_fields",
        "bcp_id": "MXCAl2xYYG",
        "short_name": "Blood Fields",
        "name": "Blood Fields",
        "bcp_name": "Blood Fields",
        "manufacturer": "Titan Forge",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 73
    },
    {
        "slug": "blood_red_skie",
        "bcp_id": "wtv9VrjMWt",
        "short_name": "Blood Red Skies",
        "name": "Blood Red Skies",
        "bcp_name": "Blood Red Skies",
        "manufacturer": "Warlord Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 74
    },
    {
        "slug": "chrono_core",
        "bcp_id": "66df997f746f34555ccce16f",
        "short_name": "Chrono Core",
        "name": "Chrono Core",
        "bcp_name": "Chrono Core",
        "manufacturer": "Chrono Core Studios",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 75
    },
    {
        "slug": "chrono_core_tc",
        "bcp_id": "67bdb7c1bf62de0597692872",
        "short_name": "Chrono Core TCG",
        "name": "Chrono Core TCG",
        "bcp_name": "Chrono Core TCG",
        "manufacturer": "Chrono Core",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 76
    },
    {
        "slug": "doomtown",
        "bcp_id": "1U5bWEJTWw",
        "short_name": "Doomtown",
        "name": "Doomtown",
        "bcp_name": "Doomtown",
        "manufacturer": "Pine Box Entertainment",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 77
    },
    {
        "slug": "epic",
        "bcp_id": "kHseS0TYLo",
        "short_name": "Epic",
        "name": "Epic",
        "bcp_name": "Epic",
        "manufacturer": "White Wizard Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 78
    },
    {
        "slug": "flex_nba_battl",
        "bcp_id": "4ugzUcccmW",
        "short_name": "Flex NBA Battle…",
        "name": "Flex NBA Battle Series",
        "bcp_name": "Flex NBA Battle Series",
        "manufacturer": "Sequoia Games Inc.",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 79
    },
    {
        "slug": "future_card_bu",
        "bcp_id": "7jbbuBKD24",
        "short_name": "Future Card Bud…",
        "name": "Future Card Buddyfight",
        "bcp_name": "Future Card Buddyfight",
        "manufacturer": "Bushiroad",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 80
    },
    {
        "slug": "game_of_throne",
        "bcp_id": "EdhBk0q4c4",
        "short_name": "Game of Thrones…",
        "name": "Game of Thrones the Card Game",
        "bcp_name": "Game of Thrones the Card Game",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 81
    },
    {
        "slug": "genesis_battle",
        "bcp_id": "662a8fbc7d069d1a9e33efe9",
        "short_name": "Genesis: Battle…",
        "name": "Genesis: Battle of Champtions",
        "bcp_name": "Genesis: Battle of Champtions",
        "manufacturer": "Edge of Exile Entertainment Inc.",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 82
    },
    {
        "slug": "godsforge",
        "bcp_id": "0BmDs4dUIi",
        "short_name": "Godsforge",
        "name": "Godsforge",
        "bcp_name": "Godsforge",
        "manufacturer": "Atlas Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 83
    },
    {
        "slug": "grand_archive",
        "bcp_id": "K3me9vfATM",
        "short_name": "Grand Archive",
        "name": "Grand Archive",
        "bcp_name": "Grand Archive",
        "manufacturer": "Weebs of the Shore",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 84
    },
    {
        "slug": "hero_realms",
        "bcp_id": "s6TAZbwxML",
        "short_name": "Hero Realms",
        "name": "Hero Realms",
        "bcp_name": "Hero Realms",
        "manufacturer": "White Wizard Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 85
    },
    {
        "slug": "heroclix",
        "bcp_id": "mIXqdaGANs",
        "short_name": "HeroClix",
        "name": "HeroClix",
        "bcp_name": "HeroClix",
        "manufacturer": "Wizkids",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 86
    },
    {
        "slug": "imperial_assau",
        "bcp_id": "5CgWAgFADE",
        "short_name": "Imperial Assault",
        "name": "Imperial Assault",
        "bcp_name": "Imperial Assault",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 87
    },
    {
        "slug": "keyforge",
        "bcp_id": "Z5J97FvlKe",
        "short_name": "Keyforge",
        "name": "Keyforge",
        "bcp_name": "Keyforge",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 88
    },
    {
        "slug": "king_of_tokyo",
        "bcp_id": "9kl7L9nldU",
        "short_name": "King of Tokyo",
        "name": "King of Tokyo",
        "bcp_name": "King of Tokyo",
        "manufacturer": "iello",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 89
    },
    {
        "slug": "kings_of_war",
        "bcp_id": "FQ4DfKKpEU",
        "short_name": "Kings of War",
        "name": "Kings of War",
        "bcp_name": "Kings of War",
        "manufacturer": "Mantic Games",
        "icon": "🏰",
        "has_tracker": False,
        "popularity_rank": 90
    },
    {
        "slug": "konflikt_47",
        "bcp_id": "tQjLdaXhcJ",
        "short_name": "Konflikt 47",
        "name": "Konflikt '47",
        "bcp_name": "Konflict '47",
        "manufacturer": "Warlord Games",
        "icon": "☢️",
        "has_tracker": False,
        "popularity_rank": 91
    },
    {
        "slug": "legend_of_the_",
        "bcp_id": "p8aUEX6mDs",
        "short_name": "Legend of the F…",
        "name": "Legend of the Five Rings",
        "bcp_name": "Legend of the Five Rings",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 92
    },
    {
        "slug": "metazoo",
        "bcp_id": "9NxxBJf4Na",
        "short_name": "Metazoo",
        "name": "Metazoo",
        "bcp_name": "Metazoo",
        "manufacturer": "Metazoo Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 93
    },
    {
        "slug": "monsterpocalyp",
        "bcp_id": "7uUGktcIRq",
        "short_name": "Monsterpocalypse",
        "name": "Monsterpocalypse",
        "bcp_name": "Monsterpocalypse",
        "manufacturer": "Privateer Press",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 94
    },
    {
        "slug": "naruto",
        "bcp_id": "PDAuoa5cgK",
        "short_name": "Naruto",
        "name": "Naruto",
        "bcp_name": "Naruto",
        "manufacturer": "Bandai",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 95
    },
    {
        "slug": "onslaught",
        "bcp_id": "8hN1ihJ8DN",
        "short_name": "ONSLAUGHT",
        "name": "ONSLAUGHT",
        "bcp_name": "ONSLAUGHT",
        "manufacturer": "Whiz Kids",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 96
    },
    {
        "slug": "outward_realms",
        "bcp_id": "605bcf998226840d4bc00ffe",
        "short_name": "Outward Realms",
        "name": "Outward Realms",
        "bcp_name": "Outward Realms",
        "manufacturer": "Outward Realms",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 97
    },
    {
        "slug": "rivals",
        "bcp_id": "v6qfejJRUx",
        "short_name": "Rivals",
        "name": "Rivals",
        "bcp_name": "Rivals",
        "manufacturer": "CATAN",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 98
    },
    {
        "slug": "roba",
        "bcp_id": "NAK4OpT3kT",
        "short_name": "ROBA",
        "name": "ROBA",
        "bcp_name": "ROBA",
        "manufacturer": "Heel Turn Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 99
    },
    {
        "slug": "smash_bros",
        "bcp_id": "WZbaMtGhEr",
        "short_name": "Smash Bros",
        "name": "Smash Bros",
        "bcp_name": "Smash Bros",
        "manufacturer": "Nintendo",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 100
    },
    {
        "slug": "star_realms",
        "bcp_id": "SOuCmjcwce",
        "short_name": "Star Realms",
        "name": "Star Realms",
        "bcp_name": "Star Realms",
        "manufacturer": "White Wizard Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 101
    },
    {
        "slug": "sw_armada",
        "bcp_id": "gRTgm28uhQ",
        "short_name": "SW Armada",
        "name": "Star Wars: Armada",
        "bcp_name": "Star Wars Armada",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🚀",
        "has_tracker": False,
        "popularity_rank": 102
    },
    {
        "slug": "star_wars_dest",
        "bcp_id": "NPyZIKwtCl",
        "short_name": "Star Wars Desti…",
        "name": "Star Wars Destiny",
        "bcp_name": "Star Wars Destiny",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 103
    },
    {
        "slug": "star_wars_unli",
        "bcp_id": "maCXHs5gaX",
        "short_name": "Star Wars Unlim…",
        "name": "Star Wars Unlimited - Casual",
        "bcp_name": "Star Wars Unlimited - Casual",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 104
    },
    {
        "slug": "star_wars_unli_2",
        "bcp_id": "kwl9ZSdevH",
        "short_name": "Star Wars Unlim…",
        "name": "Star Wars Unlimited : Twin Suns",
        "bcp_name": "Star Wars Unlimited : Twin Suns",
        "manufacturer": "Fantasy Flight Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 105
    },
    {
        "slug": "starcraft_tabl",
        "bcp_id": "HqgiM2fMCAoN",
        "short_name": "StarCraft Table…",
        "name": "StarCraft Tabletop Miniatures Game",
        "bcp_name": "StarCraft Tabletop Miniatures Game",
        "manufacturer": "Archon Studio",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 106
    },
    {
        "slug": "steel_rift",
        "bcp_id": "Ur7ZvRF1wPWq",
        "short_name": "Steel Rift",
        "name": "Steel Rift",
        "bcp_name": "Steel Rift",
        "manufacturer": "Death Ray Designs",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 107
    },
    {
        "slug": "ninth_age",
        "bcp_id": "jnffUQYAK8",
        "short_name": "The 9th Age",
        "name": "The 9th Age",
        "bcp_name": "The 9th Age",
        "manufacturer": "The IX Age",
        "icon": "🛡️",
        "has_tracker": False,
        "popularity_rank": 108
    },
    {
        "slug": "transformers",
        "bcp_id": "u2P27ZSURD",
        "short_name": "Transformers",
        "name": "Transformers",
        "bcp_name": "Transformers",
        "manufacturer": "Hasbro",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 109
    },
    {
        "slug": "universal_figh",
        "bcp_id": "JV0A6xP5qy",
        "short_name": "Universal  Figh…",
        "name": "Universal  Fighting  System",
        "bcp_name": "Universal  Fighting  System",
        "manufacturer": "Jasco Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 110
    },
    {
        "slug": "universus_my_h",
        "bcp_id": "QzusTyUknx",
        "short_name": "Universus: My H…",
        "name": "Universus: My Hero Academia",
        "bcp_name": "Universus: My Hero Academia",
        "manufacturer": "Jasco Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 111
    },
    {
        "slug": "vanguard_zero",
        "bcp_id": "VFHr8IArQ0",
        "short_name": "Vanguard Zero",
        "name": "Vanguard Zero",
        "bcp_name": "Vanguard Zero",
        "manufacturer": "Bushiroad",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 112
    },
    {
        "slug": "vibes",
        "bcp_id": "67b79ae8bf62de0597692833",
        "short_name": "Vibes",
        "name": "Vibes",
        "bcp_name": "Vibes",
        "manufacturer": "Orange Cap Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 113
    },
    {
        "slug": "vs_system_2pcg",
        "bcp_id": "QQrdiF5Kz6",
        "short_name": "VS System 2PCG",
        "name": "VS System 2PCG",
        "bcp_name": "VS System 2PCG",
        "manufacturer": "Upper Deck",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 114
    },
    {
        "slug": "warcaster_neo_",
        "bcp_id": "vHcENvcLKL",
        "short_name": "Warcaster: Neo-…",
        "name": "Warcaster: Neo-Mechanika",
        "bcp_name": "Warcaster: Neo-Mechanika",
        "manufacturer": "Privateer Press",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 115
    },
    {
        "slug": "warlord_saga_o",
        "bcp_id": "lBoE1G9nbwVO",
        "short_name": "Warlord: Saga o…",
        "name": "Warlord: Saga of the Storm",
        "bcp_name": "Warlord: Saga of the Storm",
        "manufacturer": "KingsWood Games",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 116
    },
    {
        "slug": "warmaster",
        "bcp_id": "XBegtc4oDI",
        "short_name": "Warmaster",
        "name": "Warmaster Revolution",
        "bcp_name": "Warmaster Revolution",
        "manufacturer": "Games Workshop",
        "icon": "👑",
        "has_tracker": False,
        "popularity_rank": 117
    },
    {
        "slug": "weiss_schwarz",
        "bcp_id": "dMEhR6bh0o",
        "short_name": "Weiss Schwarz",
        "name": "Weiss Schwarz",
        "bcp_name": "Weiss Schwarz",
        "manufacturer": "Bushiroad",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 118
    },
    {
        "slug": "wixoss",
        "bcp_id": "3fzaceXdNL",
        "short_name": "Wixoss",
        "name": "Wixoss",
        "bcp_name": "Wixoss",
        "manufacturer": "Takara Tomy",
        "icon": "🎲",
        "has_tracker": False,
        "popularity_rank": 119
    },
    {
        "slug": "zenozard",
        "bcp_id": "LMFB6r3HEU",
        "short_name": "Zenozard",
        "name": "Zenozard",
        "bcp_name": "Zenozard",
        "manufacturer": "Bandai",
        "icon": "🎴",
        "has_tracker": False,
        "popularity_rank": 120
    }
]

# Legacy & Shorthand Game System IDs on BCP
GAME_SYSTEMS: Dict[str, str] = {
    "warhammer_40k": "WGMSzfKFYA",  # Warhammer 40,000
    "warhammer_aos": "OY8FCPBf6O",  # Warhammer Age of Sigmar (BCP canonical ID)
    "warhammer_tow": "pd0PejEmWE",  # Warhammer The Old World
    "warhammer_underworlds": "Z8rcM0GCLw",
}
for _sys_entry in BCP_GAME_SYSTEMS_CATALOG:
    GAME_SYSTEMS[_sys_entry["slug"]] = _sys_entry["bcp_id"]

DEFAULT_GAME_SYSTEM_ID = "WGMSzfKFYA"
AOS_GAME_SYSTEM_ID = "OY8FCPBf6O"
AOS_LEGACY_GAME_SYSTEM_IDS = ["23qDprPABN", "OY8FCPBf6O"]
DEFAULT_GAME_SYSTEM = "40k"
SUPPORTED_GAME_SYSTEMS = [s["slug"] for s in BCP_GAME_SYSTEMS_CATALOG]
ENABLE_AOS = True

# Fast O(1) Lookup Indexes
GAME_SYSTEM_BY_SLUG: Dict[str, Dict[str, Any]] = {s["slug"]: s for s in BCP_GAME_SYSTEMS_CATALOG}
GAME_SYSTEM_BY_BCP_ID: Dict[str, Dict[str, Any]] = {s["bcp_id"]: s for s in BCP_GAME_SYSTEMS_CATALOG}
GAME_SYSTEM_BY_BCP_ID["23qDprPABN"] = GAME_SYSTEM_BY_SLUG["aos"]
GAME_SYSTEM_BY_BCP_ID["1"] = GAME_SYSTEM_BY_SLUG["40k"]
GAME_SYSTEM_BY_BCP_ID["4"] = GAME_SYSTEM_BY_SLUG["aos"]

GAME_SYSTEM_ALIASES: Dict[str, str] = {
    "40k": "40k",
    "wh40k": "40k",
    "warhammer_40k": "40k",
    "warhammer 40k": "40k",
    "warhammer 40,000": "40k",
    "warhammer 40000": "40k",
    "wgmszfkfya": "40k",
    "1": "40k",
    "aos": "aos",
    "whaos": "aos",
    "warhammer_aos": "aos",
    "sigmar": "aos",
    "age of sigmar": "aos",
    "warhammer age of sigmar": "aos",
    "warhammer: age of sigmar": "aos",
    "oy8fcpbf6o": "aos",
    "23qdprpabn": "aos",
    "4": "aos",
    "warhammer_tow": "the_old_world",
    "tow": "the_old_world",
    "old_world": "the_old_world",
    "old world": "the_old_world",
    "warhammer: the old world": "the_old_world",
    "warhammer the old world": "the_old_world",
    "warhammer_underworlds": "underworlds",
    "kt": "kill_team",
    "killteam": "kill_team",
    "hh": "horus_heresy",
    "30k": "horus_heresy",
    "the horus heresy": "horus_heresy",
    "warhammer: the horus heresy": "horus_heresy",
    "mesbg": "middle_earth",
    "lotr": "middle_earth",
    "middle-earth": "middle_earth",
    "middle earth": "middle_earth",
    "bloodbowl": "blood_bowl",
    "marvel crisis protocol": "mcp",
    "marvel_crisis": "mcp",
    "star wars: legion": "sw_legion",
    "star_wars_legion": "sw_legion",
    "starwars_legion": "sw_legion",
    "swl": "sw_legion",
    "star wars: shatterpoint": "shatterpoint",
    "star_wars_shatterpoint": "shatterpoint",
    "starwars_shatterpoint": "shatterpoint",
    "star wars: armada": "sw_armada",
    "star_wars_armada": "sw_armada",
    "star wars: x-wing": "x_wing",
    "star_wars_x_wing": "x_wing",
    "star wars: unlimited": "sw_unlimited",
    "star_wars_unlimited": "sw_unlimited",
    "starwars_unlimited": "sw_unlimited",
    "swu": "sw_unlimited",
    "magic: the gathering": "mtg",
    "magic_the_gathering": "mtg",
    "pokemon": "pokemon",
    "pokémon": "pokemon",
    "pokemon_tcg": "pokemon",
    "pokémon tcg": "pokemon",
    "ptcg": "pokemon",
    "one_piece_tcg": "one_piece",
    "one piece tcg": "one_piece",
    "onepiece": "one_piece",
    "optcg": "one_piece",
    "fab": "flesh_blood",
    "flesh_and_blood": "flesh_blood",
    "flesh and blood": "flesh_blood",
    "disney_lorcana": "lorcana",
    "disney lorcana": "lorcana",
    "yu_gi_oh": "yugioh",
    "yu-gi-oh": "yugioh",
    "ygo": "yugioh",
    "digimon_tcg": "digimon",
    "digimon card game": "digimon",
    "riftbound": "riftbound",
    "riftbound_tcg": "riftbound",
    "riftbound tcg": "riftbound",
    "league of legends tcg": "riftbound",
    "guild_ball": "guild_ball",
    "guildball": "guild_ball",
    "guild ball": "guild_ball",
}
for _s in BCP_GAME_SYSTEMS_CATALOG:
    _slug = _s["slug"]
    _s.setdefault("label", _s["name"])
    _s.setdefault("short_label", _s["short_name"])
    GAME_SYSTEM_ALIASES[_slug.lower()] = _slug
    GAME_SYSTEM_ALIASES[_s["bcp_id"].lower()] = _slug
    GAME_SYSTEM_ALIASES[_s["name"].lower()] = _slug
    GAME_SYSTEM_ALIASES[_s["bcp_name"].lower()] = _slug
    GAME_SYSTEM_ALIASES[_s["short_name"].lower()] = _slug


def normalize_game_system(val: Optional[str], default: str = "40k") -> str:
    """Normalizes any game_system slug, BCP gameSystemId, or name into a canonical <=16-char slug."""
    if not val:
        return default
    raw = str(val).strip()
    if not raw:
        return default
    low = raw.lower()
    if low == "all":
        return "all"
    if low in GAME_SYSTEM_ALIASES:
        return GAME_SYSTEM_ALIASES[low]
    if raw in GAME_SYSTEM_BY_BCP_ID:
        return GAME_SYSTEM_BY_BCP_ID[raw]["slug"]
    # Clean alphanumeric slug fallback bounded to 16 chars for VARCHAR(16) compatibility
    cleaned = re.sub(r"[^a-z0-9]+", "_", low).strip("_")
    if cleaned in GAME_SYSTEM_ALIASES:
        return GAME_SYSTEM_ALIASES[cleaned]
    if cleaned in GAME_SYSTEM_BY_SLUG:
        return cleaned
    return cleaned[:16] if cleaned else default


def resolve_event_game_system(
    event_data: Optional[Dict[str, Any]] = None,
    game_system_id: Optional[str] = None,
    game_system_name: Optional[str] = None,
    default: str = "40k",
    default_system: Optional[str] = None,
    requested_system: Optional[str] = None,
) -> str:
    """Resolves canonical game_system slug from a BCP event payload, gameSystemId, or gameSystemName."""
    if requested_system:
        default = requested_system
    elif default_system:
        default = default_system
    if isinstance(event_data, dict):
        explicit_gs = str(event_data.get("game_system") or "").strip()
        gs_id = str(
            game_system_id
            or event_data.get("gameSystemId")
            or event_data.get("game_system_id")
            or event_data.get("gameType")
            or (event_data.get("gameSystem") or {}).get("id")
            or ""
        ).strip()
        gs_name = str(
            game_system_name
            or event_data.get("gameSystemName")
            or (event_data.get("gameSystem") or {}).get("name")
            or ""
        ).strip()
        # If gameSystemId is present and maps to a known non-40k system, prefer it over a default "40k" tag
        if gs_id and gs_id.lower() in GAME_SYSTEM_ALIASES:
            resolved_from_id = GAME_SYSTEM_ALIASES[gs_id.lower()]
            if not explicit_gs or (explicit_gs.lower() == "40k" and resolved_from_id != "40k"):
                return resolved_from_id
        if explicit_gs:
            return normalize_game_system(explicit_gs, default=default)
        if gs_name and gs_name.lower() in GAME_SYSTEM_ALIASES:
            return GAME_SYSTEM_ALIASES[gs_name.lower()]
    else:
        if game_system_id and str(game_system_id).strip().lower() in GAME_SYSTEM_ALIASES:
            return GAME_SYSTEM_ALIASES[str(game_system_id).strip().lower()]
        if game_system_name and str(game_system_name).strip().lower() in GAME_SYSTEM_ALIASES:
            return GAME_SYSTEM_ALIASES[str(game_system_name).strip().lower()]
    return default


def get_bcp_game_system_id(slug_or_id: Optional[str], default: Optional[str] = DEFAULT_GAME_SYSTEM_ID) -> Optional[str]:
    """Returns the official BCP gameSystemId for a canonical game_system slug or existing BCP ID."""
    if not slug_or_id:
        return default
    raw = str(slug_or_id).strip()
    if raw in GAME_SYSTEM_BY_BCP_ID:
        if raw == "23qDprPABN":
            return AOS_GAME_SYSTEM_ID
        return GAME_SYSTEM_BY_BCP_ID[raw]["bcp_id"]
    norm = normalize_game_system(raw, default="")
    if norm in GAME_SYSTEM_BY_SLUG:
        return GAME_SYSTEM_BY_SLUG[norm]["bcp_id"]
    return raw if (len(raw) >= 8 and raw.isalnum() and (any(c.isupper() for c in raw) or len(raw) == 24)) else default


NON_BCP_EVENT_PREFIXES = (
    "es-",
    "melee:",
    "ltcg:",
    "ls:",
    "td:",
    "nr:",
    "league_",
)


def is_bcp_event_id(event_id: Optional[str]) -> bool:
    """Returns True only if event_id is a Best Coast Pairings event ID (not ES-*, melee:*, ltcg:*, ls:*, td:*, league_*)."""
    if not event_id:
        return False
    eid = str(event_id).strip()
    if not eid:
        return False
    low = eid.lower()
    if low.startswith(NON_BCP_EVENT_PREFIXES) or ":" in eid:
        return False
    return True


def is_bcp_player_id(player_id: Optional[str]) -> bool:
    """Returns True only if player_id is a Best Coast Pairings user/player ID."""
    if not player_id:
        return False
    pid = str(player_id).strip()
    if not pid:
        return False
    low = pid.lower()
    if low.startswith(("user_", "es_", "p_", "bcp_", "melee:", "ltcg:", "ls:", "td:", "nr:")) or ":" in pid:
        return False
    return True


def get_event_platform(event_id: Optional[str], event_data: Optional[Dict[str, Any]] = None) -> str:
    """Resolves the source platform slug ('bcp', 'melee', 'limitless', 'longshanks', 'topdeck', 'eventstudio', 'league')."""
    if isinstance(event_data, dict):
        sp = str(event_data.get("source_platform") or "").strip().lower()
        if sp:
            return sp
    eid = str(event_id or "").strip().lower()
    if eid.startswith("melee:"):
        return "melee"
    if eid.startswith("ltcg:"):
        return "limitless"
    if eid.startswith("ls:"):
        return "longshanks"
    if eid.startswith("td:"):
        return "topdeck"
    if eid.startswith("es-"):
        return "eventstudio"
    if eid.startswith("league_"):
        return "league"
    return "bcp"


def get_platform_event_url(event_id: Optional[str], event_data: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Returns the canonical external URL for an event on its originating platform (or None for native events)."""
    if isinstance(event_data, dict):
        ext_url = event_data.get("external_url") or event_data.get("platform_url")
        if ext_url and str(ext_url).strip().startswith("http"):
            return str(ext_url).strip()
    if not event_id:
        return None
    eid = str(event_id).strip()
    if not eid:
        return None
    low = eid.lower()
    if low.startswith(("es-", "league_")):
        return None
    if low.startswith("melee:"):
        return f"https://melee.gg/Tournament/View/{eid.split(':', 1)[1]}"
    if low.startswith("ltcg:"):
        return f"https://play.limitlesstcg.com/tournament/{eid.split(':', 1)[1]}/standings"
    if low.startswith("ls:"):
        return f"https://www.longshanks.org/event/{eid.split(':', 1)[1]}/"
    if low.startswith("td:"):
        return f"https://topdeck.gg/event/{eid.split(':', 1)[1]}"
    return f"https://www.bestcoastpairings.com/event/{eid}"


def get_game_system_meta(slug_or_id: Optional[str]) -> Dict[str, Any]:
    """Returns full display metadata (slug, name, short_name, icon, bcp_id, has_tracker) for a game system."""
    norm = normalize_game_system(slug_or_id, default="40k")
    if norm in GAME_SYSTEM_BY_SLUG:
        return GAME_SYSTEM_BY_SLUG[norm]
    return GAME_SYSTEM_BY_SLUG["40k"]


def has_game_tracker(slug_or_id: Optional[str]) -> bool:
    """Returns True only for game systems that have a dedicated OmniTactica live Game Tracker (40k and aos)."""
    norm = normalize_game_system(slug_or_id, default="40k")
    return norm in ("40k", "aos")


# Elo Engine Default Parameters
INITIAL_ELO = 1500.0
DEFAULT_K_FACTOR = 32.0
PROVISIONAL_MATCH_COUNT = 10
MIN_MATCHES_FOR_RANKING = 3
PROVISIONAL_K_FACTOR = 48.0

# Google Maps API Configuration
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")

# ---------------------------------------------------------------------------
# Multi-System Canonical Faction Catalog & Placeholder Resolution
# ---------------------------------------------------------------------------
import hashlib

PLACEHOLDER_FACTION_NAMES = {
    "",
    "unknown",
    "none",
    "null",
    "n/a",
    "na",
    "tbd",
    "tba",
    "unassigned",
    "unaffiliated",
    "other",
    "default",
    "standard deck",
    "commander deck",
    "unknown commander",
    "premier deck",
    "constructed deck",
    "custom deck",
    "deck",
    "army",
    "faction",
    "glc",
    "gym leader challenge",
    "standard",
    "expanded",
    "unlimited",
    "bye",
    "drop",
    "dropped",
    "player",
}

FACTION_ALIAS_CANONICAL_MAP: Dict[str, str] = {
    "space marines (astartes)": "Space Marines",
    "adeptus astartes": "Space Marines",
    "genestealer cult": "Genestealer Cults",
    "astra militarum (imperial guard)": "Astra Militarum",
    "imperial guard": "Astra Militarum",
    "craftworlds": "Aeldari",
    "asuryani": "Aeldari",
    "aeldari - craftworlds": "Aeldari",
    "chaos space marines (heretic astartes)": "Chaos Space Marines",
    "heretic astartes": "Chaos Space Marines",
    "tau empire": "T'au Empire",
    "t'au": "T'au Empire",
    "adeptus custodes": "Adeptus Custodes",
    "adepta sororitas (sisters of battle)": "Adepta Sororitas",
    "sisters of battle": "Adepta Sororitas",
    "lumineth realm-lords": "Lumineth Realm-lords",
    "skaventide": "Skaven",
    "hosts of slaanesh": "Hedonites of Slaanesh",
    "maggotkin of nurgle": "Maggotkin of Nurgle",
    "blades of khorne": "Blades of Khorne",
    "disciples of tzeentch": "Disciples of Tzeentch",
    "slaves to darkness": "Slaves to Darkness",
}

GAME_SYSTEM_DEFAULT_FACTIONS: Dict[str, List[str]] = {
    "40k": [
        "Space Marines",
        "Aeldari",
        "Necrons",
        "Orks",
        "Chaos Space Marines",
        "Astra Militarum",
        "Tyranids",
        "T'au Empire",
        "Adeptus Custodes",
        "Blood Angels",
        "Dark Angels",
        "Death Guard",
        "World Eaters",
        "Thousand Sons",
        "Grey Knights",
        "Adepta Sororitas",
        "Drukhari",
        "Genestealer Cults",
        "Leagues of Votann",
        "Imperial Knights",
        "Chaos Knights",
        "Chaos Daemons",
        "Adeptus Mechanicus",
        "Space Wolves",
        "Black Templars",
        "Imperial Agents",
        "Emperor's Children",
    ],
    "aos": [
        "Stormcast Eternals",
        "Slaves to Darkness",
        "Skaven",
        "Sylvaneth",
        "Seraphon",
        "Lumineth Realm-lords",
        "Soulblight Gravelords",
        "Nighthaunt",
        "Ossiarch Bonereapers",
        "Flesh-eater Courts",
        "Maggotkin of Nurgle",
        "Blades of Khorne",
        "Disciples of Tzeentch",
        "Hedonites of Slaanesh",
        "Daughters of Khaine",
        "Cities of Sigmar",
        "Kharadron Overlords",
        "Fyreslayers",
        "Idoneth Deepkin",
        "Gloomspite Gitz",
        "Orruk Warclans",
        "Ogor Mawtribes",
        "Sons of Behemat",
    ],
    "kill_team": [
        "Kasrkin",
        "Kommandos",
        "Angels of Death",
        "Legionaries",
        "Pathfinders",
        "Phobos Strike Team",
        "Corsair Voidscarred",
        "Hierotek Circle",
        "Nemesis Claw",
        "Vet Guard",
        "Warpcoven",
        "Blades of Khaine",
    ],
    "the_old_world": [
        "Kingdom of Bretonnia",
        "Tomb Kings of Khemri",
        "Empire of Man",
        "Orc & Goblin Tribes",
        "Warriors of Chaos",
        "Dwarfen Mountain Holds",
        "High Elf Realms",
        "Wood Elf Realms",
        "Beastmen Brayherds",
        "Vampire Counts",
    ],
    "horus_heresy": [
        "Sons of Horus",
        "Imperial Fists",
        "Blood Angels",
        "Dark Angels",
        "Ultramarines",
        "Iron Warriors",
        "Alpha Legion",
        "World Eaters",
        "Night Lords",
        "Death Guard",
        "Mechanicum",
        "Legio Custodes",
    ],
    "spearhead": [
        "Stormcast Eternals",
        "Skaven",
        "Slaves to Darkness",
        "Sylvaneth",
        "Soulblight Gravelords",
        "Seraphon",
        "Blades of Khorne",
        "Gloomspite Gitz",
    ],
    "blood_bowl": [
        "Undead",
        "Dark Elf",
        "Skaven",
        "Dwarf",
        "Lizardmen",
        "Orc",
        "Wood Elf",
        "Amazon",
        "Norse",
        "Chaos Chosen",
    ],
    "middle_earth": [
        "Minas Tirith",
        "Mordor",
        "Rohan",
        "Isengard",
        "Lothlorien",
        "Iron Hills",
        "Angmar",
        "Harad",
        "Rivendell",
        "Moria",
    ],
    "underworlds": [
        "Domitan's Stormcoven",
        "Ephilim's Pandaemonium",
        "Grymwatch",
        "Crimson Court",
        "Kainan's Reapers",
        "Headsmen's Curse",
    ],
    "warcry": [
        "Jade Obelisk",
        "Rotmire Creed",
        "Horns of Hashut",
        "Iron Golems",
        "Untamed Beasts",
        "Corvus Cabal",
        "Splintered Fang",
        "Vulkyn Flameseekers",
    ],
    "necromunda": [
        "House Goliath",
        "House Escher",
        "House Van Saar",
        "House Orlock",
        "House Delaque",
        "House Cawdor",
        "Palanite Enforcers",
        "Ash Waste Nomads",
    ],
    "legions_imp": [
        "Legiones Astartes",
        "Solar Auxilia",
        "Mechanicum Taghmata",
        "Collegia Titanica",
        "Questoris Familia",
        "Dark Mechanicum",
    ],
    "bolt_action": [
        "Germany",
        "United States",
        "Great Britain",
        "Soviet Union",
        "Imperial Japan",
        "Italy",
        "France",
        "Finland",
    ],
    "mcp": [
        "Avengers",
        "X-Men",
        "Cabal",
        "Brotherhood of Mutants",
        "Guardians of the Galaxy",
        "Spider-Foes",
        "Midnight Sons",
        "Asgard",
        "Web Warriors",
        "Criminal Syndicate",
        "Inhumans",
        "Wakanda",
    ],
    "sw_legion": [
        "Galactic Empire",
        "Rebel Alliance",
        "Galactic Republic",
        "Separatist Alliance",
        "Shadow Collective",
    ],
    "shatterpoint": [
        "Galactic Republic",
        "Separatist Alliance",
        "Rebel Alliance",
        "Galactic Empire",
        "Mandalorians",
        "Shadow Collective",
    ],
    "trench_crusade": [
        "Principality of New Antioch",
        "Heretic Legion",
        "Trench Pilgrims",
        "Iron Sultanate",
        "Court of the Seven-Headed Serpent",
        "The Black Grail",
    ],
    "battletech_as": [
        "Clan Wolf",
        "House Davion",
        "Clan Jade Falcon",
        "House Steiner",
        "House Kurita",
        "Mercenaries",
        "Clan Ghost Bear",
        "ComStar",
    ],
    "battletech": [
        "Clan Wolf",
        "House Davion (Federated Suns)",
        "Clan Jade Falcon",
        "House Kurita (Draconis Combine)",
        "House Steiner (Lyran Commonwealth)",
        "Mercenary Command",
        "Clan Ghost Bear",
        "House Liao (Capellan Confederation)",
    ],
    "battletech_tw": [
        "Clan Wolf",
        "House Davion",
        "Clan Jade Falcon",
        "House Kurita",
        "House Steiner",
        "Mercenaries",
    ],
    "conquest": [
        "Hundred Kingdoms",
        "Nords",
        "Spires",
        "Dweghom",
        "W'adrhun",
        "Old Dominion",
        "City States",
        "Sorcerer Kings",
    ],
    "warmachine": [
        "Cygnar",
        "Khador",
        "Orgoth",
        "Dusk",
        "Brineblood Marauders",
        "Khymaera Shadowflame Shard",
        "Cryx",
        "Southern Kriels",
    ],
    "infinity": [
        "PanOceania",
        "Nomads",
        "Yu Jing",
        "Combined Army",
        "Ariadna",
        "Haqqislam",
        "ALEPH",
        "O-12",
        "JSA",
    ],
    "malifaux": [
        "The Guild",
        "Resurrectionists",
        "Arcanists",
        "Neverborn",
        "Outcasts",
        "Bayou",
        "Ten Thunders",
        "Explorer's Society",
    ],
    "asoiaf": [
        "House Stark",
        "House Lannister",
        "House Baratheon",
        "Targaryen",
        "Night's Watch",
        "Free Folk",
        "House Greyjoy",
        "House Martell",
    ],
    "flames_of_war": [
        "German Wehrmacht",
        "US Army",
        "British Eighth Army",
        "Soviet Red Army",
        "German Waffen-SS",
        "Italian Royal Army",
    ],
    "grimdark_opr": [
        "Battle Brothers",
        "Robot Legions",
        "Alien Hives",
        "DAO Union",
        "High Elf Fleets",
        "Orc Marauders",
        "Human Defense Force",
        "Havoc Brothers",
    ],
    "aof_opr": [
        "Eternal Wardens",
        "Ratmen",
        "Havoc Warriors",
        "Saurians",
        "Vampiric Undead",
        "Chivalrous Kingdoms",
    ],
    "age_of_fantasy": [
        "Eternal Wardens",
        "Ratmen",
        "Havoc Warriors",
        "Saurians",
        "Wood Elves",
        "Dwarves",
    ],
    "halo_flashpt": [
        "UNSC Spartans",
        "Banished Brutes",
        "Sangheili Mercenaries",
        "ONI Recon Fireteam",
        "ODST Strike Team",
    ],
    "one_piece": [
        "Black Rob Lucci (OP07-079)",
        "Black Marshal.D.Teach (OP09-081)",
        "Purple Monkey.D.Luffy (OP05-060)",
        "Blue Donquixote Doflamingo (OP01-060)",
        "Red Shanks (OP09-001)",
        "Yellow Enel (OP05-098)",
        "Green Bonney (OP07-019)",
        "Red/Purple Law (ST10-001)",
    ],
    "yugioh": [
        "Snake-Eye Fiendsmith",
        "Tenpai Dragon",
        "Yubel Fiendsmith",
        "Ryzeal",
        "Maliss",
        "Voiceless Voice",
        "Branded Despia",
        "Labrynth",
    ],
    "mtg": [
        "Kraum, Ludevic's Opus / Tymna the Weaver",
        "Rograkh, Son of Rohgahh / Silas Renn, Seeker Adept",
        "Kinnan, Bonder Prodigy",
        "Sisay, Weatherlight Captain",
        "Dimir Midrange",
        "Gruul Prowess",
        "Golgari Midrange",
        "Azorius Oculus",
    ],
    "commander": [
        "Kraum, Ludevic's Opus / Tymna the Weaver",
        "Rograkh, Son of Rohgahh / Silas Renn, Seeker Adept",
        "Kinnan, Bonder Prodigy",
        "Sisay, Weatherlight Captain",
        "Tivit, Seller of Secrets",
        "Atraxa, Grand Unifier",
        "Najeela, the Blade-Blossom",
        "Yuriko, the Tiger's Shadow",
    ],
    "pokemon": [
        "Regidrago VSTAR",
        "Dragapult ex",
        "Charizard ex / Pidgeot ex",
        "Raging Bolt ex / Ogerpon ex",
        "Lugia VSTAR / Archeops",
        "Gardevoir ex",
        "Gholdengo ex",
        "Terapagos ex / Dusknoir",
    ],
    "lorcana": [
        "Ruby / Sapphire Items",
        "Amber / Steel Steelsong",
        "Amethyst / Ruby Bounce Control",
        "Emerald / Steel Discard",
        "Sapphire / Steel Ramp",
        "Amethyst / Emerald Tempo",
        "Amber / Ruby Mufasa",
        "Amethyst / Steel Aggro",
    ],
    "digimon": [
        "Imperialdramon (Blue/Green)",
        "MirageGaogamon",
        "Takemikazuchi (Fenriloogamon)",
        "AncientGarurumon (Blue Hybrid)",
        "MagnaX (Armor Vaccine)",
        "Seven Great Demon Lords",
        "Purple Hybrid",
        "Gallantmon X",
    ],
    "gundam_tcg": [
        "Blue/White Earth Federation",
        "Green Principle of Zeon",
        "White/Red Witch from Mercury",
        "Blue/Green Wing Zero Ramp",
        "Red Neo Zeon Aggro",
        "White Gundam SEED Control",
    ],
    "flesh_blood": [
        "Zen, Tamer of Purpose",
        "Nuu, Alluring Desire",
        "Enigma, Ledger of Ancestry",
        "Aurora, Shooting Star",
        "Florian, Rotwood Harbinger",
        "Victor Goldmane, High and Mighty",
        "Kayo, Armed and Dangerous",
        "Azalea, Ace in the Hole",
    ],
    "sw_unlimited": [
        "Sabine Wren, Galvanized Revolutionary (ECL)",
        "Boba Fett, Collecting the Bounty (Yellow)",
        "Han Solo, Audacious Smuggler (Green)",
        "Emperor Palpatine, Galactic Ruler (Command)",
        "Qi'ra, Playing Her Part (Data Vault)",
        "Rey, More Than a Scavenger (Tarkintown)",
        "Cad Bane, He Who Needs No Introduction (Tarkintown)",
        "Jango Fett, Concealing the Conspiracy (Tarkintown)",
    ],
    "star_wars_unli": [
        "Sabine Wren, Galvanized Revolutionary (ECL)",
        "Boba Fett, Collecting the Bounty (Yellow)",
        "Han Solo, Audacious Smuggler (Green)",
        "Emperor Palpatine, Galactic Ruler (Command)",
        "Qi'ra, Playing Her Part (Data Vault)",
        "Luke Skywalker, Faithful Friend (Green)",
    ],
    "star_wars_unli_2": [
        "Luke Skywalker & Han Solo (Heroism Twin Suns)",
        "Darth Vader & Emperor Palpatine (Villainy Twin Suns)",
        "Sabine Wren & Hera Syndulla (Spectre Twin Suns)",
        "Boba Fett & Cad Bane (Underworld Twin Suns)",
        "Rey & Obi-Wan Kenobi (Force Twin Suns)",
    ],
    "dbs_fusion": [
        "Android 17 (Green Ramp)",
        "Beerus (Red Control)",
        "Son Goku (Blue Tempo)",
        "Frieza (Yellow Control)",
        "Goku Black (Blue Midrange)",
        "Broly (Green Power)",
    ],
    "dbs": [
        "Son Goku, Ultra Instinct",
        "Vegeta, Prince of Destruction",
        "Cell, Perfect Evolution",
        "Gogeta, Unrivaled Fusion",
        "Majin Buu, Awakened Evil",
        "Syn Shenron, Shadow Dragon",
    ],
    "union_arena": [
        "Sukuna (Blue Jujutsu Kaisen)",
        "Gon & Killua (Green Hunter x Hunter)",
        "Ichigo Kurosaki (Purple Bleach)",
        "Lelouch Lamperouge (Purple Code Geass)",
        "Saitama (Yellow One Punch Man)",
        "Tanjiro Kamado (Red Demon Slayer)",
    ],
    "final_fantasy_": [
        "Cloud / Tifa (Fire/Earth VII)",
        "Soiree Midrange (Fire/Lightning)",
        "Scions of the Seventh Dawn",
        "Dragons Ramp (Wind/Water)",
        "Warriors of Light (Multi-Element)",
        "Turks Tempo (Lightning/Ice)",
    ],
    "force_of_will": [
        "Reflect // Refrain Control",
        "Pricia, True Beastmaster Aggro",
        "Lumia, the Fated Rebirth",
        "Abdul Alhazred Dark Control",
        "Scheherazade Wind/Light",
        "bahamut, the Dragon King",
    ],
    "cardfight_vang": [
        "Dragon Empire (Varga Dragres)",
        "Dark States (Blangdmire)",
        "Keter Sanctuary (Rezael)",
        "Stoicheia (Levidras)",
        "Brandt Gate (Impauldio)",
        "Lyrical Monasterio (Kairi)",
    ],
    "vanguard_zero": [
        "Royal Paladin (Majesty Lord Blaster)",
        "Kagero (Dragonic Overlord the End)",
        "Shadow Paladin (Phantom Blaster Abyss)",
        "Gold Paladin (Spectral Duke Dragon)",
        "Narukami (Dragonic Kaiser Vermillion)",
    ],
    "weiss_schwarz": [
        "Hololive Production (8 Standby)",
        "Chainsaw Man (Choice/Bar)",
        "Spy x Family (8 Door)",
        "Oshi no Ko (8 Choice)",
        "Frieren: Beyond Journey's End",
        "Sword Art Online Anniversary",
    ],
    "wixoss": [
        "Tama, White Hope Diva",
        "Ulith, Black Miasma",
        "Piruluk, Blue Code",
        "Eldora, Green Mirage",
        "Hanayo, Crimson Flame",
    ],
    "grand_archive": [
        "Lorraine, Crux Knight (Wind)",
        "Rai, Storm Seer (Arcane)",
        "Silvie, Earth Tamer (Tera)",
        "Zander, Shadow Assassin (Umbra)",
        "Diana, Keeneye Ranger (Fire)",
        "Nico, Spirit Weaver (Water)",
    ],
    "keyforge": [
        "Shadows / Dis / Logos",
        "Saurian / Star Alliance / Logos",
        "Untamed / Shadows / Brobnar",
        "Sanctum / Mars / Dis",
        "Ekwidon / Geistoid / Logos",
    ],
    "x_wing": [
        "Rebel Alliance Squadron",
        "Galactic Empire Squadron",
        "Scum and Villainy",
        "Resistance Squadron",
        "First Order Squadron",
        "Galactic Republic Squadron",
        "Separatist Alliance Squadron",
    ],
    "sw_armada": [
        "Imperial Navy Fleet",
        "Rebel Alliance Fleet",
        "Grand Army of the Republic Fleet",
        "Separatist Armada Fleet",
    ],
    "imperial_assau": [
        "Galactic Empire Command",
        "Rebel Alliance Strike Team",
        "Mercenary Syndicate",
    ],
    "star_wars_dest": [
        "Sith Villainy (Blue/Red)",
        "Jedi Heroism (Blue/Yellow)",
        "Scoundrel Underworld (Yellow/Red)",
        "Imperial Trooper Command (Red)",
    ],
    "mordheim": [
        "Mercenaries of Reikland",
        "Cult of the Possessed",
        "Skaven of Clan Eshin",
        "Sisters of Sigmar",
        "Witch Hunters",
        "Undead Warband",
    ],
    "saga": [
        "Vikings",
        "Anglo-Danes",
        "Normans",
        "Welsh",
        "Crusaders",
        "Saracens",
    ],
    "team_yankee": [
        "US Armored Cavalry",
        "Soviet Motor Rifle Battalion",
        "West German Panzertruppen",
        "British BAOR Armored Squadron",
        "French Division Daguet",
    ],
    "ww3_team_yanke": [
        "US Armored Cavalry",
        "Soviet Motor Rifle Battalion",
        "West German Panzertruppen",
        "British BAOR Armored Squadron",
        "Warsaw Pact Tank Division",
    ],
    "konflikt_47": [
        "US Heavy Tesla Platoon",
        "German Axis Schwere Punkt",
        "British Automated Infantry",
        "Soviet Bloch Herd",
        "Imperial Japanese Ghost Division",
    ],
    "blood_red_skie": [
        "RAF Spitfire Squadron",
        "Luftwaffe Messerschmitt Bf 109 Wing",
        "USAAF P-51 Mustang Group",
        "IJN Zero Fighter Squadron",
        "Soviet Yak-3 Regiment",
    ],
    "blood_and_plun": [
        "English Buccaneers",
        "Spanish Tercios",
        "French Brethren of the Coast",
        "Dutch Privateers",
        "Native Kalinago",
    ],
    "kings_of_war": [
        "Dwarfs",
        "Elves",
        "Abyssal Dwarfs",
        "Empire of Dust",
        "Nightstalkers",
        "Northern Alliance",
        "Undead",
        "Orcs",
    ],
    "ninth_age": [
        "Empire of Sonnstahl",
        "Kingdom of Equitaine",
        "Warriors of the Dark Gods",
        "Vampire Covenant",
        "Highborn Elves",
        "Sylvan Elves",
        "Dwarven Holds",
        "Undying Dynasties",
    ],
    "warmaster": [
        "Empire",
        "Undead Tomb Kings",
        "Chaos",
        "High Elves",
        "Dwarfs",
        "Orcs & Goblins",
    ],
    "aeronautica": [
        "Imperial Navy Wing",
        "Ork Air Waaagh!",
        "Asuryani Air Wing",
        "Adeptus Astartes Squadron",
        "T'au Air Caste",
    ],
    "batman_tmg": [
        "Batman Family",
        "Joker's Clown Crew",
        "League of Assassins",
        "Court of Owls",
        "Bane's Mercenaries",
        "Gotham City Police Department",
    ],
    "heroclix": [
        "Avengers Theme Team",
        "X-Men Theme Team",
        "Justice League Theme Team",
        "Cosmic Entity Team",
        "Mystical Theme Team",
    ],
    "monsterpocalyp": [
        "Protectors (G.U.A.R.D. & Terrasaurs)",
        "Destroyers (Planet Eaters & Lords of Cthul)",
        "Martian Menace",
        "Subterran Uprising",
        "Shadow Sun Syndicate",
    ],
    "warcaster_neo_": [
        "Iron Star Alliance",
        "Marcher Worlds",
        "Aeternus Continuum",
        "Empyrean",
    ],
    "starcraft_tabl": [
        "Terran Dominion",
        "Zerg Swarm",
        "Protoss Daelaam",
        "Raynor's Raiders",
    ],
    "transformers": [
        "Autobots (Optimus Prime)",
        "Decepticons (Megatron)",
        "Dinobots Strike Team",
        "Constructicons (Devastator)",
        "Seekers (Starscream)",
    ],
    "smash_bros": [
        "Fox McCloud",
        "Steve",
        "Sonic",
        "Cloud Strife",
        "Joker",
        "Pyra / Mythra",
    ],
    "king_of_tokyo": [
        "Gigazaur",
        "Cyber Kitty",
        "Alienoid",
        "Meka Dragon",
        "The King",
        "Space Penguin",
    ],
    "catan": [
        "Ore-Wheat-Sheep (Cities & Development)",
        "Brick-Wood Expansion (Longest Road)",
        "Port Monopoly Specialist",
        "Balanced 6-8 Resource Production",
    ],
    "catan_champ": [
        "Ore-Wheat-Sheep (Cities & Development)",
        "Brick-Wood Expansion (Longest Road)",
        "Port Monopoly Specialist",
        "Balanced 6-8 Resource Production",
    ],
    "rivals": [
        "Era of Gold (Merchant Guilds)",
        "Era of Turmoil (Hero Defense)",
        "Era of Progress (University Cities)",
        "Maritime Trade Fleet",
    ],
    "ticket_to_ride": [
        "Transcontinental Long-Route Strategy",
        "Central Hub Blocking",
        "East Coast Short-Ticket Rush",
        "Pacific Corridor Express",
    ],
    "legend_of_the_": [
        "Crab Clan",
        "Crane Clan",
        "Dragon Clan",
        "Lion Clan",
        "Phoenix Clan",
        "Scorpion Clan",
        "Unicorn Clan",
    ],
    "game_of_throne": [
        "House Stark",
        "House Lannister",
        "House Targaryen",
        "House Baratheon",
        "House Tyrell",
        "House Martell",
        "The Night's Watch",
        "House Greyjoy",
    ],
    "doomtown": [
        "Law Dogs",
        "Outlaws (Sloane Gang)",
        "Morgan Cattle Co.",
        "Fourth Ring",
        "Eagle Wardens",
        "Anarchists",
    ],
    "hero_realms": [
        "Fighter",
        "Wizard",
        "Rogue",
        "Cleric",
        "Ranger",
        "Thief",
    ],
    "star_realms": [
        "Trade Federation",
        "Blob",
        "Star Empire",
        "Machine Cult",
    ],
    "epic": [
        "Good / Sage Control",
        "Evil / Wild Aggro",
        "Good / Wild Midrange",
        "Sage / Evil Tempo",
    ],
    "battle_spirits": [
        "Red Nova Dragon",
        "White Mecha Defense",
        "Purple Curse Control",
        "Yellow Celestial Tempo",
        "Green Beast Rush",
    ],
    "future_card_bu": [
        "Dragon World",
        "Darkness Dragon World",
        "Star Dragon World",
        "Magic World",
        "Legend World",
    ],
    "naruto": [
        "Hidden Leaf Village (Konoha)",
        "Akatsuki Organization",
        "Hidden Sand Village (Suna)",
        "Uchiha Clan Sharingan",
        "Six Paths Sage",
    ],
    "metazoo": [
        "Mothman (Dark/Forest)",
        "Chupacabra (Flame/Beast)",
        "Loveland Frogman (Water/Lightning)",
        "Bigfoot (Forest/Earth)",
        "Wendigo (Frost/Spirit)",
    ],
    "universus_my_h": [
        "Izuku Midoriya (One For All)",
        "Katsuki Bakugo (Explosion)",
        "Shoto Todoroki (Half-Cold Half-Hot)",
        "All Might (Symbol of Peace)",
        "Tomura Shigaraki (Decay)",
    ],
    "universal_figh": [
        "Ryu (Hadouken Control)",
        "Chun-Li (Lightning Legs)",
        "Scorpion (Netherrealm Aggro)",
        "Jin Kazama (Mishima Style)",
    ],
    "vs_system_2pcg": [
        "Avengers",
        "X-Men",
        "Brotherhood of Mutants",
        "Guardians of the Galaxy",
        "Sinister Syndicate",
        "Wakanda",
    ],
    "beyblade": [
        "Wizard Rod 9-60B",
        "Phoenix Wing 3-60R",
        "Dran Buster 1-60A",
        "Cobalt Dragoon 5-60E",
        "Silver Wolf 9-70FB",
    ],
    "steel_rift": [
        "United Solari Federation",
        "New Edom Coalition",
        "Ares Syndicate",
        "Outer Rim Freeholders",
    ],
    "blkout": [
        "UN Raid Force",
        "6th Spetsnaz",
        "Manticore PMC",
        "Harlow Extraction Unit",
    ],
    "marcher_empire": [
        "United States",
        "Holy Roman Empire",
        "British Empire",
        "French Republic",
        "Soviet Union",
    ],
    "aos_champions": [
        "Order Alliance",
        "Chaos Alliance",
        "Death Alliance",
        "Destruction Alliance",
    ],
    "argent_saga": [
        "Hanna, Constructor of Magic (Water)",
        "fires of Sol (Fire)",
        "Gala, Spirit of the Woods (Air)",
        "Kala, Shadow Arbiter (Dark)",
    ],
    "blood_fields": [
        "Cursebearers",
        "Slaves of R'lyeh",
        "Claws of Behemoth",
        "Order of the Dragon",
    ],
    "chrono_core": [
        "Aegis Mecha Corps",
        "Valkyrie Squadron",
        "Nova Overdrive",
        "Zero Horizon",
    ],
    "chrono_core_tc": [
        "Aegis Mecha Corps",
        "Valkyrie Squadron",
        "Nova Overdrive",
        "Zero Horizon",
    ],
    "genesis_battle": [
        "Ra'Haem",
        "Beli'Mah",
        "Ketsali",
        "Zorsa",
    ],
    "godsforge": [
        "Covenant of Flame",
        "Order of the Veil",
        "Sylvan Conclave",
        "Obsidian Pact",
    ],
    "onslaught": [
        "Iron Legion",
        "Obsidian Order",
        "Crimson Pact",
        "Emerald Phalanx",
    ],
    "outward_realms": [
        "Solar Sovereign",
        "Astral Conclave",
        "Verdant Wilds",
        "Abyssal Reach",
    ],
    "primal_tcg": [
        "Apex Predator",
        "Volcanic Titan",
        "Tempest Stalker",
        "Glacial Warden",
    ],
    "shard_bugs_tcg": [
        "Carapace Swarm",
        "Venom Weaver",
        "Crystal Mantis",
        "Hive Sovereign",
    ],
    "soul_masters_t": [
        "Astral Summoner",
        "Abyssal Reaper",
        "Solar Paladin",
        "Storm Weaver",
    ],
    "vibes": [
        "Cool Penguin Aggro",
        "Royal Penguin Control",
        "Disco Penguin Tempo",
        "Mystic Penguin Combo",
    ],
    "warlord_saga_o": [
        "Deverenian Empire",
        "Free Kingdoms",
        "Elves of Isthak",
        "Dwarves of Highforge",
        "Nothrog Horde",
    ],
    "wartide": [
        "Imperial Guard",
        "Highborne",
        "Dread Horde",
        "Wildkin",
    ],
    "zenozard": [
        "Rei (Red Aggro)",
        "Ash (Yellow Midrange)",
        "aglaea (White Control)",
        "Charmi (Green Ramp)",
    ],
    "annapurna": [
        "North Ridge Expedition",
        "South Face Alpine Team",
        "East Glacier Sherpa Team",
        "Summit Assault Rope",
    ],
    "bi_ho": [
        "Premier Striker Club",
        "Atletico Finger FC",
        "Real Tabletop CF",
        "Olympique Flick",
    ],
    "flex_nba_battl": [
        "Western Conference All-Stars",
        "Eastern Conference All-Stars",
        "Perimeter 3-Point Dynasty",
        "Paint Defense Titans",
    ],
    "roba": [
        "Main Event Heel Stable",
        "High-Flyer Cruiserweights",
        "Technical Submission Specialists",
        "Powerhouse Tag Champions",
    ],
    "riftbound": [
        "Jinx (Chaos Aggro)",
        "Viktor (Hexcore Control)",
        "Yasuo (Tempest Midrange)",
        "Ahri (Spirit Fox Tempo)",
        "Darius (Noxian Might)",
        "Lux (Demacian Radiance)",
    ],
    "guild_ball": [
        "Butchers",
        "Fishermen",
        "Masons",
        "Brewers",
        "Alchemists",
        "Engineers",
        "Morticians",
        "Hunters",
        "Blacksmiths",
        "Farmers",
        "Falconers",
        "Union",
    ],
    "generic": [
        "Crimson Legion",
        "Azure Coalition",
        "Obsidian Dominion",
        "Emerald Covenant",
    ],
}


def is_placeholder_faction(name: Optional[str], game_system: Optional[str] = None) -> bool:
    """Returns True if `name` is an empty/placeholder string, 2v2 composite string, or super-faction."""
    if not name:
        return True
    s = str(name).strip()
    if not s:
        return True
    low = s.lower()
    if low in PLACEHOLDER_FACTION_NAMES:
        return True
    if low.startswith("pod (") or low.startswith("commander pod"):
        return True
    if " + " in s:
        return True
    norm_sys = normalize_game_system(game_system, default="40k") if game_system else ""
    if norm_sys == "middle_earth" and low in ("good", "evil"):
        return True
    if norm_sys in ("40k", "aos") and low in ("imperium", "chaos", "xenos", "order", "death", "destruction"):
        return True
    return False


def get_default_factions_for_system(game_system: Optional[str]) -> List[str]:
    """Returns canonical default factions/archetypes for any of the 118 game systems in BCP_GAME_SYSTEMS_CATALOG."""
    norm = normalize_game_system(game_system, default="40k")
    if norm in GAME_SYSTEM_DEFAULT_FACTIONS:
        return list(GAME_SYSTEM_DEFAULT_FACTIONS[norm])
    meta = GAME_SYSTEM_BY_SLUG.get(norm)
    short = (meta.get("short_name") or meta.get("name")) if meta else norm.replace("_", " ").title()
    return [
        f"{short} Crimson Legion",
        f"{short} Azure Coalition",
        f"{short} Obsidian Dominion",
        f"{short} Emerald Covenant",
    ]


def resolve_canonical_faction(
    raw_faction: Optional[str],
    game_system: Optional[str] = "40k",
    player_id: Optional[str] = "",
    resolve_placeholders: bool = False,
) -> str:
    """
    Canonicalizes a faction/deck/commander name for `game_system`.
    - Maps known aliases (e.g., 'Space Marines (Astartes)' -> 'Space Marines', 'Lumineth Realm-Lords' -> 'Lumineth Realm-lords').
    - Strips super-faction prefixes only when prefix is a known 40K/AoS super-faction or subfaction prefix.
    - In `middle_earth`, maps 'Good' / 'Evil' deterministically to specific Middle-earth armies.
    - When `resolve_placeholders=True`, deterministically assigns a canonical faction from `get_default_factions_for_system(game_system)`
      using `player_id` when `raw_faction` is a placeholder ('Unknown', 'Standard Deck', 'Premier Deck', etc.).
    """
    norm_sys = normalize_game_system(game_system, default="40k")
    s = str(raw_faction or "").strip()
    low = s.lower()

    if norm_sys == "middle_earth" and low in ("good", "evil"):
        if not resolve_placeholders:
            return ""
        good_armies = ["Minas Tirith", "Rohan", "Lothlorien", "Iron Hills"]
        evil_armies = ["Mordor", "Isengard", "Harad", "Angmar"]
        pool = good_armies if low == "good" else evil_armies
        digest = int(hashlib.md5(f"mesbg:{low}:{player_id or 'default'}".encode("utf-8")).hexdigest()[:8], 16)
        return pool[digest % len(pool)]

    if low in FACTION_ALIAS_CANONICAL_MAP:
        return FACTION_ALIAS_CANONICAL_MAP[low]

    if norm_sys in ("40k", "aos") and ":" in s:
        prefix, suffix = [p.strip() for p in s.split(":", 1)]
        pref_low = prefix.lower()
        suf_low = suffix.lower()
        if pref_low in ("imperium", "chaos", "xenos", "aeldari", "space marines", "adeptus astartes", "order", "death", "destruction"):
            if suf_low in FACTION_ALIAS_CANONICAL_MAP:
                return FACTION_ALIAS_CANONICAL_MAP[suf_low]
            if suffix and not is_placeholder_faction(suffix, norm_sys):
                return suffix
        if pref_low in FACTION_ALIAS_CANONICAL_MAP:
            return FACTION_ALIAS_CANONICAL_MAP[pref_low]

    if is_placeholder_faction(s, norm_sys):
        if not resolve_placeholders:
            return ""
        defaults = get_default_factions_for_system(norm_sys)
        digest = int(hashlib.md5(f"{norm_sys}:{player_id or 'default'}".encode("utf-8")).hexdigest()[:8], 16)
        return defaults[digest % len(defaults)]

    return s

