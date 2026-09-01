"""Configuration settings for Best Coast Pairings Warhammer 40k scraper and Elo engine."""

import os
from pathlib import Path


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

# Game System IDs on BCP
GAME_SYSTEMS = {
    "warhammer_40k": "WGMSzfKFYA",  # Warhammer 40,000
    "warhammer_tow": "pd0PejEmWE",  # Warhammer The Old World
    "warhammer_underworlds": "Z8rcM0GCLw",
}

DEFAULT_GAME_SYSTEM_ID = GAME_SYSTEMS["warhammer_40k"]

# Elo Engine Default Parameters
INITIAL_ELO = 1500.0
DEFAULT_K_FACTOR = 32.0
PROVISIONAL_MATCH_COUNT = 10
MIN_MATCHES_FOR_RANKING = 3
PROVISIONAL_K_FACTOR = 48.0
