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

# Canonical BCP Game Systems Catalog (All 118 BCP systems sorted by popularity)
BCP_GAME_SYSTEMS_CATALOG: List[Dict[str, Any]] = [
    {
        "slug": "40k",
        "bcp_id": "WGMSzfKFYA",
        "short_name": "40K",
        "name": "Warhammer 40,000",
        "bcp_name": "Warhammer 40,000",
        "manufacturer": "Games Workshop",
        "icon": "\u2694\ufe0f",
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
        "icon": "\u26a1",
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
        "icon": "\ud83c\udfaf",
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
        "icon": "\ud83d\udee1\ufe0f",
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
        "icon": "\ud83e\udd85",
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
        "icon": "\ud83d\udde1\ufe0f",
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
        "icon": "\ud83c\udfc8",
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
        "icon": "\ud83d\udc8d",
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
        "icon": "\ud83d\udc8e",
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
        "icon": "\ud83d\udd25",
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
        "icon": "\u2623\ufe0f",
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
        "icon": "\ud83c\udfdb\ufe0f",
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
        "icon": "\ud83e\ude96",
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
        "icon": "\ud83e\uddb8",
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
        "icon": "\ud83e\ude90",
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
        "icon": "\ud83e\ude90",
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
        "icon": "\u271d\ufe0f",
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
        "icon": "\ud83e\uddbf",
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
        "icon": "\ud83e\uddbf",
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
        "icon": "\u2694\ufe0f",
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
        "icon": "\u2699\ufe0f",
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
        "icon": "\ud83d\udef0\ufe0f",
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
        "icon": "\ud83c\udfa9",
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
        "icon": "\ud83d\udc3a",
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
        "icon": "\ud83c\udf96\ufe0f",
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
        "icon": "\ud83c\udf0c",
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
        "icon": "\ud83e\ude96",
        "has_tracker": False,
        "popularity_rank": 27
    },
    {
        "slug": "one_piece",
        "bcp_id": "r5jWPuzwHN",
        "short_name": "One Piece",
        "name": "One Piece Card Game",
        "bcp_name": "One Piece",
        "manufacturer": "Bandai",
        "icon": "\ud83c\udff4\u200d\u2620\ufe0f",
        "has_tracker": False,
        "popularity_rank": 28
    },
    {
        "slug": "yugioh",
        "bcp_id": "mM4pewNtcT",
        "short_name": "Yu-Gi-Oh!",
        "name": "Yu-Gi-Oh! TCG",
        "bcp_name": "Yu-Gi-Oh!",
        "manufacturer": "Konami",
        "icon": "\ud83d\udd2e",
        "has_tracker": False,
        "popularity_rank": 29
    },
    {
        "slug": "mtg",
        "bcp_id": "FM1PYUZbsL",
        "short_name": "MTG",
        "name": "Magic: The Gathering",
        "bcp_name": "Magic the Gathering",
        "manufacturer": "Wizards of the Coast",
        "icon": "\ud83d\udd25",
        "has_tracker": False,
        "popularity_rank": 30
    },
    {
        "slug": "commander",
        "bcp_id": "2UgcKy4txd",
        "short_name": "Commander",
        "name": "MTG: Commander",
        "bcp_name": "Commander",
        "manufacturer": "Wizards of the Coast",
        "icon": "\ud83e\uddd9",
        "has_tracker": False,
        "popularity_rank": 31
    },
    {
        "slug": "pokemon",
        "bcp_id": "Y9lj1TOc6A",
        "short_name": "Pok\u00e9mon",
        "name": "Pok\u00e9mon TCG",
        "bcp_name": "Pok\u00e9mon",
        "manufacturer": "Nintendo",
        "icon": "\u26a1",
        "has_tracker": False,
        "popularity_rank": 32
    },
    {
        "slug": "lorcana",
        "bcp_id": "l0vo0C77Ch",
        "short_name": "Lorcana",
        "name": "Disney Lorcana",
        "bcp_name": "Lorcana",
        "manufacturer": "Ravensburger",
        "icon": "\u2728",
        "has_tracker": False,
        "popularity_rank": 33
    },
    {
        "slug": "digimon",
        "bcp_id": "0O1SPSSzw2",
        "short_name": "Digimon",
        "name": "Digimon Card Game",
        "bcp_name": "Digimon Card Game",
        "manufacturer": "Bandai",
        "icon": "\ud83e\udd96",
        "has_tracker": False,
        "popularity_rank": 34
    },
    {
        "slug": "gundam_tcg",
        "bcp_id": "67ae9f34b9bba6cca026e77f",
        "short_name": "Gundam TCG",
        "name": "Gundam Card Game",
        "bcp_name": "Gundam TCG",
        "manufacturer": "Bandai",
        "icon": "\ud83e\udd16",
        "has_tracker": False,
        "popularity_rank": 35
    },
    {
        "slug": "flesh_blood",
        "bcp_id": "oDXFQoeX0M",
        "short_name": "Flesh & Blood",
        "name": "Flesh and Blood TCG",
        "bcp_name": "Flesh And Blood",
        "manufacturer": "Legend Story Studio",
        "icon": "\ud83e\ude78",
        "has_tracker": False,
        "popularity_rank": 36
    },
    {
        "slug": "sw_unlimited",
        "bcp_id": "SImHT3ZR3V",
        "short_name": "SW Unlimited",
        "name": "Star Wars: Unlimited",
        "bcp_name": "Star Wars Unlimited",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83e\ude90",
        "has_tracker": False,
        "popularity_rank": 37
    },
    {
        "slug": "generic",
        "bcp_id": "H1hbQ5G0eY",
        "short_name": "Generic",
        "name": "Generic / Other Tabletop",
        "bcp_name": "Generic",
        "manufacturer": "Generic",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 38
    },
    {
        "slug": "catan_champ",
        "bcp_id": "VkLBPJ4lQb",
        "short_name": "CATAN Champ.",
        "name": "CATAN Championship",
        "bcp_name": "CATAN Championship",
        "manufacturer": "CATAN",
        "icon": "\ud83c\udfc6",
        "has_tracker": False,
        "popularity_rank": 39
    },
    {
        "slug": "shard_bugs_tcg",
        "bcp_id": "6786db6b26624e31ba8f5534",
        "short_name": "Shard Bugs TCG",
        "name": "Shard Bugs TCG",
        "bcp_name": "Shard Bugs TCG",
        "manufacturer": "Shard Bugs",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 40
    },
    {
        "slug": "soul_masters_t",
        "bcp_id": "67af3471bf62de059769280a",
        "short_name": "Soul Masters TCG",
        "name": "Soul Masters TCG",
        "bcp_name": "Soul Masters TCG",
        "manufacturer": "Soul Masters",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 41
    },
    {
        "slug": "catan",
        "bcp_id": "ADvcKMDSFy",
        "short_name": "CATAN",
        "name": "CATAN",
        "bcp_name": "CATAN",
        "manufacturer": "CATAN",
        "icon": "\ud83c\udfdd\ufe0f",
        "has_tracker": False,
        "popularity_rank": 42
    },
    {
        "slug": "dbs_fusion",
        "bcp_id": "hrIkLY89ww",
        "short_name": "DBS Fusion",
        "name": "Dragon Ball Super: Fusion World",
        "bcp_name": "DBS Fusion World",
        "manufacturer": "Bandai",
        "icon": "\ud83d\udc09",
        "has_tracker": False,
        "popularity_rank": 43
    },
    {
        "slug": "dbs",
        "bcp_id": "POYzp05n9p",
        "short_name": "Dragon Ball",
        "name": "Dragon Ball Super Card Game",
        "bcp_name": "Dragon Ball Super",
        "manufacturer": "Bandai",
        "icon": "\ud83d\udc09",
        "has_tracker": False,
        "popularity_rank": 44
    },
    {
        "slug": "union_arena",
        "bcp_id": "66eb85e893f18eaacd38a818",
        "short_name": "Union Arena",
        "name": "Union Arena TCG",
        "bcp_name": "Union Arena",
        "manufacturer": "Bandai",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 45
    },
    {
        "slug": "primal_tcg",
        "bcp_id": "6608f946040ba4024c011a36",
        "short_name": "Primal TCG",
        "name": "Primal TCG",
        "bcp_name": "Primal TCG",
        "manufacturer": "Dattebayo Labs",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 46
    },
    {
        "slug": "final_fantasy_",
        "bcp_id": "8GFaZ0y25D",
        "short_name": "Final Fantasy T\u2026",
        "name": "Final Fantasy TCG",
        "bcp_name": "Final Fantasy TCG",
        "manufacturer": "SQUARE ENIX",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 47
    },
    {
        "slug": "force_of_will",
        "bcp_id": "2s24lv1FXr",
        "short_name": "Force of Will",
        "name": "Force of Will",
        "bcp_name": "Force of Will",
        "manufacturer": "Force of Will",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 48
    },
    {
        "slug": "ww3_team_yanke",
        "bcp_id": "66db52c8fe9b80fb2f18ce94",
        "short_name": "WW3 Team Yankee",
        "name": "WW3 Team Yankee",
        "bcp_name": "WW3 Team Yankee",
        "manufacturer": "Battlefront Miniatures",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 49
    },
    {
        "slug": "aof_opr",
        "bcp_id": "trBDgd23tVbT",
        "short_name": "Age of Fantasy",
        "name": "Age of Fantasy (OPR)",
        "bcp_name": "Age of Fantasy",
        "manufacturer": "One Page Rules",
        "icon": "\ud83d\udc09",
        "has_tracker": False,
        "popularity_rank": 50
    },
    {
        "slug": "battletech_tw",
        "bcp_id": "66db524e0c1f49d6136c487a",
        "short_name": "BT Total War",
        "name": "BattleTech: Total Warfare",
        "bcp_name": "Battletech Total Warfare",
        "manufacturer": "Catalyst",
        "icon": "\ud83e\uddbf",
        "has_tracker": False,
        "popularity_rank": 51
    },
    {
        "slug": "cardfight_vang",
        "bcp_id": "6O28cKLVdN",
        "short_name": "Cardfight! Vang\u2026",
        "name": "Cardfight! Vangaurd",
        "bcp_name": "Cardfight! Vangaurd",
        "manufacturer": "Bushiroad",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 52
    },
    {
        "slug": "marcher_empire",
        "bcp_id": "kJ5tCtljRK85",
        "short_name": "Marcher: Empire\u2026",
        "name": "Marcher: Empires at War",
        "bcp_name": "Marcher: Empires at War",
        "manufacturer": "Golden Dragon Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 53
    },
    {
        "slug": "mordheim",
        "bcp_id": "ygDIbtGbFg",
        "short_name": "Mordheim",
        "name": "Mordheim",
        "bcp_name": "Mordheim",
        "manufacturer": "Games Workshop",
        "icon": "\ud83d\udd6f\ufe0f",
        "has_tracker": False,
        "popularity_rank": 54
    },
    {
        "slug": "saga",
        "bcp_id": "nhnF6MNV04",
        "short_name": "SAGA",
        "name": "SAGA",
        "bcp_name": "Saga",
        "manufacturer": "Studio Tomahawk",
        "icon": "\ud83d\udee1\ufe0f",
        "has_tracker": False,
        "popularity_rank": 55
    },
    {
        "slug": "team_yankee",
        "bcp_id": "66bc4103d5b0ec49b6a2dbfb",
        "short_name": "Team Yankee",
        "name": "Team Yankee",
        "bcp_name": "Team Yankee",
        "manufacturer": "Battlefront Miniatures",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 56
    },
    {
        "slug": "ticket_to_ride",
        "bcp_id": "661e1d2b6d494f1ed7334910",
        "short_name": "Ticket to Ride",
        "name": "Ticket to Ride",
        "bcp_name": "Ticket to Ride",
        "manufacturer": "Asmodee",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 57
    },
    {
        "slug": "wartide",
        "bcp_id": "6674207e3468bc0bc894ade4",
        "short_name": "Wartide",
        "name": "Wartide",
        "bcp_name": "Wartide",
        "manufacturer": "Wartide",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 58
    },
    {
        "slug": "x_wing",
        "bcp_id": "bx62OfZBGb",
        "short_name": "X-Wing",
        "name": "Star Wars: X-Wing",
        "bcp_name": "X-Wing",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83d\ude80",
        "has_tracker": False,
        "popularity_rank": 59
    },
    {
        "slug": "aeronautica",
        "bcp_id": "xQ7Nrr30tj",
        "short_name": "Aeronautica",
        "name": "Aeronautica Imperialis",
        "bcp_name": "Aeronautica",
        "manufacturer": "Games Workshop",
        "icon": "\u2708\ufe0f",
        "has_tracker": False,
        "popularity_rank": 60
    },
    {
        "slug": "age_of_fantasy",
        "bcp_id": "B8m83OPe8OnU",
        "short_name": "Age of Fantasy\u2026",
        "name": "Age of Fantasy Skirmish",
        "bcp_name": "Age of Fantasy Skirmish",
        "manufacturer": "One Page Rules",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 61
    },
    {
        "slug": "aos_champions",
        "bcp_id": "5hX6tOfDHv",
        "short_name": "AoS Champions",
        "name": "Age of Sigmar: Champions",
        "bcp_name": "Age of Sigmar: Champions",
        "manufacturer": "Play Fusion",
        "icon": "\ud83c\udccf",
        "has_tracker": False,
        "popularity_rank": 62
    },
    {
        "slug": "annapurna",
        "bcp_id": "Agoe0Asx9M",
        "short_name": "AnnaPurna",
        "name": "AnnaPurna",
        "bcp_name": "AnnaPurna",
        "manufacturer": "Fiat Lucre",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 63
    },
    {
        "slug": "argent_saga",
        "bcp_id": "X0130kMDD6",
        "short_name": "Argent Saga",
        "name": "Argent Saga",
        "bcp_name": "Argent Saga",
        "manufacturer": "Amikon Entertainment",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 64
    },
    {
        "slug": "batman_tmg",
        "bcp_id": "v857jmhYSv",
        "short_name": "Batman : TMG",
        "name": "Batman : TMG",
        "bcp_name": "Batman : TMG",
        "manufacturer": "Knight Models",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 65
    },
    {
        "slug": "battle_spirits",
        "bcp_id": "Z9MvTncufZ",
        "short_name": "Battle Spirits\u2026",
        "name": "Battle Spirits Saga",
        "bcp_name": "Battle Spirits Saga",
        "manufacturer": "Bandai",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 66
    },
    {
        "slug": "beyblade",
        "bcp_id": "itaOMAgBTWqs",
        "short_name": "Beyblade",
        "name": "Beyblade",
        "bcp_name": "Beyblade",
        "manufacturer": "Beyblade",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 67
    },
    {
        "slug": "bi_ho",
        "bcp_id": "65fb7934cdaa32a59a1d4b89",
        "short_name": "Bi\u00f1ho",
        "name": "Bi\u00f1ho",
        "bcp_name": "Bi\u00f1ho",
        "manufacturer": "Binho Board",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 68
    },
    {
        "slug": "blkout",
        "bcp_id": "ro4xyyTWREhF",
        "short_name": "BLKOUT",
        "name": "BLKOUT",
        "bcp_name": "BLKOUT",
        "manufacturer": "BLKOUT",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 69
    },
    {
        "slug": "blood_and_plun",
        "bcp_id": "66db6045abc0360803e9a3a2",
        "short_name": "Blood and Plund\u2026",
        "name": "Blood and Plunder",
        "bcp_name": "Blood and Plunder",
        "manufacturer": "Firelock Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 70
    },
    {
        "slug": "blood_fields",
        "bcp_id": "MXCAl2xYYG",
        "short_name": "Blood Fields",
        "name": "Blood Fields",
        "bcp_name": "Blood Fields",
        "manufacturer": "Titan Forge",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 71
    },
    {
        "slug": "blood_red_skie",
        "bcp_id": "wtv9VrjMWt",
        "short_name": "Blood Red Skies",
        "name": "Blood Red Skies",
        "bcp_name": "Blood Red Skies",
        "manufacturer": "Warlord Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 72
    },
    {
        "slug": "chrono_core",
        "bcp_id": "66df997f746f34555ccce16f",
        "short_name": "Chrono Core",
        "name": "Chrono Core",
        "bcp_name": "Chrono Core",
        "manufacturer": "Chrono Core Studios",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 73
    },
    {
        "slug": "chrono_core_tc",
        "bcp_id": "67bdb7c1bf62de0597692872",
        "short_name": "Chrono Core TCG",
        "name": "Chrono Core TCG",
        "bcp_name": "Chrono Core TCG",
        "manufacturer": "Chrono Core",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 74
    },
    {
        "slug": "doomtown",
        "bcp_id": "1U5bWEJTWw",
        "short_name": "Doomtown",
        "name": "Doomtown",
        "bcp_name": "Doomtown",
        "manufacturer": "Pine Box Entertainment",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 75
    },
    {
        "slug": "epic",
        "bcp_id": "kHseS0TYLo",
        "short_name": "Epic",
        "name": "Epic",
        "bcp_name": "Epic",
        "manufacturer": "White Wizard Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 76
    },
    {
        "slug": "flex_nba_battl",
        "bcp_id": "4ugzUcccmW",
        "short_name": "Flex NBA Battle\u2026",
        "name": "Flex NBA Battle Series",
        "bcp_name": "Flex NBA Battle Series",
        "manufacturer": "Sequoia Games Inc.",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 77
    },
    {
        "slug": "future_card_bu",
        "bcp_id": "7jbbuBKD24",
        "short_name": "Future Card Bud\u2026",
        "name": "Future Card Buddyfight",
        "bcp_name": "Future Card Buddyfight",
        "manufacturer": "Bushiroad",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 78
    },
    {
        "slug": "game_of_throne",
        "bcp_id": "EdhBk0q4c4",
        "short_name": "Game of Thrones\u2026",
        "name": "Game of Thrones the Card Game",
        "bcp_name": "Game of Thrones the Card Game",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 79
    },
    {
        "slug": "genesis_battle",
        "bcp_id": "662a8fbc7d069d1a9e33efe9",
        "short_name": "Genesis: Battle\u2026",
        "name": "Genesis: Battle of Champtions",
        "bcp_name": "Genesis: Battle of Champtions",
        "manufacturer": "Edge of Exile Entertainment Inc.",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 80
    },
    {
        "slug": "godsforge",
        "bcp_id": "0BmDs4dUIi",
        "short_name": "Godsforge",
        "name": "Godsforge",
        "bcp_name": "Godsforge",
        "manufacturer": "Atlas Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 81
    },
    {
        "slug": "grand_archive",
        "bcp_id": "K3me9vfATM",
        "short_name": "Grand Archive",
        "name": "Grand Archive",
        "bcp_name": "Grand Archive",
        "manufacturer": "Weebs of the Shore",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 82
    },
    {
        "slug": "hero_realms",
        "bcp_id": "s6TAZbwxML",
        "short_name": "Hero Realms",
        "name": "Hero Realms",
        "bcp_name": "Hero Realms",
        "manufacturer": "White Wizard Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 83
    },
    {
        "slug": "heroclix",
        "bcp_id": "mIXqdaGANs",
        "short_name": "HeroClix",
        "name": "HeroClix",
        "bcp_name": "HeroClix",
        "manufacturer": "Wizkids",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 84
    },
    {
        "slug": "imperial_assau",
        "bcp_id": "5CgWAgFADE",
        "short_name": "Imperial Assault",
        "name": "Imperial Assault",
        "bcp_name": "Imperial Assault",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 85
    },
    {
        "slug": "keyforge",
        "bcp_id": "Z5J97FvlKe",
        "short_name": "Keyforge",
        "name": "Keyforge",
        "bcp_name": "Keyforge",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 86
    },
    {
        "slug": "king_of_tokyo",
        "bcp_id": "9kl7L9nldU",
        "short_name": "King of Tokyo",
        "name": "King of Tokyo",
        "bcp_name": "King of Tokyo",
        "manufacturer": "iello",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 87
    },
    {
        "slug": "kings_of_war",
        "bcp_id": "FQ4DfKKpEU",
        "short_name": "Kings of War",
        "name": "Kings of War",
        "bcp_name": "Kings of War",
        "manufacturer": "Mantic Games",
        "icon": "\ud83c\udff0",
        "has_tracker": False,
        "popularity_rank": 88
    },
    {
        "slug": "konflikt_47",
        "bcp_id": "tQjLdaXhcJ",
        "short_name": "Konflikt 47",
        "name": "Konflikt '47",
        "bcp_name": "Konflict '47",
        "manufacturer": "Warlord Games",
        "icon": "\u2622\ufe0f",
        "has_tracker": False,
        "popularity_rank": 89
    },
    {
        "slug": "legend_of_the_",
        "bcp_id": "p8aUEX6mDs",
        "short_name": "Legend of the F\u2026",
        "name": "Legend of the Five Rings",
        "bcp_name": "Legend of the Five Rings",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 90
    },
    {
        "slug": "metazoo",
        "bcp_id": "9NxxBJf4Na",
        "short_name": "Metazoo",
        "name": "Metazoo",
        "bcp_name": "Metazoo",
        "manufacturer": "Metazoo Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 91
    },
    {
        "slug": "monsterpocalyp",
        "bcp_id": "7uUGktcIRq",
        "short_name": "Monsterpocalypse",
        "name": "Monsterpocalypse",
        "bcp_name": "Monsterpocalypse",
        "manufacturer": "Privateer Press",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 92
    },
    {
        "slug": "naruto",
        "bcp_id": "PDAuoa5cgK",
        "short_name": "Naruto",
        "name": "Naruto",
        "bcp_name": "Naruto",
        "manufacturer": "Bandai",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 93
    },
    {
        "slug": "onslaught",
        "bcp_id": "8hN1ihJ8DN",
        "short_name": "ONSLAUGHT",
        "name": "ONSLAUGHT",
        "bcp_name": "ONSLAUGHT",
        "manufacturer": "Whiz Kids",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 94
    },
    {
        "slug": "outward_realms",
        "bcp_id": "605bcf998226840d4bc00ffe",
        "short_name": "Outward Realms",
        "name": "Outward Realms",
        "bcp_name": "Outward Realms",
        "manufacturer": "Outward Realms",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 95
    },
    {
        "slug": "rivals",
        "bcp_id": "v6qfejJRUx",
        "short_name": "Rivals",
        "name": "Rivals",
        "bcp_name": "Rivals",
        "manufacturer": "CATAN",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 96
    },
    {
        "slug": "roba",
        "bcp_id": "NAK4OpT3kT",
        "short_name": "ROBA",
        "name": "ROBA",
        "bcp_name": "ROBA",
        "manufacturer": "Heel Turn Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 97
    },
    {
        "slug": "smash_bros",
        "bcp_id": "WZbaMtGhEr",
        "short_name": "Smash Bros",
        "name": "Smash Bros",
        "bcp_name": "Smash Bros",
        "manufacturer": "Nintendo",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 98
    },
    {
        "slug": "star_realms",
        "bcp_id": "SOuCmjcwce",
        "short_name": "Star Realms",
        "name": "Star Realms",
        "bcp_name": "Star Realms",
        "manufacturer": "White Wizard Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 99
    },
    {
        "slug": "sw_armada",
        "bcp_id": "gRTgm28uhQ",
        "short_name": "SW Armada",
        "name": "Star Wars: Armada",
        "bcp_name": "Star Wars Armada",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83d\ude80",
        "has_tracker": False,
        "popularity_rank": 100
    },
    {
        "slug": "star_wars_dest",
        "bcp_id": "NPyZIKwtCl",
        "short_name": "Star Wars Desti\u2026",
        "name": "Star Wars Destiny",
        "bcp_name": "Star Wars Destiny",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 101
    },
    {
        "slug": "star_wars_unli",
        "bcp_id": "maCXHs5gaX",
        "short_name": "Star Wars Unlim\u2026",
        "name": "Star Wars Unlimited - Casual",
        "bcp_name": "Star Wars Unlimited - Casual",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 102
    },
    {
        "slug": "star_wars_unli_2",
        "bcp_id": "kwl9ZSdevH",
        "short_name": "Star Wars Unlim\u2026",
        "name": "Star Wars Unlimited : Twin Suns",
        "bcp_name": "Star Wars Unlimited : Twin Suns",
        "manufacturer": "Fantasy Flight Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 103
    },
    {
        "slug": "starcraft_tabl",
        "bcp_id": "HqgiM2fMCAoN",
        "short_name": "StarCraft Table\u2026",
        "name": "StarCraft Tabletop Miniatures Game",
        "bcp_name": "StarCraft Tabletop Miniatures Game",
        "manufacturer": "Archon Studio",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 104
    },
    {
        "slug": "steel_rift",
        "bcp_id": "Ur7ZvRF1wPWq",
        "short_name": "Steel Rift",
        "name": "Steel Rift",
        "bcp_name": "Steel Rift",
        "manufacturer": "Death Ray Designs",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 105
    },
    {
        "slug": "ninth_age",
        "bcp_id": "jnffUQYAK8",
        "short_name": "The 9th Age",
        "name": "The 9th Age",
        "bcp_name": "The 9th Age",
        "manufacturer": "The IX Age",
        "icon": "\ud83d\udee1\ufe0f",
        "has_tracker": False,
        "popularity_rank": 106
    },
    {
        "slug": "transformers",
        "bcp_id": "u2P27ZSURD",
        "short_name": "Transformers",
        "name": "Transformers",
        "bcp_name": "Transformers",
        "manufacturer": "Hasbro",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 107
    },
    {
        "slug": "universal_figh",
        "bcp_id": "JV0A6xP5qy",
        "short_name": "Universal  Figh\u2026",
        "name": "Universal  Fighting  System",
        "bcp_name": "Universal  Fighting  System",
        "manufacturer": "Jasco Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 108
    },
    {
        "slug": "universus_my_h",
        "bcp_id": "QzusTyUknx",
        "short_name": "Universus: My H\u2026",
        "name": "Universus: My Hero Academia",
        "bcp_name": "Universus: My Hero Academia",
        "manufacturer": "Jasco Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 109
    },
    {
        "slug": "vanguard_zero",
        "bcp_id": "VFHr8IArQ0",
        "short_name": "Vanguard Zero",
        "name": "Vanguard Zero",
        "bcp_name": "Vanguard Zero",
        "manufacturer": "Bushiroad",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 110
    },
    {
        "slug": "vibes",
        "bcp_id": "67b79ae8bf62de0597692833",
        "short_name": "Vibes",
        "name": "Vibes",
        "bcp_name": "Vibes",
        "manufacturer": "Orange Cap Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 111
    },
    {
        "slug": "vs_system_2pcg",
        "bcp_id": "QQrdiF5Kz6",
        "short_name": "VS System 2PCG",
        "name": "VS System 2PCG",
        "bcp_name": "VS System 2PCG",
        "manufacturer": "Upper Deck",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 112
    },
    {
        "slug": "warcaster_neo_",
        "bcp_id": "vHcENvcLKL",
        "short_name": "Warcaster: Neo-\u2026",
        "name": "Warcaster: Neo-Mechanika",
        "bcp_name": "Warcaster: Neo-Mechanika",
        "manufacturer": "Privateer Press",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 113
    },
    {
        "slug": "warlord_saga_o",
        "bcp_id": "lBoE1G9nbwVO",
        "short_name": "Warlord: Saga o\u2026",
        "name": "Warlord: Saga of the Storm",
        "bcp_name": "Warlord: Saga of the Storm",
        "manufacturer": "KingsWood Games",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 114
    },
    {
        "slug": "warmaster",
        "bcp_id": "XBegtc4oDI",
        "short_name": "Warmaster",
        "name": "Warmaster Revolution",
        "bcp_name": "Warmaster Revolution",
        "manufacturer": "Games Workshop",
        "icon": "\ud83d\udc51",
        "has_tracker": False,
        "popularity_rank": 115
    },
    {
        "slug": "weiss_schwarz",
        "bcp_id": "dMEhR6bh0o",
        "short_name": "Weiss Schwarz",
        "name": "Weiss Schwarz",
        "bcp_name": "Weiss Schwarz",
        "manufacturer": "Bushiroad",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 116
    },
    {
        "slug": "wixoss",
        "bcp_id": "3fzaceXdNL",
        "short_name": "Wixoss",
        "name": "Wixoss",
        "bcp_name": "Wixoss",
        "manufacturer": "Takara Tomy",
        "icon": "\ud83c\udfb2",
        "has_tracker": False,
        "popularity_rank": 117
    },
    {
        "slug": "zenozard",
        "bcp_id": "LMFB6r3HEU",
        "short_name": "Zenozard",
        "name": "Zenozard",
        "bcp_name": "Zenozard",
        "manufacturer": "Bandai",
        "icon": "\ud83c\udfb4",
        "has_tracker": False,
        "popularity_rank": 118
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
    "star wars: legion": "sw_legion",
    "star wars: shatterpoint": "shatterpoint",
    "star wars: armada": "sw_armada",
    "star wars: x-wing": "x_wing",
    "star wars: unlimited": "sw_unlimited",
    "magic: the gathering": "mtg",
    "pokemon": "pokemon",
    "pokémon": "pokemon",
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


def get_bcp_game_system_id(slug_or_id: Optional[str], default: str = DEFAULT_GAME_SYSTEM_ID) -> str:
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
    return raw if len(raw) >= 8 else default


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
