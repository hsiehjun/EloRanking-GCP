"""PostgreSQL Database backend for Warhammer 40k Elo Ranking and BCP scraper."""

import json
import logging
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import collections
from typing import Any, Dict, List, Optional, Tuple, Set, Union
from datetime import datetime, timezone, timedelta

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        BCP_API_BASE,
        DEFAULT_HEADERS,
        DEFAULT_GAME_SYSTEM_ID,
    )
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            BCP_API_BASE,
            DEFAULT_HEADERS,
            DEFAULT_GAME_SYSTEM_ID,
        )
    except ImportError:
        try:
            from config import (
                BCP_API_BASE,
                DEFAULT_HEADERS,
                DEFAULT_GAME_SYSTEM_ID,
            )
        except ImportError:
            BCP_API_BASE = "https://newprod-api.bestcoastpairings.com/v1"
            DEFAULT_HEADERS = {
                "client-id": "web-app",
                "env": "bcp",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin": "https://www.bestcoastpairings.com",
                "Referer": "https://www.bestcoastpairings.com/",
            }
            DEFAULT_GAME_SYSTEM_ID = "WGMSzfKFYA"

try:
    import psycopg2
    from psycopg2 import pool, extras
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

logger = logging.getLogger("elo.db_postgres")


class PostgresDatabase:
    """Manages high-concurrency, MVCC PostgreSQL storage for events, matches, ratings, and players."""

    _pool = None
    _stats_cache = None
    _db_initialized = False
    _stats_cache_time = 0
    _all_teams_cache = None
    _all_teams_cache_time = 0
    _faction_meta_cache_dict = {}
    _players_cache_dict = {}
    _teams_cache_dict = {}
    _team_roster_cache_dict = {}
    _community_overview_cache_dict = {}
    _bcp_upcoming_cache_dict = {}
    _stores_cache_dict = {}
    _place_details_cache_dict = {}
    CACHE_TTL_SECONDS = 600

    @classmethod
    def get_cached(cls, cache_dict: dict, key: Any, ttl: int = 180) -> Optional[Any]:
        if key in cache_dict:
            val, ts = cache_dict[key]
            if (time.time() - ts) < ttl:
                return val
        return None

    @classmethod
    def set_cached(cls, cache_dict: dict, key: Any, val: Any) -> None:
        if len(cache_dict) > 1000:
            cache_dict.clear()
        cache_dict[key] = (val, time.time())

    @classmethod
    def invalidate_all_caches(cls) -> None:
        cls._stats_cache = None
        cls._all_teams_cache = None
        cls._all_teams_cache_time = 0
        cls._faction_meta_cache_dict.clear()
        cls._players_cache_dict.clear()
        cls._teams_cache_dict.clear()
        cls._team_roster_cache_dict.clear()
        cls._community_overview_cache_dict.clear()
        cls._bcp_upcoming_cache_dict.clear()
        cls._stores_cache_dict.clear()
        cls._place_details_cache_dict.clear()

    def __init__(self, dsn: Optional[str] = None, db_path: Optional[str] = None, *args, **kwargs):
        if not PSYCOPG2_AVAILABLE:
            raise ImportError("psycopg2 is not installed. Run 'pip install psycopg2-binary' or 'sudo apt install python3-psycopg2'.")

        raw_dsn = dsn or os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or os.environ.get("POSTGRES_DSN") or "postgresql://elo_user:elo_password@localhost:5432/elo_ranking"
        self.dsn = self._normalize_dsn(raw_dsn)

        try:
            self._ensure_pool()
            if not PostgresDatabase._db_initialized:
                self.init_db()
                self.ensure_tracker_table()
                PostgresDatabase._db_initialized = True
        except Exception as e:
            logger.warning(f"Initial DB connect notice (will retry on query): {e}")

    def _ensure_pool(self):
        if PostgresDatabase._pool is None:
            try:
                PostgresDatabase._pool = pool.ThreadedConnectionPool(
                    minconn=1,
                    maxconn=40,
                    dsn=self.dsn
                )
                logger.info(f"PostgreSQL connection pool initialized with DSN: {self._sanitize_dsn(self.dsn)}")
            except Exception as e:
                logger.error(f"Failed to connect to PostgreSQL pool ({self._sanitize_dsn(self.dsn)}): {e}")
                raise

    @property
    def db_path(self) -> str:
        return self._sanitize_dsn(self.dsn)

    def _normalize_dsn(self, raw_dsn: str) -> str:
        """Parses and converts any PostgreSQL URL or Cloud SQL DSN into standard libpq keyword format."""
        if not raw_dsn:
            return "dbname=elo_ranking"
        raw_dsn = raw_dsn.strip()
        
        # If pure keyword DSN (e.g. 'dbname=... user=... host=...')
        if not raw_dsn.startswith(("postgresql://", "postgres://")) and ("=" in raw_dsn):
            return raw_dsn

        try:
            import urllib.parse
            import re
            parsed = urllib.parse.urlparse(raw_dsn)
            qs = urllib.parse.parse_qs(parsed.query)
            
            host = qs.get("host", [""])[0]
            if not host and parsed.hostname:
                host = parsed.hostname
            if not host and "/cloudsql/" in raw_dsn:
                m = re.search(r'/cloudsql/([^\s&/?]+)', raw_dsn)
                if m:
                    host = f"/cloudsql/{m.group(1)}"
                    
            port = qs.get("port", [""])[0] or (str(parsed.port) if parsed.port else "")
            dbname = parsed.path.lstrip("/").split("?")[0] or "elo_ranking"
            user = urllib.parse.unquote(parsed.username or "")
            password = urllib.parse.unquote(parsed.password or "")
            
            parts = []
            if dbname:
                parts.append(f"dbname={dbname}")
            if user:
                parts.append(f"user={user}")
            if password:
                parts.append(f"password={password}")
            if host:
                parts.append(f"host={host}")
            if port:
                parts.append(f"port={port}")
            return " ".join(parts)
        except Exception as e:
            logger.warning(f"DSN normalization notice: {e}")
            return raw_dsn

    def _sanitize_dsn(self, dsn: str) -> str:
        if "@" in dsn:
            return dsn.split("@")[-1]
        return dsn

    def get_connection(self):
        """Context manager yielding a pooled PostgreSQL connection."""
        self._ensure_pool()
        conn = PostgresDatabase._pool.getconn()
        return PostgresConnectionContext(PostgresDatabase._pool, conn)

    def init_db(self):
        """Creates PostgreSQL tables and performance indexes safely without deadlocking with active scraping jobs."""
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                    SELECT 
                        to_regclass('public.events') IS NOT NULL
                        AND to_regclass('public.matches') IS NOT NULL
                        AND to_regclass('public.player_ratings') IS NOT NULL
                        AND to_regclass('public.system_settings') IS NOT NULL;
                    """)
                    row = cursor.fetchone()
                    if row and row[0]:
                        cursor.execute("SELECT value FROM system_settings WHERE key = 'db_schema_ready';")
                        setting = cursor.fetchone()
                        if setting and setting[0] == 'true':
                            return
        except Exception as e:
            logger.debug(f"DB schema pre-check notice: {e}")

        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT pg_try_advisory_lock(123456789);")
                    acquired = cursor.fetchone()[0]
                    if not acquired:
                        logger.info("Another process is currently initializing DB schema; skipping.")
                        return

            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '2s';")
                    cursor.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id VARCHAR(64) PRIMARY KEY,
                    name TEXT NOT NULL,
                    event_date TIMESTAMPTZ,
                    end_date TIMESTAMPTZ,
                    city TEXT,
                    state TEXT,
                    country TEXT,
                    total_players INT DEFAULT 0,
                    num_rounds INT DEFAULT 0,
                    current_round INT DEFAULT 0,
                    is_ended BOOLEAN DEFAULT FALSE,
                    game_system_id VARCHAR(64),
                    raw_json JSONB,
                    scraped_at TIMESTAMPTZ DEFAULT NOW()
                );

                ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type VARCHAR(32) DEFAULT 'singles';
                ALTER TABLE events ADD COLUMN IF NOT EXISTS team_size INT DEFAULT 1;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS circuits JSONB DEFAULT '[]'::jsonb;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_name TEXT;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS address TEXT;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);
                ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS place_id VARCHAR(128);
                ALTER TABLE events ADD COLUMN IF NOT EXISTS started BOOLEAN DEFAULT FALSE;
                ALTER TABLE events ADD COLUMN IF NOT EXISTS pairings_status VARCHAR(32) DEFAULT 'draft';
                CREATE INDEX IF NOT EXISTS idx_events_lat_lng ON events (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
                UPDATE events
                SET latitude = (raw_json->'coordinate'->>1)::double precision,
                    longitude = (raw_json->'coordinate'->>0)::double precision
                WHERE latitude IS NULL 
                  AND jsonb_typeof(raw_json->'coordinate') = 'array' 
                  AND jsonb_array_length(raw_json->'coordinate') = 2;

                UPDATE events
                SET latitude = (raw_json->'location'->'coordinate'->>1)::double precision,
                    longitude = (raw_json->'location'->'coordinate'->>0)::double precision
                WHERE latitude IS NULL 
                  AND jsonb_typeof(raw_json->'location'->'coordinate') = 'array' 
                  AND jsonb_array_length(raw_json->'location'->'coordinate') = 2;

                CREATE TABLE IF NOT EXISTS players (
                    id VARCHAR(64) PRIMARY KEY,
                    first_name TEXT,
                    last_name TEXT,
                    full_name TEXT,
                    team TEXT,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS matches (
                    id VARCHAR(64) PRIMARY KEY,
                    event_id VARCHAR(64) REFERENCES events(id) ON DELETE CASCADE,
                    round INT NOT NULL,
                    table_number INT DEFAULT 1,
                    match_date TIMESTAMPTZ,
                    player1_id VARCHAR(64),
                    player1_name TEXT,
                    player1_faction TEXT,
                    player1_score INT,
                    player2_id VARCHAR(64),
                    player2_name TEXT,
                    player2_faction TEXT,
                    player2_score INT,
                    winner_id VARCHAR(64),
                    loser_id VARCHAR(64),
                    is_draw BOOLEAN DEFAULT FALSE,
                    is_bye BOOLEAN DEFAULT FALSE,
                    is_done BOOLEAN DEFAULT TRUE,
                    raw_json JSONB
                );

                CREATE TABLE IF NOT EXISTS player_ratings (
                    player_id VARCHAR(64) PRIMARY KEY,
                    player_name TEXT,
                    current_elo DOUBLE PRECISION DEFAULT 1500.0,
                    peak_elo DOUBLE PRECISION DEFAULT 1500.0,
                    matches_played INT DEFAULT 0,
                    wins INT DEFAULT 0,
                    losses INT DEFAULT 0,
                    draws INT DEFAULT 0,
                    win_rate DOUBLE PRECISION DEFAULT 0.0,
                    top_faction TEXT,
                    team TEXT,
                    last_active_date TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS rating_history (
                    id BIGSERIAL PRIMARY KEY,
                    player_id VARCHAR(64) NOT NULL,
                    match_id VARCHAR(64) NOT NULL,
                    event_id VARCHAR(64) NOT NULL,
                    round INT,
                    match_date TIMESTAMPTZ,
                    old_elo DOUBLE PRECISION,
                    new_elo DOUBLE PRECISION,
                    delta_elo DOUBLE PRECISION,
                    opponent_id VARCHAR(64),
                    opponent_name TEXT,
                    opponent_elo DOUBLE PRECISION,
                    result VARCHAR(8),
                    player_faction TEXT,
                    opponent_faction TEXT,
                    player_score INT,
                    opponent_score INT
                );

                CREATE TABLE IF NOT EXISTS event_participants (
                    event_id VARCHAR(64) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                    player_id VARCHAR(64) NOT NULL,
                    first_name TEXT,
                    last_name TEXT,
                    full_name TEXT,
                    faction TEXT,
                    team TEXT,
                    placement INT,
                    battle_points INT,
                    dropped BOOLEAN DEFAULT FALSE,
                    checked_in BOOLEAN DEFAULT FALSE,
                    PRIMARY KEY (event_id, player_id)
                );

                CREATE INDEX IF NOT EXISTS idx_pg_matches_event ON matches(event_id);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_date ON matches(match_date, round, table_number);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_chrono ON matches(match_date ASC NULLS FIRST, round ASC, table_number ASC) WHERE is_done = TRUE;
                CREATE INDEX IF NOT EXISTS idx_pg_matches_p1 ON matches(player1_id);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_p2 ON matches(player2_id);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_p1_p2 ON matches(player1_id, player2_id);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_fac1 ON matches(player1_faction, is_done);
                CREATE INDEX IF NOT EXISTS idx_pg_matches_fac2 ON matches(player2_faction, is_done);

                CREATE INDEX IF NOT EXISTS idx_pg_history_player ON rating_history(player_id, match_date DESC);
                CREATE INDEX IF NOT EXISTS idx_pg_ratings_elo ON player_ratings(current_elo DESC);
                CREATE INDEX IF NOT EXISTS idx_pg_ratings_name ON player_ratings(player_name);
                CREATE INDEX IF NOT EXISTS idx_pg_ratings_team ON player_ratings(team, current_elo DESC);
                CREATE INDEX IF NOT EXISTS idx_pg_ratings_faction ON player_ratings(top_faction);
                CREATE INDEX IF NOT EXISTS idx_pg_events_date ON events(event_date DESC);
                CREATE INDEX IF NOT EXISTS idx_pg_participants_event ON event_participants(event_id);

                CREATE TABLE IF NOT EXISTS tracker_games (
                    match_id VARCHAR(64) PRIMARY KEY,
                    p1_name TEXT,
                    p1_faction TEXT,
                    p1_detachment TEXT,
                    p1_score INT DEFAULT 0,
                    p2_name TEXT,
                    p2_faction TEXT,
                    p2_detachment TEXT,
                    p2_score INT DEFAULT 0,
                    user_id_p1 VARCHAR(64),
                    user_id_p2 VARCHAR(64),
                    p1_role TEXT DEFAULT 'player1',
                    p2_role TEXT DEFAULT 'player2',
                    referee_ids TEXT[] DEFAULT '{}',
                    primary_mission TEXT,
                    deployment TEXT,
                    mission_rule TEXT,
                    current_round INT DEFAULT 1,
                    started BOOLEAN DEFAULT FALSE,
                    is_finished BOOLEAN DEFAULT FALSE,
                    winner_name TEXT,
                    version INT DEFAULT 1,
                    state_json JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_tracker_games_updated ON tracker_games(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_tracker_games_p1 ON tracker_games(p1_name);
                CREATE INDEX IF NOT EXISTS idx_tracker_games_p2 ON tracker_games(p2_name);
                """)
            conn.commit()
        except Exception as e:
            logger.info(f"init_db notice (schema already created or active DDL lock): {e}")

        # Run independent column migrations
        migrations_list = [
            "ALTER TABLE players ADD COLUMN IF NOT EXISTS team TEXT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS team TEXT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS placement INT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS battle_points INT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS pod_num INT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p1 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p2 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_role TEXT DEFAULT 'player1';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_role TEXT DEFAULT 'player2';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS referee_ids TEXT[] DEFAULT '{}';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS state_json JSONB;",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'Local / RTT';",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT;",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_id VARCHAR(64);",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_bcp_id VARCHAR(64);",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS points INT DEFAULT 2000;",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS capacity INT DEFAULT 32;",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS mission_pack TEXT DEFAULT '11th Edition Core';",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS roster JSONB DEFAULT '[]'::jsonb;",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS pairings JSONB DEFAULT '{}'::jsonb;",
            "CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events(organizer_id);",
            "CREATE INDEX IF NOT EXISTS idx_events_organizer_bcp_id ON events(organizer_bcp_id);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid1 ON tracker_games(user_id_p1);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid2 ON tracker_games(user_id_p2);",
            """CREATE TABLE IF NOT EXISTS user_army_lists (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64),
                name TEXT NOT NULL,
                faction TEXT NOT NULL,
                detachment TEXT,
                points INT DEFAULT 2000,
                points_limit INT DEFAULT 2000,
                warlord TEXT,
                source_format TEXT,
                raw_text TEXT,
                list_data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "CREATE INDEX IF NOT EXISTS idx_user_army_lists_uid ON user_army_lists(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_user_army_lists_faction ON user_army_lists(faction);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_army_list JSONB;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_army_list JSONB;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_army_list_id VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_army_list_id VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS tournament_id VARCHAR(128);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS table_number INT;",
            """CREATE TABLE IF NOT EXISTS tournament_judge_calls (
                id VARCHAR(64) PRIMARY KEY,
                event_id VARCHAR(128) NOT NULL,
                table_num INT,
                match_id VARCHAR(64),
                player_name VARCHAR(128),
                category VARCHAR(64),
                note TEXT,
                status VARCHAR(32) DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ
            );""",
            "CREATE INDEX IF NOT EXISTS idx_judge_calls_event ON tournament_judge_calls(event_id, status);",
            """CREATE TABLE IF NOT EXISTS tournament_wtc_drafts (
                id VARCHAR(64) PRIMARY KEY,
                event_id VARCHAR(128) NOT NULL,
                round_num INT NOT NULL,
                team_a_name VARCHAR(128),
                team_b_name VARCHAR(128),
                draft_state JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(event_id, round_num)
            );""",
            "CREATE INDEX IF NOT EXISTS idx_wtc_drafts_event ON tournament_wtc_drafts(event_id, round_num);",
            """CREATE TABLE IF NOT EXISTS user_feedbacks (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(128),
                user_email VARCHAR(256),
                feedback_type VARCHAR(32) DEFAULT 'bug',
                message TEXT NOT NULL,
                page_url TEXT,
                device_info TEXT,
                status VARCHAR(32) DEFAULT 'new',
                admin_notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "ALTER TABLE user_feedbacks ADD COLUMN IF NOT EXISTS admin_notes TEXT;",
            "ALTER TABLE user_feedbacks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();",
            "CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON user_feedbacks(created_at DESC);",

            """CREATE TABLE IF NOT EXISTS player_lfg_profiles (
                player_id VARCHAR(64) PRIMARY KEY,
                is_active BOOLEAN DEFAULT FALSE,
                home_venue_name TEXT,
                address TEXT,
                city VARCHAR(128),
                state VARCHAR(64),
                country VARCHAR(64) DEFAULT 'United States',
                postal_code VARCHAR(32),
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                radius_miles INT DEFAULT 30,
                preferred_points INT DEFAULT 2000,
                play_style VARCHAR(64) DEFAULT 'Competitive',
                availability_notes TEXT,
                factions TEXT,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS home_venue_name TEXT;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS address TEXT;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS city VARCHAR(128);",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS state VARCHAR(64);",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS country VARCHAR(64) DEFAULT 'United States';",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS radius_miles INT DEFAULT 30;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS preferred_points INT DEFAULT 2000;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS play_style VARCHAR(64) DEFAULT 'Competitive';",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS availability_notes TEXT;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS factions TEXT;",
            "ALTER TABLE player_lfg_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();",
            "CREATE INDEX IF NOT EXISTS idx_lfg_active_geo ON player_lfg_profiles(is_active, latitude, longitude);",

            """CREATE TABLE IF NOT EXISTS match_requests (
                id VARCHAR(64) PRIMARY KEY,
                sender_id VARCHAR(64) NOT NULL,
                receiver_id VARCHAR(64) NOT NULL,
                status VARCHAR(32) DEFAULT 'pending',
                proposed_venue TEXT,
                proposed_points INT DEFAULT 2000,
                proposed_date TEXT,
                note TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS proposed_venue TEXT;",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS proposed_points INT DEFAULT 2000;",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS proposed_date TEXT;",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS note TEXT;",
            "ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();",
            "CREATE INDEX IF NOT EXISTS idx_match_requests_sender ON match_requests(sender_id);",
            "CREATE INDEX IF NOT EXISTS idx_match_requests_receiver ON match_requests(receiver_id);",
            "CREATE INDEX IF NOT EXISTS idx_match_requests_status ON match_requests(status);",

            """CREATE TABLE IF NOT EXISTS match_chat_messages (
                id VARCHAR(64) PRIMARY KEY,
                request_id VARCHAR(64) NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
                sender_id VARCHAR(64) NOT NULL,
                message_text TEXT NOT NULL,
                room_key VARCHAR(64),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                read_at TIMESTAMPTZ
            );""",
            "ALTER TABLE match_chat_messages ADD COLUMN IF NOT EXISTS room_key VARCHAR(64);",
            "ALTER TABLE match_chat_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;",
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_req ON match_chat_messages(request_id, created_at ASC);",
            """CREATE TABLE IF NOT EXISTS community_chat_messages (
                id VARCHAR(64) PRIMARY KEY,
                region VARCHAR(128) NOT NULL DEFAULT 'global',
                sender_id VARCHAR(64) NOT NULL,
                sender_name TEXT NOT NULL,
                sender_role VARCHAR(32) DEFAULT 'player',
                sender_elo DOUBLE PRECISION,
                message_text TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS sender_role VARCHAR(32) DEFAULT 'player';",
            "ALTER TABLE community_chat_messages ADD COLUMN IF NOT EXISTS sender_elo DOUBLE PRECISION;",
            "CREATE INDEX IF NOT EXISTS idx_comm_chat_reg_created ON community_chat_messages(region, created_at DESC);",
            """CREATE TABLE IF NOT EXISTS waha_factions (
                id TEXT,
                name TEXT,
                link TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_factions_name ON waha_factions(LOWER(name));",
            """CREATE TABLE IF NOT EXISTS waha_sources (
                id TEXT,
                name TEXT,
                type TEXT,
                edition TEXT,
                version TEXT,
                errata_date TEXT,
                errata_link TEXT
            );""",
            """CREATE TABLE IF NOT EXISTS waha_datasheets (
                id TEXT,
                name TEXT,
                faction_id TEXT,
                source_id TEXT,
                legend TEXT,
                role TEXT,
                loadout TEXT,
                transport TEXT,
                virtual TEXT,
                is_support TEXT,
                leader_head TEXT,
                leader_footer TEXT,
                damaged_w TEXT,
                damaged_description TEXT,
                link TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_datasheets_name ON waha_datasheets(LOWER(name));",
            "CREATE INDEX IF NOT EXISTS idx_waha_datasheets_faction ON waha_datasheets(faction_id);",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_models (
                datasheet_id TEXT,
                line TEXT,
                name TEXT,
                M TEXT,
                T TEXT,
                Sv TEXT,
                inv_sv TEXT,
                inv_sv_descr TEXT,
                W TEXT,
                Ld TEXT,
                OC TEXT,
                base_size TEXT,
                base_size_descr TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_models_ds ON waha_datasheet_models(datasheet_id);",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_wargear (
                datasheet_id TEXT,
                line TEXT,
                line_in_wargear TEXT,
                dice TEXT,
                name TEXT,
                description TEXT,
                range TEXT,
                type TEXT,
                A TEXT,
                BS_WS TEXT,
                S TEXT,
                AP TEXT,
                D TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_wargear_ds ON waha_datasheet_wargear(datasheet_id);",
            "CREATE INDEX IF NOT EXISTS idx_waha_wargear_name ON waha_datasheet_wargear(LOWER(name));",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_abilities (
                datasheet_id TEXT,
                line TEXT,
                ability_id TEXT,
                model TEXT,
                name TEXT,
                description TEXT,
                type TEXT,
                parameter TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_abilities_ds ON waha_datasheet_abilities(datasheet_id);",
            "CREATE INDEX IF NOT EXISTS idx_waha_abilities_name ON waha_datasheet_abilities(LOWER(name));",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_keywords (
                datasheet_id TEXT,
                keyword TEXT,
                model TEXT,
                is_faction_keyword TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_keywords_ds ON waha_datasheet_keywords(datasheet_id);",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_costs (
                datasheet_id TEXT,
                line TEXT,
                description TEXT,
                cost TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_costs_ds ON waha_datasheet_costs(datasheet_id);",
            """CREATE TABLE IF NOT EXISTS waha_datasheet_leaders (
                leader_id TEXT,
                attached_id TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_leaders_lead ON waha_datasheet_leaders(leader_id);",
            "CREATE INDEX IF NOT EXISTS idx_waha_leaders_att ON waha_datasheet_leaders(attached_id);",
            """CREATE TABLE IF NOT EXISTS waha_stratagems (
                faction_id TEXT,
                name TEXT,
                id TEXT,
                type TEXT,
                cp_cost TEXT,
                legend TEXT,
                turn TEXT,
                phase TEXT,
                detachment TEXT,
                detachment_id TEXT,
                description TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_stratagems_det ON waha_stratagems(LOWER(detachment));",
            "CREATE INDEX IF NOT EXISTS idx_waha_stratagems_fac ON waha_stratagems(faction_id);",
            """CREATE TABLE IF NOT EXISTS waha_enhancements (
                faction_id TEXT,
                name TEXT,
                id TEXT,
                cost TEXT,
                detachment TEXT,
                detachment_id TEXT,
                upgrade TEXT,
                legend TEXT,
                description TEXT,
                support_leader TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_enhancements_det ON waha_enhancements(LOWER(detachment));",
            """CREATE TABLE IF NOT EXISTS waha_army_abilities (
                id TEXT,
                name TEXT,
                legend TEXT,
                faction_id TEXT,
                description TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_army_ab_fac ON waha_army_abilities(faction_id);",
            """CREATE TABLE IF NOT EXISTS waha_detachment_abilities (
                id TEXT,
                faction_id TEXT,
                name TEXT,
                legend TEXT,
                description TEXT,
                detachment TEXT,
                detachment_id TEXT
            );""",
            "CREATE INDEX IF NOT EXISTS idx_waha_det_ab_det ON waha_detachment_abilities(LOWER(detachment));",
            """CREATE TABLE IF NOT EXISTS waha_detachments (
                id TEXT,
                faction_id TEXT,
                name TEXT,
                legend TEXT,
                type TEXT,
                dp TEXT,
                force_disposition TEXT
            );""",
            "ALTER TABLE waha_detachments ADD COLUMN IF NOT EXISTS dp TEXT;",
            "ALTER TABLE waha_detachments ADD COLUMN IF NOT EXISTS force_disposition TEXT;",
            "CREATE INDEX IF NOT EXISTS idx_waha_detachments_name ON waha_detachments(LOWER(name));",
            """CREATE TABLE IF NOT EXISTS waha_sync_metadata (
                key VARCHAR(64) PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "CREATE INDEX IF NOT EXISTS idx_pg_participants_player ON event_participants(player_id);",
            "CREATE INDEX IF NOT EXISTS idx_pg_ratings_player_lower ON player_ratings(LOWER(player_name));",
            "CREATE INDEX IF NOT EXISTS idx_users_player_id ON users(player_id);"
        ]
        try:
            with self.get_connection() as conn:
                for migration in migrations_list:
                    try:
                        with conn.cursor() as cursor:
                            cursor.execute("SET lock_timeout = '2s';")
                            cursor.execute(migration)
                        conn.commit()
                    except Exception as e:
                        conn.rollback()
                        logger.debug(f"Migration notice: {e}")

                with conn.cursor() as cursor:
                    cursor.execute("""
                    CREATE TABLE IF NOT EXISTS system_settings (
                        key VARCHAR(64) PRIMARY KEY,
                        value TEXT NOT NULL,
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_by_user_id VARCHAR(64)
                    );
                    CREATE TABLE IF NOT EXISTS deleted_studio_events (
                        event_id VARCHAR(64) PRIMARY KEY,
                        deleted_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    INSERT INTO system_settings (key, value) VALUES ('db_schema_ready', 'true')
                    ON CONFLICT (key) DO UPDATE SET value = 'true';
                    """)
                conn.commit()
        except Exception as err:
            logger.debug(f"init_db migrations notice: {err}")
        finally:
            try:
                with self.get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute("SELECT pg_advisory_unlock(123456789);")
                    conn.commit()
            except Exception:
                pass

    def ensure_tracker_table(self):
        """Guarantees that tracker_games table and all required columns exist."""
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT to_regclass('public.tracker_games') IS NOT NULL;")
                    row = cursor.fetchone()
                    if row and row[0]:
                        return
        except Exception:
            pass

        stmts = [
            """CREATE TABLE IF NOT EXISTS tracker_games (
                match_id VARCHAR(64) PRIMARY KEY,
                p1_name TEXT,
                p1_faction TEXT,
                p1_detachment TEXT,
                p1_score INT DEFAULT 0,
                p2_name TEXT,
                p2_faction TEXT,
                p2_detachment TEXT,
                p2_score INT DEFAULT 0,
                user_id_p1 VARCHAR(64),
                user_id_p2 VARCHAR(64),
                p1_role TEXT DEFAULT 'player1',
                p2_role TEXT DEFAULT 'player2',
                referee_ids TEXT[] DEFAULT '{}',
                primary_mission TEXT,
                deployment TEXT,
                mission_rule TEXT,
                current_round INT DEFAULT 1,
                started BOOLEAN DEFAULT FALSE,
                is_finished BOOLEAN DEFAULT FALSE,
                winner_name TEXT,
                version INT DEFAULT 1,
                state_json JSONB,
                p1_army_list JSONB,
                p2_army_list JSONB,
                p1_army_list_id VARCHAR(64),
                p2_army_list_id VARCHAR(64),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );""",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p1 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p2 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_role TEXT DEFAULT 'player1';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_role TEXT DEFAULT 'player2';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS referee_ids TEXT[] DEFAULT '{}';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS hidden_user_ids TEXT[] DEFAULT '{}';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS state_json JSONB;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS event_id TEXT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS round_num INT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS table_num INT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS who_went_first TEXT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS bcp_submitted BOOLEAN DEFAULT FALSE;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_army_list JSONB;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_army_list JSONB;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_army_list_id VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_army_list_id VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS chess_clock JSONB;",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_updated ON tracker_games(updated_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_p1 ON tracker_games(p1_name);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_p2 ON tracker_games(p2_name);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid1 ON tracker_games(user_id_p1);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid2 ON tracker_games(user_id_p2);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_evt ON tracker_games(event_id, round_num, table_num);"
        ]
        try:
            with self.get_connection() as conn:
                for s in stmts:
                    try:
                        with conn.cursor() as cursor:
                            cursor.execute("SET lock_timeout = '2s';")
                            cursor.execute(s)
                        conn.commit()
                    except Exception as e:
                        conn.rollback()
                        logger.debug(f"Tracker ensure table notice: {e}")
        except Exception as err:
            logger.debug(f"ensure_tracker_table batch notice: {err}")

    def upsert_event(self, event_data: Dict[str, Any]):
        """Inserts or updates an event record in PostgreSQL."""
        event_id = event_data.get("id") or event_data.get("objectId")
        if not event_id:
            return

        with self.get_connection() as conn:
            loc_obj = event_data.get("location") if isinstance(event_data.get("location"), dict) else {}
            venue_val = event_data.get("venue_name") or event_data.get("venue") or loc_obj.get("name") or loc_obj.get("venue")
            addr_val = event_data.get("address") or loc_obj.get("address")
            zip_val = event_data.get("postal_code") or event_data.get("postalCode") or loc_obj.get("postalCode")
            place_id_val = event_data.get("place_id") or loc_obj.get("placeId") or loc_obj.get("place_id")
            lat_val = event_data.get("latitude") if event_data.get("latitude") is not None else event_data.get("lat")
            lng_val = event_data.get("longitude") if event_data.get("longitude") is not None else event_data.get("lng")
            if (lat_val is None or lng_val is None) and isinstance(loc_obj.get("coordinate"), list) and len(loc_obj["coordinate"]) >= 2:
                lng_val = loc_obj["coordinate"][0]
                lat_val = loc_obj["coordinate"][1]

            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO events (
                    id, name, event_date, end_date, city, state, country,
                    total_players, num_rounds, current_round, is_ended,
                    game_system_id, raw_json, scraped_at,
                    venue_name, address, postal_code, latitude, longitude, place_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    event_date = EXCLUDED.event_date,
                    end_date = EXCLUDED.end_date,
                    city = EXCLUDED.city,
                    state = EXCLUDED.state,
                    country = EXCLUDED.country,
                    total_players = EXCLUDED.total_players,
                    num_rounds = EXCLUDED.num_rounds,
                    current_round = EXCLUDED.current_round,
                    is_ended = EXCLUDED.is_ended,
                    game_system_id = EXCLUDED.game_system_id,
                    raw_json = EXCLUDED.raw_json,
                    scraped_at = EXCLUDED.scraped_at,
                    venue_name = COALESCE(EXCLUDED.venue_name, events.venue_name),
                    address = COALESCE(EXCLUDED.address, events.address),
                    postal_code = COALESCE(EXCLUDED.postal_code, events.postal_code),
                    latitude = COALESCE(EXCLUDED.latitude, events.latitude),
                    longitude = COALESCE(EXCLUDED.longitude, events.longitude),
                    place_id = COALESCE(EXCLUDED.place_id, events.place_id);
                """, (
                    event_id,
                    event_data.get("name") or "Unnamed Tournament",
                    event_data.get("eventDate") or event_data.get("event_date"),
                    event_data.get("endDate") or event_data.get("end_date"),
                    event_data.get("city") or loc_obj.get("city"),
                    event_data.get("state") or loc_obj.get("state"),
                    event_data.get("country") or loc_obj.get("country"),
                    event_data.get("totalPlayers", event_data.get("total_players", 0)),
                    event_data.get("numberOfRounds", event_data.get("num_rounds", 0)),
                    event_data.get("currentRound", event_data.get("current_round", 0)),
                    bool(event_data.get("isEnded", event_data.get("is_ended", False))),
                    event_data.get("gameSystemId", event_data.get("game_system_id")),
                    json.dumps(event_data.get("raw_json", event_data)),
                    datetime.now(timezone.utc),
                    venue_val,
                    addr_val,
                    zip_val,
                    float(lat_val) if lat_val is not None else None,
                    float(lng_val) if lng_val is not None else None,
                    place_id_val
                ))
            conn.commit()

    def upsert_player(self, player_id: str, first_name: str = "", last_name: str = "", full_name: str = "", team: str = ""):
        """Inserts or updates player metadata including team affiliation."""
        if not player_id:
            return
        if not full_name:
            full_name = f"{first_name} {last_name}".strip() or "Unknown Player"

        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO players (id, first_name, last_name, full_name, team, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    full_name = EXCLUDED.full_name,
                    team = COALESCE(NULLIF(EXCLUDED.team, ''), players.team),
                    updated_at = EXCLUDED.updated_at;
                """, (player_id, first_name, last_name, full_name, team or None, datetime.now(timezone.utc)))
            conn.commit()

    def upsert_event_participant(
        self,
        event_id: str,
        player_id: str,
        first_name: str = "",
        last_name: str = "",
        full_name: str = "",
        faction: str = "",
        team: str = "",
        dropped: bool = False,
        checked_in: bool = True,
        placement: Optional[int] = None,
        battle_points: Optional[int] = None,
        pod_num: Optional[int] = None
    ):
        """Inserts or updates a tournament participant with team affiliation, bracket pod, and official BCP placing."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO event_participants (
                    event_id, player_id, first_name, last_name, full_name, faction, team, dropped, checked_in, placement, battle_points, pod_num
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (event_id, player_id) DO UPDATE SET
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    full_name = EXCLUDED.full_name,
                    faction = EXCLUDED.faction,
                    team = COALESCE(NULLIF(EXCLUDED.team, ''), event_participants.team),
                    dropped = EXCLUDED.dropped,
                    checked_in = EXCLUDED.checked_in,
                    placement = COALESCE(EXCLUDED.placement, event_participants.placement),
                    battle_points = COALESCE(EXCLUDED.battle_points, event_participants.battle_points),
                    pod_num = COALESCE(EXCLUDED.pod_num, event_participants.pod_num);
                """, (event_id, player_id, first_name, last_name, full_name, faction, team or None, dropped, checked_in, placement, battle_points, pod_num))
            conn.commit()

    def upsert_match(self, match_data: Dict[str, Any]):
        """Inserts or updates a match pairing."""
        event_id = match_data.get("event_id")
        if not event_id or not match_data.get("id"):
            return

        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO events (id, name, event_date, scraped_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING;
                """, (
                    event_id,
                    match_data.get("event_name") or "Tournament",
                    match_data.get("match_date"),
                    datetime.now(timezone.utc)
                ))

                cursor.execute("""
                INSERT INTO matches (
                    id, event_id, round, table_number, match_date,
                    player1_id, player1_name, player1_faction, player1_score,
                    player2_id, player2_name, player2_faction, player2_score,
                    winner_id, loser_id, is_draw, is_bye, is_done, raw_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    event_id = EXCLUDED.event_id,
                    round = EXCLUDED.round,
                    table_number = EXCLUDED.table_number,
                    match_date = EXCLUDED.match_date,
                    player1_id = EXCLUDED.player1_id,
                    player1_name = EXCLUDED.player1_name,
                    player1_faction = EXCLUDED.player1_faction,
                    player1_score = EXCLUDED.player1_score,
                    player2_id = EXCLUDED.player2_id,
                    player2_name = EXCLUDED.player2_name,
                    player2_faction = EXCLUDED.player2_faction,
                    player2_score = EXCLUDED.player2_score,
                    winner_id = EXCLUDED.winner_id,
                    loser_id = EXCLUDED.loser_id,
                    is_draw = EXCLUDED.is_draw,
                    is_bye = EXCLUDED.is_bye,
                    is_done = EXCLUDED.is_done,
                    raw_json = EXCLUDED.raw_json;
                """, (
                    match_data.get("id"),
                    event_id,
                    match_data.get("round", 1),
                    match_data.get("table_number", 1),
                    match_data.get("match_date"),
                    match_data.get("player1_id"),
                    match_data.get("player1_name"),
                    match_data.get("player1_faction"),
                    match_data.get("player1_score"),
                    match_data.get("player2_id"),
                    match_data.get("player2_name"),
                    match_data.get("player2_faction"),
                    match_data.get("player2_score"),
                    match_data.get("winner_id"),
                    match_data.get("loser_id"),
                    bool(match_data.get("is_draw")),
                    bool(match_data.get("is_bye")),
                    bool(match_data.get("is_done", True)),
                    json.dumps(match_data.get("raw_json", {}))
                ))
            conn.commit()

    def get_total_matches_count(self) -> int:
        """Returns total count of valid completed matches."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                SELECT COUNT(*) FROM matches
                WHERE is_done = TRUE
                  AND player1_id IS NOT NULL AND player1_id != ''
                  AND player2_id IS NOT NULL AND player2_id != '';
                """)
                row = cursor.fetchone()
                return row[0] if row else 0

    def get_matches_chunk(self, offset: int, limit: int = 50000) -> List[Dict[str, Any]]:
        """Fetches a chunk of matches ordered chronologically (low memory footprint)."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT 
                    m.id, m.event_id, m.round, m.table_number, m.match_date,
                    m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                    m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                    m.winner_id, m.is_draw, m.is_bye
                FROM matches m
                WHERE m.is_done = TRUE
                  AND m.player1_id IS NOT NULL AND m.player1_id != ''
                  AND m.player2_id IS NOT NULL AND m.player2_id != ''
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC
                LIMIT %s OFFSET %s;
                """, (limit, offset))
                return [dict(r) for r in cursor.fetchall()]

    def get_unranked_matches(self, limit: int = 50000) -> List[Dict[str, Any]]:
        """Returns new matches that do not yet have a record in rating_history."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT 
                    m.id, m.event_id, m.round, m.table_number, m.match_date,
                    m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                    m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                    m.winner_id, m.is_draw, m.is_bye
                FROM matches m
                WHERE m.is_done = TRUE
                  AND m.player1_id IS NOT NULL AND m.player1_id != ''
                  AND m.player2_id IS NOT NULL AND m.player2_id != ''
                  AND NOT EXISTS (
                      SELECT 1 FROM rating_history rh WHERE rh.match_id = m.id LIMIT 1
                  )
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC
                LIMIT %s;
                """, (limit,))
                return [dict(r) for r in cursor.fetchall()]

    def get_all_matches_chronological(self) -> List[Dict[str, Any]]:
        """Returns all completed matches ordered chronologically (optimized for low-memory GCP VMs)."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT 
                    m.id, m.event_id, m.round, m.table_number, m.match_date,
                    m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                    m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                    m.winner_id, m.is_draw, m.is_bye
                FROM matches m
                WHERE m.is_done = TRUE
                  AND m.player1_id IS NOT NULL AND m.player1_id != ''
                  AND m.player2_id IS NOT NULL AND m.player2_id != ''
                ORDER BY m.match_date ASC NULLS FIRST, m.round ASC, m.table_number ASC;
                """)
                return cursor.fetchall()


    def get_summary_stats(self) -> Dict[str, Any]:
        """Returns dashboard summary counts (instant cached)."""
        now = time.time()
        if PostgresDatabase._stats_cache and (now - PostgresDatabase._stats_cache_time) < PostgresDatabase.CACHE_TTL_SECONDS:
            return PostgresDatabase._stats_cache

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("SELECT COUNT(*) as cnt FROM player_ratings WHERE matches_played > 0;")
                total_players = cursor.fetchone()["cnt"]

                cursor.execute("SELECT COUNT(*) as cnt FROM matches WHERE is_done = TRUE;")
                total_matches = cursor.fetchone()["cnt"]

                cursor.execute("SELECT COUNT(*) as cnt FROM events;")
                total_events = cursor.fetchone()["cnt"]

                cursor.execute("SELECT player_name, current_elo FROM player_ratings WHERE matches_played >= 3 ORDER BY current_elo DESC LIMIT 1;")
                top_p = cursor.fetchone() or {"player_name": "None", "current_elo": 1500.0}

                cursor.execute("""
                SELECT DISTINCT TRIM(fac) as f 
                FROM (
                    SELECT UNNEST(STRING_TO_ARRAY(top_faction, ',')) as fac
                    FROM player_ratings
                    WHERE top_faction IS NOT NULL AND TRIM(top_faction) != '' AND top_faction != 'Unknown Faction'
                ) sub
                WHERE TRIM(fac) != '' AND TRIM(fac) != 'Unknown Faction' AND TRIM(fac) != 'Unknown'
                ORDER BY f ASC;
                """)
                factions = [r["f"] for r in cursor.fetchall() if r["f"]]

                res = {
                    "total_players": total_players,
                    "total_matches": total_matches,
                    "total_events": total_events,
                    "top_player_name": top_p["player_name"],
                    "top_player_elo": round(top_p["current_elo"], 1),
                    "factions": factions
                }
                PostgresDatabase._stats_cache = res
                PostgresDatabase._stats_cache_time = now
                return res

    def get_top_ranked_players(self, page=1, page_size=25, limit=None, min_matches=3, query=None, faction=None, sort_by="current_elo", order="DESC") -> Dict[str, Any]:
        return self.get_players_directory(page=page, page_size=page_size, limit=limit, query=query, faction=faction, min_matches=min_matches, sort_by=sort_by, order=order)

    def get_players_directory(self, page=1, page_size=25, limit=None, query=None, faction=None, min_matches=0, sort_by="current_elo", order="DESC") -> Dict[str, Any]:
        """Returns paginated directory of players with total count (instant cached)."""
        if limit is not None and limit > 0:
            page_size = limit
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 25), 200))
        offset = (page - 1) * page_size

        cache_key = (page, page_size, limit, query, faction, min_matches, sort_by, order)
        cached = PostgresDatabase.get_cached(PostgresDatabase._players_cache_dict, cache_key, ttl=90)
        if cached:
            return cached

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                allowed_cols = {
                    "player_name": "player_name",
                    "current_elo": "current_elo",
                    "peak_elo": "peak_elo",
                    "matches_played": "matches_played",
                    "wins": "wins",
                    "losses": "losses",
                    "draws": "draws",
                    "win_rate": "win_rate",
                    "last_active_date": "last_active_date"
                }
                col = allowed_cols.get(sort_by, "current_elo")
                dir_str = "ASC" if str(order).upper() == "ASC" else "DESC"

                if faction and faction != "All" and faction != "All Factions":
                    # Faction isolated aggregation
                    count_sql = """
                    WITH faction_player_matches AS (
                        SELECT player1_id as p_id
                        FROM matches
                        WHERE player1_id IS NOT NULL AND player1_id != '' AND is_done = TRUE
                          AND player1_faction ILIKE %s
                        UNION ALL
                        SELECT player2_id as p_id
                        FROM matches
                        WHERE player2_id IS NOT NULL AND player2_id != '' AND is_bye = FALSE AND is_done = TRUE
                          AND player2_faction ILIKE %s
                    ),
                    qualifying_players AS (
                        SELECT fpm.p_id
                        FROM faction_player_matches fpm
                        LEFT JOIN player_ratings r ON fpm.p_id = r.player_id
                        WHERE 1=1
                    """
                    count_params = [f"%{faction}%", f"%{faction}%"]
                    if query:
                        count_sql += " AND (r.player_name ILIKE %s OR fpm.p_id = %s)"
                        count_params.extend([f"%{query}%", query])
                    count_sql += " GROUP BY fpm.p_id HAVING COUNT(*) >= %s ) SELECT COUNT(*) as total_count FROM qualifying_players;"
                    count_params.append(min_matches)

                    cursor.execute(count_sql, count_params)
                    total_count = cursor.fetchone()["total_count"] or 0

                    sql = """
                    WITH faction_player_matches AS (
                        SELECT 
                            player1_id as p_id,
                            player1_name as p_name,
                            match_date as m_date,
                            CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END as is_win,
                            CASE WHEN loser_id = player1_id THEN 1 ELSE 0 END as is_loss,
                            CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                        FROM matches
                        WHERE player1_id IS NOT NULL AND player1_id != '' AND is_done = TRUE
                          AND player1_faction ILIKE %s
                        UNION ALL
                        SELECT 
                            player2_id as p_id,
                            player2_name as p_name,
                            match_date as m_date,
                            CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END as is_win,
                            CASE WHEN loser_id = player2_id THEN 1 ELSE 0 END as is_loss,
                            CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                        FROM matches
                        WHERE player2_id IS NOT NULL AND player2_id != '' AND is_bye = FALSE AND is_done = TRUE
                          AND player2_faction ILIKE %s
                    )
                    SELECT 
                        fpm.p_id as player_id,
                        COALESCE(MAX(r.player_name), MAX(fpm.p_name), fpm.p_id) as player_name,
                        COALESCE(MAX(r.current_elo), 1500.0) as current_elo,
                        COALESCE(MAX(r.peak_elo), 1500.0) as peak_elo,
                        COUNT(*) as matches_played,
                        SUM(fpm.is_win) as wins,
                        SUM(fpm.is_loss) as losses,
                        SUM(fpm.is_draw) as draws,
                        ROUND((SUM(fpm.is_win) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate,
                        %s as top_faction,
                        COALESCE(MAX(r.team), '') as team,
                        MAX(fpm.m_date) as last_active_date,
                        CASE WHEN MAX(u.id) IS NOT NULL THEN TRUE ELSE FALSE END as has_account,
                        MAX(u.id) as account_user_id
                    FROM faction_player_matches fpm
                    LEFT JOIN player_ratings r ON fpm.p_id = r.player_id
                    LEFT JOIN users u ON (
                        (u.player_id IS NOT NULL AND u.player_id != '' AND u.player_id = fpm.p_id)
                        OR (u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND u.bcp_user_id = fpm.p_id)
                        OR u.id = fpm.p_id
                    )
                    WHERE 1=1
                    """
                    params = [f"%{faction}%", f"%{faction}%", faction]
                    if query:
                        sql += " AND (fpm.p_name ILIKE %s OR fpm.p_id = %s)"
                        params.extend([f"%{query}%", query])
                    sql += " GROUP BY fpm.p_id HAVING COUNT(*) >= %s"
                    params.append(min_matches)
                    sql += f" ORDER BY {col} {dir_str} NULLS LAST LIMIT %s OFFSET %s;"
                    params.extend([page_size, offset])
                    cursor.execute(sql, params)
                    rows = [dict(r) for r in cursor.fetchall()]

                    res = {
                        "items": rows,
                        "total": total_count,
                        "page": page,
                        "page_size": page_size,
                        "total_pages": max(1, (total_count + page_size - 1) // page_size)
                    }
                    PostgresDatabase.set_cached(PostgresDatabase._players_cache_dict, cache_key, res)
                    return res

                # Global player ratings directory
                where_clauses = ["r.matches_played >= %s"]
                params = [min_matches]
                if query:
                    where_clauses.append("(r.player_name ILIKE %s OR r.player_id = %s)")
                    params.extend([f"%{query}%", query])

                where_sql = "WHERE " + " AND ".join(where_clauses)
                
                cursor.execute(f"SELECT COUNT(*) as total_count FROM player_ratings r {where_sql};", params)
                total_count = cursor.fetchone()["total_count"] or 0

                sql = f"""
                SELECT r.player_id, r.player_name, r.current_elo, r.peak_elo,
                       r.matches_played, r.wins, r.losses, r.draws, r.win_rate,
                       r.top_faction, r.team, r.last_active_date,
                       CASE WHEN u.id IS NOT NULL THEN TRUE ELSE FALSE END as has_account,
                       u.id as account_user_id
                FROM player_ratings r
                LEFT JOIN users u ON (
                    (u.player_id IS NOT NULL AND u.player_id != '' AND u.player_id = r.player_id)
                    OR (u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND u.bcp_user_id = r.player_id)
                    OR u.id = r.player_id
                )
                {where_sql}
                ORDER BY r.{col} {dir_str} NULLS LAST
                LIMIT %s OFFSET %s;
                """
                params.extend([page_size, offset])
                cursor.execute(sql, params)
                rows = [dict(r) for r in cursor.fetchall()]

                res = {
                    "items": rows,
                    "total": total_count,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": max(1, (total_count + page_size - 1) // page_size)
                }
                PostgresDatabase.set_cached(PostgresDatabase._players_cache_dict, cache_key, res)
                return res

    def get_event_details(self, event_id: str) -> Dict[str, Any]:
        """Returns tournament details, participant roster with official BCP tiebreaker standings, and all round pairings."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                # 1. Event metadata
                cursor.execute("""
                SELECT id, name, event_date, end_date, city, state, country,
                       total_players, num_rounds, current_round, is_ended, raw_json,
                       COALESCE(started, false) as started,
                       COALESCE(pairings_status, 'draft') as pairings_status
                FROM events
                WHERE id = %s;
                """, (event_id,))
                event_row = cursor.fetchone()
                if not event_row:
                    return None
                res = dict(event_row)

                # 2. Match pairings with digital tracker game linkage
                cursor.execute("""
                SELECT m.id, m.event_id, m.round, m.table_number, m.match_date,
                       m.player1_id, m.player1_name, m.player1_faction, m.player1_score,
                       m.player2_id, m.player2_name, m.player2_faction, m.player2_score,
                       m.winner_id, m.loser_id, m.is_draw, m.is_bye, m.is_done,
                       (tg.match_id IS NOT NULL) as has_tracker_game,
                       COALESCE(tg.is_finished, FALSE) as tracker_is_done,
                       COALESCE(tg.started, FALSE) as tracker_started
                FROM matches m
                LEFT JOIN tracker_games tg 
                    ON tg.event_id = m.event_id 
                   AND tg.round_num = m.round 
                   AND tg.table_num = m.table_number
                WHERE m.event_id = %s
                ORDER BY m.round ASC, m.table_number ASC;
                """, (event_id,))
                matches = [dict(r) for r in cursor.fetchall()]

                # 3. Participants roster
                cursor.execute("""
                SELECT 
                    ep.player_id, 
                    COALESCE(pr.player_name, ep.full_name, 'Player') as full_name,
                    COALESCE(ep.faction, pr.top_faction, 'Unknown') as faction,
                    COALESCE(ep.team, pr.team, '') as team,
                    ep.dropped, ep.checked_in,
                    ep.placement, ep.pod_num,
                    COALESCE(pr.current_elo, 1500.0) as current_elo,
                    COALESCE(pr.peak_elo, 1500.0) as peak_elo,
                    COALESCE(pr.win_rate, 0.0) as global_win_rate
                FROM event_participants ep
                LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                WHERE ep.event_id = %s;
                """, (event_id,))
                participants = {r["player_id"]: dict(r) for r in cursor.fetchall()}

                # 4. Compute official Best Coast Pairings Swiss standings & tiebreakers
                player_stats = {}
                for m in matches:
                    p1_id = m.get("player1_id")
                    p2_id = m.get("player2_id")
                    p1_name = m.get("player1_name") or "Player 1"
                    p2_name = m.get("player2_name") or ("BYE" if m.get("is_bye") else "Player 2")
                    p1_fac = m.get("player1_faction") or "Unknown"
                    p2_fac = m.get("player2_faction") or "Unknown"
                    p1_score = m.get("player1_score") or 0
                    p2_score = m.get("player2_score") or 0
                    r_num = m.get("round", 1)

                    is_p1_win = m.get("winner_id") == p1_id or (m.get("winner_id") is None and p1_score > p2_score)
                    is_p2_win = m.get("winner_id") == p2_id or (m.get("winner_id") is None and p2_score > p1_score)
                    is_draw = m.get("is_draw") or (p1_score == p2_score and not is_p1_win and not is_p2_win)

                    if p1_id:
                        if p1_id not in player_stats:
                            p_info = participants.get(p1_id, {})
                            player_stats[p1_id] = {
                                "player_id": p1_id,
                                "full_name": p_info.get("full_name") or p1_name,
                                "faction": p_info.get("faction") or p1_fac,
                                "team": p_info.get("team") or "",
                                "dropped": p_info.get("dropped", False),
                                "checked_in": p_info.get("checked_in", True),
                                "pod_num": p_info.get("pod_num"),
                                "placement": p_info.get("placement"),
                                "official_placement": p_info.get("placement"),
                                "current_elo": p_info.get("current_elo", 1500.0),
                                "peak_elo": p_info.get("peak_elo", 1500.0),
                                "global_win_rate": p_info.get("global_win_rate", 0.0),
                                "event_wins": 0,
                                "event_losses": 0,
                                "event_draws": 0,
                                "event_matches_count": 0,
                                "event_battle_points": 0,
                                "event_mov": 0,
                                "round_wins": {},
                                "opponents": []
                            }
                        ps = player_stats[p1_id]
                        ps["event_matches_count"] += 1
                        ps["event_battle_points"] += p1_score
                        ps["event_mov"] += (p1_score - p2_score)
                        if is_p1_win:
                            ps["event_wins"] += 1
                            ps["round_wins"][r_num] = 1
                        elif is_draw:
                            ps["event_draws"] += 1
                            ps["round_wins"][r_num] = 0.5
                        else:
                            ps["event_losses"] += 1
                            ps["round_wins"][r_num] = 0
                        if p2_id and not m.get("is_bye") and p2_name != "BYE":
                            ps["opponents"].append(p2_id)

                    if p2_id and not m.get("is_bye") and p2_name != "BYE":
                        if p2_id not in player_stats:
                            p_info = participants.get(p2_id, {})
                            player_stats[p2_id] = {
                                "player_id": p2_id,
                                "full_name": p_info.get("full_name") or p2_name,
                                "faction": p_info.get("faction") or p2_fac,
                                "team": p_info.get("team") or "",
                                "dropped": p_info.get("dropped", False),
                                "checked_in": p_info.get("checked_in", True),
                                "pod_num": p_info.get("pod_num"),
                                "placement": p_info.get("placement"),
                                "official_placement": p_info.get("placement"),
                                "current_elo": p_info.get("current_elo", 1500.0),
                                "peak_elo": p_info.get("peak_elo", 1500.0),
                                "global_win_rate": p_info.get("global_win_rate", 0.0),
                                "event_wins": 0,
                                "event_losses": 0,
                                "event_draws": 0,
                                "event_matches_count": 0,
                                "event_battle_points": 0,
                                "event_mov": 0,
                                "round_wins": {},
                                "opponents": []
                            }
                        ps = player_stats[p2_id]
                        ps["event_matches_count"] += 1
                        ps["event_battle_points"] += p2_score
                        ps["event_mov"] += (p2_score - p1_score)
                        if is_p2_win:
                            ps["event_wins"] += 1
                            ps["round_wins"][r_num] = 1
                        elif is_draw:
                            ps["event_draws"] += 1
                            ps["round_wins"][r_num] = 0.5
                        else:
                            ps["event_losses"] += 1
                            ps["round_wins"][r_num] = 0
                        if p1_id:
                            ps["opponents"].append(p1_id)

                # Track existing player names to avoid alias ID duplicates
                existing_names = {ps["full_name"].strip().lower(): p_id for p_id, ps in player_stats.items() if ps["event_matches_count"] > 0 and ps["full_name"] not in ("Player", "Player 1", "Player 2", "BYE")}

                # Add any enrolled players who haven't played a round yet
                for p_id, p_info in participants.items():
                    name_norm = (p_info.get("full_name") or "").strip().lower()
                    if name_norm and name_norm in existing_names:
                        # Merge pod_num, team, placement, or faction if missing on the active match record
                        active_pid = existing_names[name_norm]
                        if player_stats[active_pid].get("pod_num") is None and p_info.get("pod_num") is not None:
                            player_stats[active_pid]["pod_num"] = p_info.get("pod_num")
                        if player_stats[active_pid].get("official_placement") is None and p_info.get("placement") is not None:
                            player_stats[active_pid]["official_placement"] = p_info.get("placement")
                            player_stats[active_pid]["placement"] = p_info.get("placement")
                        if not player_stats[active_pid].get("team") and p_info.get("team"):
                            player_stats[active_pid]["team"] = p_info.get("team")
                        continue

                    if p_id not in player_stats:
                        player_stats[p_id] = {
                            "player_id": p_id,
                            "full_name": p_info.get("full_name") or "Player",
                            "faction": p_info.get("faction") or "Unknown",
                            "team": p_info.get("team") or "",
                            "dropped": p_info.get("dropped", False),
                            "checked_in": p_info.get("checked_in", True),
                            "pod_num": p_info.get("pod_num"),
                            "placement": p_info.get("placement"),
                            "official_placement": p_info.get("placement"),
                            "current_elo": p_info.get("current_elo", 1500.0),
                            "peak_elo": p_info.get("peak_elo", 1500.0),
                            "global_win_rate": p_info.get("global_win_rate", 0.0),
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_matches_count": 0,
                            "event_battle_points": 0,
                            "event_mov": 0,
                            "round_wins": {},
                            "opponents": []
                        }

                # Determine total rounds in tournament
                max_rounds = res.get("num_rounds") or (max([m["round"] for m in matches]) if matches else 6)
                if max_rounds <= 0:
                    max_rounds = 6

                # Compute win%, Swiss Points, and Path to Victory (PTV)
                # In BCP Swiss, earlier losses are more impactful than later losses (2^(N-r))
                for p_id, ps in player_stats.items():
                    tot = ps["event_matches_count"]
                    ps["win_pct"] = (ps["event_wins"] + 0.5 * ps["event_draws"]) / max(1, tot)
                    ps["swiss_points"] = 3 * ps["event_wins"] + 1 * ps["event_draws"]
                    ptv = 0
                    for r, w in ps["round_wins"].items():
                        if w == 1:
                            shift = max(0, max_rounds - r)
                            ptv += (1 << shift)
                    ps["ptv"] = ptv

                # Compute Opponent Game Win % (SoS with 33% min) and Wins SoS
                for p_id, ps in player_stats.items():
                    opp_pcts = [max(0.33, player_stats[opp]["win_pct"]) for opp in ps["opponents"] if opp in player_stats]
                    ps["sos"] = sum(opp_pcts) / max(1, len(opp_pcts)) if opp_pcts else 0.0
                    opp_wins = [player_stats[opp]["event_wins"] for opp in ps["opponents"] if opp in player_stats]
                    ps["wins_sos"] = sum(opp_wins) / max(1, len(opp_wins)) if opp_wins else 0.0
                    opp_bps = [(player_stats[opp]["event_battle_points"] / max(1, player_stats[opp]["event_matches_count"])) for opp in ps["opponents"] if opp in player_stats]
                    ps["bp_sos"] = sum(opp_bps) / max(1, len(opp_bps)) if opp_bps else 0.0

                # Compute Extended Opponent Game Win %, Swiss SoS, Wins Ext SoS, and Battle Points Ext SoS
                for p_id, ps in player_stats.items():
                    opp_sos = [player_stats[opp]["sos"] for opp in ps["opponents"] if opp in player_stats]
                    ps["ext_sos"] = sum(opp_sos) / max(1, len(opp_sos)) if opp_sos else 0.0
                    opp_swiss = [player_stats[opp]["swiss_points"] for opp in ps["opponents"] if opp in player_stats]
                    ps["swiss_sos"] = sum(opp_swiss) / max(1, len(opp_swiss)) if opp_swiss else 0.0
                    opp_wins_sos = [player_stats[opp]["wins_sos"] for opp in ps["opponents"] if opp in player_stats]
                    ps["ext_wins_sos"] = sum(opp_wins_sos) / max(1, len(opp_wins_sos)) if opp_wins_sos else 0.0
                    opp_bp_sos = [player_stats[opp]["bp_sos"] for opp in ps["opponents"] if opp in player_stats]
                    ps["ext_bp_sos"] = sum(opp_bp_sos) / max(1, len(opp_bp_sos)) if opp_bp_sos else 0.0

                # Parse tournament specific placingMetrics from raw_json
                raw_meta = {}
                if res.get("raw_json"):
                    try:
                        raw_meta = res["raw_json"] if isinstance(res["raw_json"], dict) else json.loads(res["raw_json"])
                    except Exception:
                        raw_meta = {}
                placing_metrics = raw_meta.get("placingMetrics") or []
                active_metrics = [m for m in placing_metrics if isinstance(m, dict) and m.get("isOn")]

                # Check if this tournament uses Pods / Brackets (e.g. GW Warhammer Open / NOVA brackets)
                has_pods = any(p.get("pod_num") is not None and p.get("pod_num") > 0 for p in player_stats.values())
                # Check if this tournament has official BCP final placings / playoff bracket results
                has_official_placements = any(p.get("official_placement") is not None and p.get("official_placement") > 0 for p in player_stats.values())

                # Dynamically sort according to the tournament's specific placing configuration
                def get_standings_sort_key(p):
                    key_tuple = []
                    # 1. Primary: Official BCP Final Placings (playoff bracket tree, championship matches, head-to-head resolution)
                    if has_official_placements:
                        pl = p.get("official_placement")
                        pl_val = pl if (pl is not None and pl > 0) else 999999
                        key_tuple.append(-pl_val)

                    # 2. Secondary: Bracket Pods
                    if has_pods:
                        pod = p.get("pod_num")
                        pod_val = pod if (pod is not None and pod > 0) else 9999
                        # Lower pod_num comes first (Pod 1 > Pod 2 > Pod 3), so with reverse=True we negate pod_val
                        key_tuple.append(-pod_val)

                    if not active_metrics:
                        # Standard default ITC Swiss Tiebreakers:
                        # 1. Wins -> 2. PTV -> 3. SoS (Opp Win %) -> 4. Battle Points -> 5. Ext SoS -> 6. Current Elo
                        key_tuple.extend([
                            p["event_wins"] + 0.5 * p["event_draws"],
                            p["ptv"],
                            round(p["sos"], 4),
                            p["event_battle_points"],
                            round(p["ext_sos"], 4),
                            p["current_elo"]
                        ])
                        return tuple(key_tuple)
                    
                    for m in active_metrics:
                        k = m.get("key") or m.get("name", "")
                        neg = bool(m.get("negative", False))
                        val = 0
                        if k in ("numWins", "Wins", "wins"):
                            val = p["event_wins"] + 0.5 * p["event_draws"]
                        elif k in ("pathToVictory", "Path to Victory", "ptv"):
                            val = p["ptv"]
                        elif k in ("magic_match_percentage_sos", "Oppt. Game Win %", "match_win_percentage_sos", "sos"):
                            val = round(p["sos"], 4)
                        elif k in ("battlePoints", "Battle Points", "points"):
                            val = p["event_battle_points"]
                        elif k in ("extendedMagic_match_percentage_sos", "Extended Oppt. Game Win %", "extended_sos", "ext_sos"):
                            val = round(p["ext_sos"], 4)
                        elif k in ("marginOfVictory", "totalMoVVictoryPoints", "Margin of Victory", "mov"):
                            val = p["event_mov"]
                        elif k in ("numWinsSoS", "Wins SoS"):
                            val = round(p["wins_sos"], 4)
                        elif k in ("FFGBattlePointsSoS", "Battle Points SoS"):
                            val = round(p["bp_sos"], 4)
                        elif k in ("extendedNumWinsSoS", "Wins Extended SoS", "extended_wins_sos"):
                            val = round(p["ext_wins_sos"], 4)
                        elif k in ("extendedFFGBattlePointsSoS", "Battle Points Extended SoS", "extended_bp_sos"):
                            val = round(p["ext_bp_sos"], 4)
                        elif k in ("mfSwissPoints", "Swiss Points"):
                            val = p["swiss_points"]
                        elif k in ("mfStrengthOfSchedule", "Swiss SoS"):
                            val = round(p["swiss_sos"], 4)
                        else:
                            val = p.get(k, 0)
                        key_tuple.append(-val if neg else val)
                    key_tuple.append(p["current_elo"])
                    return tuple(key_tuple)

                sorted_roster = sorted(player_stats.values(), key=get_standings_sort_key, reverse=True)

                # Filter out 0-match phantom alias records if the player already played matches
                final_players = []
                seen_names = set()
                # 1. First keep all players who played matches
                for p in sorted_roster:
                    norm_name = (p.get("full_name") or "").strip().lower()
                    if p.get("event_matches_count", 0) > 0:
                        final_players.append(p)
                        if norm_name and norm_name not in ("player", "player 1", "player 2", "bye"):
                            seen_names.add(norm_name)
                # 2. Then keep genuine registered players who have not played a round yet
                for p in sorted_roster:
                    norm_name = (p.get("full_name") or "").strip().lower()
                    if p.get("event_matches_count", 0) == 0 and norm_name not in seen_names:
                        final_players.append(p)
                        if norm_name and norm_name not in ("player", "player 1", "player 2", "bye"):
                            seen_names.add(norm_name)

                for rank_idx, p in enumerate(final_players, 1):
                    p["placement"] = p.get("official_placement") or rank_idx

                res["players"] = final_players
                res["matches"] = matches
                res["total_players"] = res.get("total_players") or len(final_players)
                res["num_rounds"] = res.get("num_rounds") or (max([m["round"] for m in matches]) if matches else 0)
                if final_players:
                    elos = [float(p["current_elo"]) for p in final_players if p.get("current_elo") is not None]
                    if elos:
                        res["avg_field_elo"] = round(sum(elos) / len(elos), 1)
                        res["top_seed_elo"] = max(elos)
                return res

    def get_recommended_events(
        self,
        player_id: Optional[str] = None,
        query: Optional[str] = None,
        state: Optional[str] = None,
        city: Optional[str] = None,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        radius_miles: Optional[float] = None,
        limit: int = 25,
        sort_by: str = "date"
    ) -> Dict[str, Any]:
        """Returns personalized upcoming event recommendations with Haversine distance calculations, Average Field Elo, and capacity metrics."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                detected_state = None
                detected_city = None
                user_elo = None
                user_lat = lat
                user_lng = lng

                # City geocoding dictionary fallback
                KNOWN_CITIES = {
                    "san diego": (32.7157, -117.1611),
                    "temecula": (33.4936, -117.1484),
                    "los angeles": (34.0522, -118.2437),
                    "san francisco": (37.7749, -122.4194),
                    "san jose": (37.3382, -121.8863),
                    "sacramento": (38.5816, -121.4944),
                    "austin": (30.2672, -97.7431),
                    "dallas": (32.7767, -96.7970),
                    "houston": (29.7604, -95.3698),
                    "chicago": (41.8781, -87.6298),
                    "seattle": (47.6062, -122.3321),
                    "orlando": (28.5383, -81.3792),
                    "london": (51.5074, -0.1278)
                }

                if player_id:
                    # 1. Check explicit profile location first (set in Account Settings / LFG)
                    cursor.execute("""
                    SELECT p.latitude, p.longitude, p.city, p.state
                    FROM player_lfg_profiles p
                    WHERE p.player_id = %s
                    UNION ALL
                    SELECT p.latitude, p.longitude, p.city, p.state
                    FROM player_lfg_profiles p
                    JOIN users u ON u.id = p.player_id
                    WHERE u.player_id = %s
                    LIMIT 1;
                    """, (player_id, player_id))
                    lfg_row = cursor.fetchone()
                    if lfg_row and (lfg_row.get("city") or lfg_row.get("latitude") is not None):
                        detected_city = lfg_row.get("city")
                        detected_state = lfg_row.get("state")
                        if not user_lat and lfg_row.get("latitude") is not None:
                            user_lat = float(lfg_row["latitude"])
                            user_lng = float(lfg_row["longitude"])
                    else:
                        # 2. Fall back to tournament location inference only if explicit profile is missing
                        cursor.execute("""
                        SELECT e.state, e.city, COUNT(*) as cnt
                        FROM event_participants ep
                        JOIN events e ON ep.event_id = e.id
                        WHERE ep.player_id = %s 
                          AND e.state IS NOT NULL 
                          AND TRIM(e.state) != ''
                        GROUP BY e.state, e.city
                        ORDER BY cnt DESC, MAX(e.event_date) DESC
                        LIMIT 1;
                        """, (player_id,))
                        loc_row = cursor.fetchone()
                        if loc_row:
                            detected_state = loc_row.get("state")
                            detected_city = loc_row.get("city")
                            if not user_lat and detected_city and detected_city.strip().lower() in KNOWN_CITIES:
                                user_lat, user_lng = KNOWN_CITIES[detected_city.strip().lower()]

                    # Get user's current Elo
                    cursor.execute("SELECT current_elo FROM player_ratings WHERE player_id = %s;", (player_id,))
                    p_elo_row = cursor.fetchone()
                    if p_elo_row:
                        user_elo = float(p_elo_row.get("current_elo") or 1500.0)

                target_state = (state.strip() if state and state.strip() else detected_state)
                target_city = (city.strip() if city and city.strip() else detected_city)

                if not user_lat and target_city and target_city.strip().lower() in KNOWN_CITIES:
                    user_lat, user_lng = KNOWN_CITIES[target_city.strip().lower()]

                where_clauses = ["e.event_date >= CURRENT_DATE"]
                params = []

                if query and query.strip():
                    q_clean = f"%{query.strip()}%"
                    where_clauses.append("(e.name ILIKE %s OR e.city ILIKE %s OR e.state ILIKE %s OR e.country ILIKE %s)")
                    params.extend([q_clean, q_clean, q_clean, q_clean])

                if state and state.strip() and state.strip().lower() != "all":
                    where_clauses.append("LOWER(TRIM(e.state)) = LOWER(%s)")
                    params.append(state.strip())

                where_sql = " AND ".join(where_clauses)

                cursor.execute(f"""
                SELECT 
                    e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country,
                    e.total_players, e.num_rounds, e.current_round, e.is_ended,
                    COALESCE(e.raw_json->>'locationName', e.raw_json->>'gameStoreName', '') as venue_name,
                    COALESCE(e.raw_json->>'formatted_address', '') as full_address,
                    e.raw_json->'coordinate' as coordinate,
                    COALESCE(NULLIF(e.raw_json->>'numTickets', '')::int, NULLIF(e.raw_json->>'queryNumPlayers', '')::int, NULLIF(e.raw_json->>'maxPlayers', '')::int, NULLIF(e.raw_json->>'capacity', '')::int, e.total_players) as max_capacity,
                    (NULLIF(e.raw_json->>'numTickets', '') IS NOT NULL OR NULLIF(e.raw_json->>'queryNumPlayers', '') IS NOT NULL OR NULLIF(e.raw_json->>'maxPlayers', '') IS NOT NULL OR NULLIF(e.raw_json->>'capacity', '') IS NOT NULL) as has_ticket_cap,
                    COALESCE(NULLIF(e.raw_json->>'checkedInPlayers', '')::int, 0) as checked_in_players,
                    ROUND(AVG(pr.current_elo)::numeric, 1) as avg_field_elo,
                    MAX(pr.current_elo) as top_seed_elo,
                    COUNT(pr.player_id) as rated_players_count
                FROM events e
                LEFT JOIN event_participants ep ON e.id = ep.event_id
                LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                WHERE {where_sql}
                GROUP BY e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country, e.total_players, e.num_rounds, e.current_round, e.is_ended, e.raw_json;
                """, params)
                
                rows = [dict(r) for r in cursor.fetchall()]

                import math
                def haversine(lat1, lon1, lat2, lon2):
                    R = 3958.8
                    dLat = math.radians(lat2 - lat1)
                    dLon = math.radians(lon2 - lon1)
                    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon/2)**2
                    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

                now_dt = datetime.now(timezone.utc)
                for r in rows:
                    ev_date = r.get("event_date")
                    if ev_date:
                        if ev_date.tzinfo is None:
                            ev_date = ev_date.replace(tzinfo=timezone.utc)
                        delta_days = (ev_date.date() - now_dt.date()).days
                        if delta_days == 0:
                            r["time_label"] = "Today"
                        elif delta_days == 1:
                            r["time_label"] = "Tomorrow"
                        elif delta_days > 1:
                            r["time_label"] = f"In {delta_days} days"
                        elif delta_days < 0:
                            r["time_label"] = f"{abs(delta_days)} days ago"
                        else:
                            r["time_label"] = "Happening Now"
                    else:
                        r["time_label"] = "Upcoming"

                    enrolled = int(r.get("total_players") or 0)
                    has_ticket_cap = bool(r.get("has_ticket_cap"))
                    cap = int(r.get("max_capacity") or enrolled)
                    r["enrolled_count"] = enrolled
                    r["capacity_cap"] = cap
                    r["has_ticket_cap"] = has_ticket_cap

                    # Calculate Distance in Miles
                    dist_val = None
                    coord = r.get("coordinate")
                    ev_lat, ev_lng = None, None
                    if coord and isinstance(coord, list) and len(coord) == 2:
                        ev_lng, ev_lat = coord[0], coord[1]
                    elif r.get("city") and r.get("city").strip().lower() in KNOWN_CITIES:
                        ev_lat, ev_lng = KNOWN_CITIES[r.get("city").strip().lower()]

                    if user_lat and user_lng and ev_lat and ev_lng:
                        try:
                            dist_val = haversine(float(user_lat), float(user_lng), float(ev_lat), float(ev_lng))
                            r["distance_miles"] = round(dist_val, 1)
                        except Exception:
                            pass

                    # Tier strictly based on number of rounds: <=3 RTT/Local, 4-6 GT, >=7 Major
                    rounds = int(r.get("num_rounds") or 0)
                    if rounds == 0:
                        name_lower = (r.get("name") or "").lower()
                        if "major" in name_lower or "super major" in name_lower or "championship" in name_lower:
                            rounds = 7
                        elif "gt" in name_lower or "grand tournament" in name_lower or "open" in name_lower:
                            rounds = 5
                        else:
                            rounds = 3

                    if rounds >= 7:
                        r["tier"] = "Major"
                        r["tier_badge"] = "tier-S"
                    elif rounds >= 4:
                        r["tier"] = "Grand Tournament"
                        r["tier_badge"] = "tier-A"
                    else:
                        r["tier"] = "RTT / Local"
                        r["tier_badge"] = "tier-B"

                    # Field Average Elo & Compatibility Matching
                    avg_elo_val = float(r.get("avg_field_elo") or 1550.0)
                    r["avg_elo_display"] = round(avg_elo_val, 1)

                    if user_elo:
                        diff = avg_elo_val - user_elo
                        r["elo_diff"] = round(diff, 1)
                        if abs(diff) <= 60:
                            r["skill_match_label"] = "🎯 Prime Skill Match"
                            r["skill_match_badge"] = "badge-match-prime"
                        elif diff > 60 and diff <= 150:
                            r["skill_match_label"] = f"⚔️ Tough Field (+{round(diff)} Elo)"
                            r["skill_match_badge"] = "badge-match-hard"
                        elif diff > 150:
                            r["skill_match_label"] = f"🦈 Shark Tank (+{round(diff)} Elo)"
                            r["skill_match_badge"] = "badge-match-extreme"
                        else:
                            r["skill_match_label"] = f"🏆 Favorable Match ({round(diff)} Elo)"
                            r["skill_match_badge"] = "badge-match-favorable"
                    else:
                        if avg_elo_val >= 1650:
                            r["skill_match_label"] = "⚔️ High Competitive Tier"
                            r["skill_match_badge"] = "badge-match-hard"
                        elif avg_elo_val >= 1520:
                            r["skill_match_label"] = "⚖️ Standard Competitive"
                            r["skill_match_badge"] = "badge-match-prime"
                        else:
                            r["skill_match_label"] = "🟢 Open / Casual Friendly"
                            r["skill_match_badge"] = "badge-match-favorable"

                    r["is_nearby"] = bool((dist_val is not None and dist_val <= 60) or (target_state and r.get("state") and r.get("state").strip().lower() == target_state.strip().lower()))
                    r["bcp_url"] = f"https://www.bestcoastpairings.com/event/{r['id']}"

                # Filter by radius if requested
                if radius_miles and user_lat:
                    rows = [r for r in rows if r.get("distance_miles") is not None and r["distance_miles"] <= radius_miles]

                # Sort events based on selected sort_by mode (date soonest by default, distance, or elo)
                def sort_key(e):
                    dt = e.get("event_date")
                    dt_ts = dt.timestamp() if dt else 9999999999.0
                    d = e.get("distance_miles")
                    d_score = d if d is not None else 99999.0
                    if sort_by == "distance":
                        return (d_score, dt_ts)
                    elif sort_by == "elo":
                        elo = float(e.get("avg_elo_display") or 0.0)
                        return (-elo, dt_ts, d_score)
                    else:  # "date" (soonest first)
                        return (dt_ts, d_score)

                sorted_events = sorted(rows, key=sort_key)

                return {
                    "detected_state": detected_state,
                    "detected_city": detected_city,
                    "target_state": target_state,
                    "user_elo": user_elo,
                    "user_lat": user_lat,
                    "user_lng": user_lng,
                    "events": sorted_events[:limit],
                    "total": len(sorted_events)
                }

    def get_events_field_stats(self, event_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Returns computed average Elo, top seed Elo, and rated player count for a list of event IDs based on enrolled participants."""
        if not event_ids:
            return {}
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT 
                    ep.event_id,
                    ROUND(AVG(COALESCE(pr.current_elo, 1500.0))::numeric, 1) as avg_field_elo,
                    MAX(COALESCE(pr.current_elo, 1500.0)) as top_seed_elo,
                    COUNT(DISTINCT ep.player_id) as total_enrolled,
                    COUNT(DISTINCT CASE WHEN pr.player_id IS NOT NULL THEN ep.player_id ELSE NULL END) as rated_players_count
                FROM event_participants ep
                LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                WHERE ep.event_id = ANY(%s)
                GROUP BY ep.event_id;
                """, (event_ids,))
                rows = cursor.fetchall()
                return {r["event_id"]: dict(r) for r in rows}

    def get_events_list(self, page=1, page_size=25, limit=None, query=None, status=None, sort_by="event_date", order="DESC") -> Dict[str, Any]:
        """Returns paginated tournaments list with match counts."""
        if limit is not None and limit > 0:
            page_size = limit
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 25), 200))
        offset = (page - 1) * page_size

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                where_clauses = ["1=1"]
                params: List[Any] = []

                if query:
                    where_clauses.append("(e.name ILIKE %s OR e.city ILIKE %s OR e.state ILIKE %s OR e.country ILIKE %s)")
                    params.extend([f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%"])

                where_sql = " AND ".join(where_clauses)
                dir_str = "ASC" if str(order).upper() == "ASC" else "DESC"

                # Count total
                cursor.execute(f"SELECT COUNT(*) as total_count FROM events e WHERE {where_sql};", params)
                total_count = cursor.fetchone()["total_count"] or 0

                allowed_cols = {
                    "name": "e.name",
                    "event_date": "e.event_date",
                    "location": "e.city",
                    "total_players": "e.total_players",
                    "num_rounds": "e.num_rounds",
                    "match_count": "e.total_players"
                }
                col = allowed_cols.get(sort_by, "e.event_date")
                pe_col = col.replace("e.", "pe.")

                sql = f"""
                WITH page_events AS (
                    SELECT e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country,
                           e.total_players, e.num_rounds, e.current_round, e.is_ended
                    FROM events e
                    WHERE {where_sql}
                    ORDER BY {col} {dir_str} NULLS LAST
                    LIMIT %s OFFSET %s
                )
                SELECT pe.*, COALESCE(mc.cnt, 0) as match_count
                FROM page_events pe
                LEFT JOIN (
                    SELECT event_id, COUNT(*) as cnt
                    FROM matches
                    WHERE event_id IN (SELECT id FROM page_events)
                    GROUP BY event_id
                ) mc ON pe.id = mc.event_id
                ORDER BY {pe_col} {dir_str} NULLS LAST;
                """
                params.extend([page_size, offset])

                cursor.execute(sql, params)
                rows = [dict(r) for r in cursor.fetchall()]

                return {
                    "items": rows,
                    "total": total_count,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": max(1, (total_count + page_size - 1) // page_size)
                }

    def _get_all_teams_list(self) -> List[Dict[str, Any]]:
        """Precomputes and caches all competitive teams in memory for instant filtering and search."""
        now = time.time()
        if PostgresDatabase._all_teams_cache is not None and (now - PostgresDatabase._all_teams_cache_time) < 600:
            return PostgresDatabase._all_teams_cache

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                sql = """
                WITH team_members AS (
                    SELECT 
                        TRIM(team) as team_name,
                        player_id,
                        COALESCE(player_name, 'Player') as player_name,
                        COALESCE(current_elo, 1500.0) as current_elo,
                        COALESCE(wins, 0) as wins,
                        COALESCE(losses, 0) as losses,
                        COALESCE(draws, 0) as draws,
                        COALESCE(matches_played, 0) as matches_played
                    FROM player_ratings
                    WHERE team IS NOT NULL AND TRIM(team) != '' AND LOWER(TRIM(team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null')
                )
                SELECT 
                    tm.team_name as team,
                    COUNT(DISTINCT tm.player_id) as roster_count,
                    ROUND(AVG(tm.current_elo)::numeric, 1) as avg_elo,
                    ROUND(MAX(tm.current_elo)::numeric, 1) as top_player_elo,
                    (ARRAY_AGG(tm.player_name ORDER BY tm.current_elo DESC))[1] as top_player_name,
                    (ARRAY_AGG(tm.player_id ORDER BY tm.current_elo DESC))[1] as top_player_id,
                    SUM(tm.wins) as total_wins,
                    SUM(tm.losses) as total_losses,
                    SUM(tm.draws) as total_draws,
                    SUM(tm.matches_played) as total_matches,
                    ROUND((SUM(tm.wins) * 100.0 / NULLIF(SUM(tm.matches_played), 0))::numeric, 1) as team_win_rate,
                    ROUND((
                        -- 1. Skill Baseline: 65% Roster Mean + 35% Top Ace
                        (0.65 * AVG(tm.current_elo) + 0.35 * MAX(tm.current_elo))
                        *
                        -- 2. Bayesian Win Dominance Performance Multiplier (0.65 + 0.70 * P_adj)
                        (
                            0.65 + 0.70 * (
                                (SUM(tm.wins)::numeric + (0.5 * SUM(tm.draws)::numeric) + 15.0)
                                /
                                (GREATEST(1.0, SUM(tm.matches_played)::numeric) + 30.0)
                            )
                        )
                        +
                        -- 3. Match Volume Consistency Bonus (40 * log10(N/25 + 1))
                        (40.0 * LOG( (GREATEST(0.0, SUM(tm.matches_played)::numeric) / 25.0) + 1.0 ))
                    )::numeric, 1) as power_rating,
                    CASE WHEN COUNT(DISTINCT tm.player_id) >= 5 AND SUM(tm.matches_played) >= 25 THEN TRUE ELSE FALSE END as is_qualified
                FROM team_members tm
                GROUP BY tm.team_name
                HAVING COUNT(DISTINCT tm.player_id) >= 1
                ORDER BY power_rating DESC;
                """
                cursor.execute(sql)
                rows = [dict(r) for r in cursor.fetchall()]
                PostgresDatabase._all_teams_cache = rows
                PostgresDatabase._all_teams_cache_time = now
                return rows

    def get_teams_leaderboard(self, page=1, page_size=25, min_members=5, limit=None, query=None, sort_by="power_rating", order="DESC") -> Dict[str, Any]:
        """Returns paginated power rankings of teams & gaming clubs (instant sub-millisecond in-memory)."""
        if limit is not None and limit > 0:
            page_size = limit
        page = max(1, int(page or 1))
        page_size = max(1, min(int(page_size or 25), 200))
        offset = (page - 1) * page_size

        all_teams = self._get_all_teams_list()

        filtered = list(all_teams)
        min_roster = int(min_members or 1)
        if min_roster > 1:
            filtered = [t for t in filtered if int(t.get("roster_count") or 0) >= min_roster]

        if query:
            q = query.strip().lower()
            filtered = [t for t in filtered if q in str(t.get("team") or "").lower()]

        # Sort
        reverse = (str(order).upper() == "DESC")
        sort_by_col = sort_by or "power_rating"
        
        if sort_by_col == "team":
            filtered = sorted(filtered, key=lambda x: str(x.get("team") or "").lower(), reverse=not reverse)
        elif sort_by_col in ("roster_count", "total_matches", "total_wins", "total_losses", "total_draws"):
            filtered = sorted(filtered, key=lambda x: (int(x.get(sort_by_col) or 0), float(x.get("power_rating") or 0)), reverse=reverse)
        else:
            filtered = sorted(filtered, key=lambda x: (float(x.get(sort_by_col) or 0), int(x.get("roster_count") or 0)), reverse=reverse)

        total_count = len(filtered)
        items = filtered[offset : offset + page_size]

        return {
            "items": items,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total_count + page_size - 1) // page_size)
        }

    def get_team_roster(self, team_name: str) -> Dict[str, Any]:
        """Returns full member roster and historical tournament record for a specific team (instant cached)."""
        team_name = team_name.strip()
        cache_key = team_name.lower()
        cached = PostgresDatabase.get_cached(PostgresDatabase._team_roster_cache_dict, cache_key, ttl=180)
        if cached:
            return cached

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT 
                    player_id, 
                    COALESCE(player_name, 'Player') as player_name,
                    COALESCE(current_elo, 1500.0) as current_elo,
                    COALESCE(peak_elo, 1500.0) as peak_elo,
                    COALESCE(top_faction, 'Unknown') as top_faction,
                    COALESCE(matches_played, 0) as matches_played,
                    COALESCE(wins, 0) as wins,
                    COALESCE(losses, 0) as losses,
                    COALESCE(draws, 0) as draws,
                    COALESCE(win_rate, 0.0) as win_rate,
                    COALESCE(last_active_date, CURRENT_DATE) as last_active_date
                FROM player_ratings
                WHERE TRIM(team) ILIKE %s
                ORDER BY current_elo DESC NULLS LAST;
                """, (team_name,))
                roster = [dict(r) for r in cursor.fetchall()]
                if not roster:
                    res = {"team": team_name, "roster": [], "stats": {}}
                    PostgresDatabase.set_cached(PostgresDatabase._team_roster_cache_dict, cache_key, res)
                    return res

                total_matches = sum(p["matches_played"] or 0 for p in roster)
                total_wins = sum(p["wins"] or 0 for p in roster)
                total_losses = sum(p["losses"] or 0 for p in roster)
                total_draws = sum(p.get("draws", 0) or 0 for p in roster)
                avg_elo = round(sum(p["current_elo"] for p in roster) / len(roster), 1)
                top_elo = roster[0]["current_elo"] if roster else 1500.0
                win_rate = round((total_wins / total_matches) * 100.0, 1) if total_matches > 0 else 0.0
                
                # Power Rating Algorithm (Option 1)
                skill_baseline = (0.65 * avg_elo) + (0.35 * top_elo)
                p_adj = (total_wins + 0.5 * total_draws + 15.0) / (max(1, total_matches) + 30.0)
                perf_multiplier = 0.65 + (0.70 * p_adj)
                volume_bonus = 40.0 * math.log10((total_matches / 25.0) + 1.0)
                
                power_rating = round((skill_baseline * perf_multiplier) + volume_bonus, 1)

                res = {
                    "team": team_name,
                    "roster": roster,
                    "stats": {
                        "roster_count": len(roster),
                        "power_rating": power_rating,
                        "avg_elo": avg_elo,
                        "top_player_elo": round(top_elo, 1),
                        "total_matches": total_matches,
                        "total_wins": total_wins,
                        "total_losses": total_losses,
                        "total_draws": total_draws,
                        "win_rate": win_rate,
                        "is_qualified": (len(roster) >= 5 and total_matches >= 25)
                    }
                }
                PostgresDatabase.set_cached(PostgresDatabase._team_roster_cache_dict, cache_key, res)
                return res

    def get_faction_meta_stats(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Returns overall faction balance metrics, timeline trends, and tier ratings (instant cached)."""
        cache_key = f"{start_date}_{end_date}"
        cached = PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, cache_key, ttl=3600)
        if cached:
            return cached

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                where_clauses = ["is_done = TRUE"]
                params: List[Any] = []
                if start_date:
                    where_clauses.append("match_date >= %s")
                    params.append(start_date)
                if end_date:
                    where_clauses.append("match_date <= %s")
                    params.append(end_date)
                
                date_filter_sql = " AND ".join(where_clauses)

                cursor.execute(f"""
                WITH match_sides AS (
                    SELECT id, match_date, player1_faction as faction, player1_score as score,
                           CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END as is_win,
                           CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw,
                           CASE WHEN loser_id = player1_id THEN 1 ELSE 0 END as is_loss
                    FROM matches
                    WHERE player1_faction IS NOT NULL AND TRIM(player1_faction) != '' AND player1_faction != 'Unknown Faction' AND {date_filter_sql}
                    UNION ALL
                    SELECT id, match_date, player2_faction as faction, player2_score as score,
                           CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END as is_win,
                           CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw,
                           CASE WHEN loser_id = player2_id THEN 1 ELSE 0 END as is_loss
                    FROM matches
                    WHERE player2_faction IS NOT NULL AND TRIM(player2_faction) != '' AND player2_faction != 'Unknown Faction' AND is_bye = FALSE AND player2_id IS NOT NULL AND {date_filter_sql}
                )
                SELECT 
                    faction,
                    COUNT(*) as total_matches,
                    SUM(is_win) as wins,
                    SUM(is_loss) as losses,
                    SUM(is_draw) as draws,
                    COALESCE(ROUND((SUM(is_win) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1), 0.0) as win_rate,
                    COALESCE(ROUND(AVG(score)::numeric, 1), 0.0) as avg_score
                FROM match_sides
                GROUP BY faction
                HAVING COUNT(*) >= 1
                ORDER BY win_rate DESC, total_matches DESC;
                """, params + params)
                overall = [dict(r) for r in cursor.fetchall()]

                for f in overall:
                    wr = float(f.get("win_rate") or 0.0)
                    if wr >= 55.0:
                        f["tier"] = "S"
                        f["tier_label"] = "Overperforming (55%+)"
                    elif wr >= 50.0:
                        f["tier"] = "A"
                        f["tier_label"] = "Balanced High (50-55%)"
                    elif wr >= 45.0:
                        f["tier"] = "B"
                        f["tier_label"] = "Balanced Low (45-50%)"
                    else:
                        f["tier"] = "C"
                        f["tier_label"] = "Underperforming (<45%)"

                # Dynamic timeline trends reflecting the exact chosen timeframe
                is_short_window = False
                if start_date and end_date:
                    try:
                        d1 = datetime.fromisoformat(start_date[:10])
                        d2 = datetime.fromisoformat(end_date[:10])
                        if (d2 - d1).days <= 75:
                            is_short_window = True
                    except Exception:
                        pass
                elif start_date:
                    is_short_window = True

                period_format = "YYYY-MM-DD" if is_short_window else "YYYY-MM"
                period_trunc = "week" if is_short_window else "month"

                trend_where_clauses = ["is_done = TRUE", "match_date IS NOT NULL"]
                trend_params: List[Any] = []
                if start_date:
                    trend_where_clauses.append("match_date >= %s")
                    trend_params.append(start_date)
                if end_date:
                    trend_where_clauses.append("match_date <= %s")
                    trend_params.append(end_date)
                if not start_date and not end_date:
                    trend_where_clauses.append("match_date >= (CURRENT_DATE - INTERVAL '18 months')")

                trend_filter_sql = " AND ".join(trend_where_clauses)

                cursor.execute(f"""
                WITH monthly_sides AS (
                    SELECT TO_CHAR(DATE_TRUNC('{period_trunc}', match_date), '{period_format}') as month,
                           player1_faction as faction,
                           CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END as is_win
                    FROM matches
                    WHERE player1_faction IS NOT NULL AND TRIM(player1_faction) != '' 
                      AND player1_faction != 'Unknown Faction' AND {trend_filter_sql}
                    UNION ALL
                    SELECT TO_CHAR(DATE_TRUNC('{period_trunc}', match_date), '{period_format}') as month,
                           player2_faction as faction,
                           CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END as is_win
                    FROM matches
                    WHERE player2_faction IS NOT NULL AND TRIM(player2_faction) != '' 
                      AND player2_faction != 'Unknown Faction' AND is_bye = FALSE AND player2_id IS NOT NULL AND {trend_filter_sql}
                )
                SELECT 
                    month,
                    faction,
                    COUNT(*) as matches_in_month,
                    SUM(is_win) as wins,
                    ROUND((SUM(is_win) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate
                FROM monthly_sides
                GROUP BY month, faction
                HAVING COUNT(*) >= 2
                ORDER BY month ASC, win_rate DESC;
                """, trend_params + trend_params)
                monthly = [dict(r) for r in cursor.fetchall()]

                res = {
                    "factions": overall,
                    "monthly_trends": monthly,
                    "total_factions_tracked": len(overall),
                    "filter": {
                        "start_date": start_date,
                        "end_date": end_date,
                        "is_short_window": is_short_window,
                        "granularity": "Weekly" if is_short_window else "Monthly"
                    }
                }
                PostgresDatabase.set_cached(PostgresDatabase._faction_meta_cache_dict, cache_key, res)
                return res


    def get_player_history(self, player_id: str) -> List[Dict[str, Any]]:
        """Returns rating progression history for a player."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT h.*, e.name as event_name
                FROM rating_history h
                LEFT JOIN events e ON h.event_id = e.id
                WHERE h.player_id = %s
                ORDER BY h.match_date ASC, h.round ASC;
                """, (player_id,))
                return [dict(r) for r in cursor.fetchall()]

    def get_player_matches(self, player_id: str) -> List[Dict[str, Any]]:
        """Returns all matches for a specific player."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT m.*, e.name as event_name
                FROM matches m
                LEFT JOIN events e ON m.event_id = e.id
                WHERE m.player1_id = %s OR m.player2_id = %s
                ORDER BY COALESCE(m.match_date, e.event_date) ASC, m.round ASC;
                """, (player_id, player_id))
                return [dict(r) for r in cursor.fetchall()]

    def search_players(self, query: str, limit: int = 25) -> List[Dict[str, Any]]:
        """Searches players for prediction autocomplete."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT player_id, player_name, current_elo, peak_elo, matches_played, wins, losses, draws, win_rate, top_faction
                FROM player_ratings
                WHERE player_name ILIKE %s OR player_id = %s
                ORDER BY matches_played DESC, current_elo DESC
                LIMIT %s;
                """, (f"%{query}%", query, limit))
                return [dict(r) for r in cursor.fetchall()]

    def get_head_to_head(self, p1_id: str, p2_id: str) -> List[Dict[str, Any]]:
        """Returns past head-to-head encounters strictly between the two unique player IDs."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                # 1. Resolve player IDs if names were passed
                cursor.execute("SELECT player_id FROM player_ratings WHERE player_id = %s OR player_name ILIKE %s LIMIT 1;", (p1_id, p1_id))
                p1_row = cursor.fetchone()
                p1_real_id = p1_row["player_id"] if p1_row else p1_id

                cursor.execute("SELECT player_id FROM player_ratings WHERE player_id = %s OR player_name ILIKE %s LIMIT 1;", (p2_id, p2_id))
                p2_row = cursor.fetchone()
                p2_real_id = p2_row["player_id"] if p2_row else p2_id

                # 2. Strict ID-based match query
                cursor.execute("""
                SELECT m.*, COALESCE(e.name, 'Tournament') as event_name, COALESCE(m.match_date, e.event_date) as match_date
                FROM matches m
                LEFT JOIN events e ON m.event_id = e.id
                WHERE (
                    (m.player1_id = %s AND m.player2_id = %s)
                    OR (m.player1_id = %s AND m.player2_id = %s)
                )
                AND m.is_done = TRUE
                ORDER BY COALESCE(m.match_date, e.event_date) DESC;
                """, (p1_real_id, p2_real_id, p2_real_id, p1_real_id))
                return [dict(r) for r in cursor.fetchall()]



    def get_faction_details(self, faction_name: str, limit: int = 100) -> Dict[str, Any]:
        """Returns pure match-level faction analytics, top pilots strictly for this faction, and matchups."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                # 1. Pure Match-Level Commander Records strictly for games played WITH this faction
                cursor.execute("""
                WITH faction_player_games AS (
                    SELECT 
                        player1_id as p_id,
                        player1_name as p_name,
                        player1_score as score,
                        CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END as is_win,
                        CASE WHEN loser_id = player1_id THEN 1 ELSE 0 END as is_loss,
                        CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                    FROM matches
                    WHERE player1_faction ILIKE %s AND player1_id IS NOT NULL AND is_done = TRUE
                    UNION ALL
                    SELECT 
                        player2_id as p_id,
                        player2_name as p_name,
                        player2_score as score,
                        CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END as is_win,
                        CASE WHEN loser_id = player2_id THEN 1 ELSE 0 END as is_loss,
                        CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                    FROM matches
                    WHERE player2_faction ILIKE %s AND player2_id IS NOT NULL AND is_bye = FALSE AND is_done = TRUE
                )
                SELECT 
                    fpg.p_id as player_id,
                    COALESCE(MAX(fpg.p_name), 'Player') as player_name,
                    COALESCE(MAX(r.team), '') as team,
                    COALESCE(MAX(r.current_elo), 1500.0) as current_elo,
                    COUNT(*) as matches_played,
                    SUM(fpg.is_win) as wins,
                    SUM(fpg.is_loss) as losses,
                    SUM(fpg.is_draw) as draws,
                    ROUND((SUM(fpg.is_win) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate,
                    ROUND(AVG(fpg.score)::numeric, 1) as avg_score
                FROM faction_player_games fpg
                LEFT JOIN player_ratings r ON fpg.p_id = r.player_id
                GROUP BY fpg.p_id
                HAVING COUNT(*) >= 1
                ORDER BY wins DESC, matches_played DESC, current_elo DESC
                LIMIT 25;
                """, (f"%{faction_name}%", f"%{faction_name}%"))
                top_players = [dict(r) for r in cursor.fetchall()]

                # 2. Recent matches involving this faction
                cursor.execute("""
                SELECT m.id, m.event_id, e.name as event_name, m.round, m.table_number, m.match_date,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player1_id ELSE m.player2_id END as player_id,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player1_name ELSE m.player2_name END as player_name,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player1_faction ELSE m.player2_faction END as player_faction,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player1_score ELSE m.player2_score END as player_score,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player2_id ELSE m.player1_id END as opponent_id,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player2_name ELSE m.player1_name END as opponent_name,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player2_faction ELSE m.player1_faction END as opponent_faction,
                       CASE WHEN m.player1_faction ILIKE %s THEN m.player2_score ELSE m.player1_score END as opponent_score,
                       CASE 
                           WHEN m.is_draw THEN 'D'
                           WHEN (m.winner_id = m.player1_id AND m.player1_faction ILIKE %s) OR (m.winner_id = m.player2_id AND m.player2_faction ILIKE %s) THEN 'W'
                           ELSE 'L'
                       END as outcome
                FROM matches m
                LEFT JOIN events e ON m.event_id = e.id
                WHERE (m.player1_faction ILIKE %s OR m.player2_faction ILIKE %s)
                  AND m.is_done = TRUE
                ORDER BY COALESCE(m.match_date, e.event_date) DESC, m.round DESC
                LIMIT %s;
                """, (
                    f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%",
                    f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%",
                    f"%{faction_name}%", f"%{faction_name}%",
                    f"%{faction_name}%", f"%{faction_name}%",
                    limit
                ))
                recent_matches = [dict(r) for r in cursor.fetchall()]

                # 3. Matchup win rates against other factions (Excluding Mirrors)
                cursor.execute("""
                WITH faction_games AS (
                    SELECT 
                        player2_faction as opp_faction,
                        CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END as is_win,
                        CASE WHEN loser_id = player1_id THEN 1 ELSE 0 END as is_loss,
                        CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                    FROM matches
                    WHERE player1_faction ILIKE %s AND player2_faction IS NOT NULL AND player2_faction != '' 
                      AND player2_faction != 'Unknown Faction' AND NOT (player2_faction ILIKE %s)
                    UNION ALL
                    SELECT 
                        player1_faction as opp_faction,
                        CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END as is_win,
                        CASE WHEN loser_id = player2_id THEN 1 ELSE 0 END as is_loss,
                        CASE WHEN is_draw THEN 1 ELSE 0 END as is_draw
                    FROM matches
                    WHERE player2_faction ILIKE %s AND player1_faction IS NOT NULL AND player1_faction != '' 
                      AND player1_faction != 'Unknown Faction' AND is_bye = FALSE AND NOT (player1_faction ILIKE %s)
                )
                SELECT 
                    opp_faction as opponent_faction,
                    COUNT(*) as total_matches,
                    SUM(is_win) as wins,
                    SUM(is_loss) as losses,
                    SUM(is_draw) as draws,
                    ROUND((SUM(is_win) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1) as win_rate
                FROM faction_games
                GROUP BY opp_faction
                HAVING COUNT(*) >= 1
                ORDER BY win_rate DESC, total_matches DESC
                LIMIT 35;
                """, (f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%", f"%{faction_name}%"))
                matchups = [dict(r) for r in cursor.fetchall()]

                # Summary metrics
                total_m = len(recent_matches)
                total_w = sum(1 for m in recent_matches if m.get("outcome") == "W")
                total_l = sum(1 for m in recent_matches if m.get("outcome") == "L")
                total_d = sum(1 for m in recent_matches if m.get("outcome") == "D")

                return {
                    "faction": faction_name,
                    "stats": {
                        "total_recent_sample": total_m,
                        "recent_wins": total_w,
                        "recent_losses": total_l,
                        "recent_draws": total_d,
                        "top_player_count": len(top_players)
                    },
                    "top_players": top_players,
                    "matches": recent_matches,
                    "matchups": matchups
                }

    def save_tracker_game(
        self,
        match_id: str,
        state: Dict[str, Any],
        version: int = 1,
        user_id_p1: Optional[str] = None,
        user_id_p2: Optional[str] = None,
        referee_ids: Optional[List[str]] = None
    ) -> bool:
        """Persists or updates a live multiplayer tracker game in PostgreSQL with user ownership and roles."""
        if not match_id or not state:
            return False
        
        match_id = match_id.strip().upper()
        game_data = state.get("game", {}) if isinstance(state.get("game"), dict) else state
        
        p1_name = game_data.get("p1Name") or state.get("p1Name") or "Player 1"
        p1_faction = game_data.get("p1Faction") or state.get("p1Faction") or ""
        p1_dets = game_data.get("p1Detachments") or []
        p1_detachment = (p1_dets[0] if isinstance(p1_dets, list) and p1_dets else str(p1_dets)) or state.get("p1Detachment") or ""
        
        p2_name = game_data.get("p2Name") or state.get("p2Name") or "Player 2"
        p2_faction = game_data.get("p2Faction") or state.get("p2Faction") or ""
        p2_dets = game_data.get("p2Detachments") or []
        p2_detachment = (p2_dets[0] if isinstance(p2_dets, list) and p2_dets else str(p2_dets)) or state.get("p2Detachment") or ""
        
        uid_p1 = user_id_p1 or state.get("user_id_p1") or game_data.get("user_id_p1")
        uid_p2 = user_id_p2 or state.get("user_id_p2") or game_data.get("user_id_p2")
        refs = referee_ids if referee_ids is not None else state.get("referee_ids", [])
        
        primary_mission = game_data.get("primary") or game_data.get("p1Primary") or state.get("primaryMission") or "Take & Hold"
        deployment = game_data.get("deployment") or game_data.get("terrainLayout") or state.get("deployment") or "Search & Destroy"
        mission_rule = game_data.get("missionRule") or state.get("missionRule") or "Swift Action"
        current_round = int(state.get("round") or state.get("currentRound") or 1)
        started = bool(state.get("started"))
        
        def calc_vp(p_obj):
            if not isinstance(p_obj, dict):
                return 0
            
            rounds = [r for r in p_obj.get("rounds", []) if isinstance(r, dict)]
            pri_total = min(50, sum([r.get("primaryScore", 0) for r in rounds]))
            
            sec_total = 0
            hand = p_obj.get("hand", [])
            if isinstance(hand, list):
                for card in hand:
                    if not isinstance(card, dict) or card.get("status") == "discarded":
                        continue
                    if card.get("recurring"):
                        round_scores = card.get("roundScores", {})
                        if isinstance(round_scores, dict):
                            for r_data in round_scores.values():
                                if isinstance(r_data, dict):
                                    sec_total += int(r_data.get("points") or 0)
                                elif isinstance(r_data, (int, float)):
                                    sec_total += int(r_data)
                    else:
                        if card.get("scoredRound") is not None:
                            sec_total += int(card.get("points") or 0)
            
            if sec_total == 0:
                sec_total = sum([r.get("secondaryScore", 0) for r in rounds])
            
            sec_total = min(40, sec_total)
            paint = 10 if p_obj.get("battleReady", True) is not False else 0
            return min(100, pri_total + sec_total + paint)

        p1_score = calc_vp(state.get("p1"))
        p2_score = calc_vp(state.get("p2"))
        if p1_score == 0 and "p1Score" in state:
            p1_score = int(state["p1Score"])
        if p2_score == 0 and "p2Score" in state:
            p2_score = int(state["p2Score"])

        is_finished = bool(state.get("is_finished") or state.get("isFinished") or (current_round >= 5 and started))

        winner_name = None
        if is_finished:
            if p1_score > p2_score:
                winner_name = p1_name
            elif p2_score > p1_score:
                winner_name = p2_name
            else:
                winner_name = "Tied"

        event_id = state.get("event_id") or game_data.get("eventId") or state.get("eventId")
        round_num = int(state.get("round_num") or game_data.get("roundNum") or current_round or 1)
        table_num = int(state.get("table_num") or game_data.get("tableNum") or 0) if (state.get("table_num") or game_data.get("tableNum")) else None
        first_turn = game_data.get("firstTurn") or state.get("firstTurn") or state.get("who_went_first")
        who_went_first = p1_name if (first_turn in (1, "1", "player1", "p1", p1_name)) else (p2_name if (first_turn in (2, "2", "player2", "p2", p2_name)) else None)
        bcp_submitted = bool(state.get("bcp_submitted") or state.get("bcpSubmitted"))

        refs_list = list(refs) if isinstance(refs, (list, tuple)) else []
        refs_sql = "{" + ",".join([f'"{r}"' for r in refs_list]) + "}"

        def do_insert():
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                    INSERT INTO tracker_games (
                        match_id, p1_name, p1_faction, p1_detachment, p1_score,
                        p2_name, p2_faction, p2_detachment, p2_score,
                        user_id_p1, user_id_p2, referee_ids,
                        primary_mission, deployment, mission_rule,
                        current_round, started, is_finished, winner_name,
                        version, state_json, event_id, round_num, table_num,
                        who_went_first, bcp_submitted, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s::text[],
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s::jsonb, %s, %s, %s,
                        %s, %s, NOW()
                    )
                    ON CONFLICT (match_id) DO UPDATE SET
                        p1_name = EXCLUDED.p1_name,
                        p1_faction = EXCLUDED.p1_faction,
                        p1_detachment = EXCLUDED.p1_detachment,
                        p1_score = EXCLUDED.p1_score,
                        p2_name = EXCLUDED.p2_name,
                        p2_faction = EXCLUDED.p2_faction,
                        p2_detachment = EXCLUDED.p2_detachment,
                        p2_score = EXCLUDED.p2_score,
                        user_id_p1 = COALESCE(EXCLUDED.user_id_p1, tracker_games.user_id_p1),
                        user_id_p2 = COALESCE(EXCLUDED.user_id_p2, tracker_games.user_id_p2),
                        referee_ids = COALESCE(EXCLUDED.referee_ids, tracker_games.referee_ids),
                        primary_mission = EXCLUDED.primary_mission,
                        deployment = EXCLUDED.deployment,
                        mission_rule = EXCLUDED.mission_rule,
                        current_round = EXCLUDED.current_round,
                        started = EXCLUDED.started,
                        is_finished = EXCLUDED.is_finished,
                        winner_name = EXCLUDED.winner_name,
                        version = EXCLUDED.version,
                        state_json = EXCLUDED.state_json,
                        event_id = COALESCE(EXCLUDED.event_id, tracker_games.event_id),
                        round_num = COALESCE(EXCLUDED.round_num, tracker_games.round_num),
                        table_num = COALESCE(EXCLUDED.table_num, tracker_games.table_num),
                        who_went_first = COALESCE(EXCLUDED.who_went_first, tracker_games.who_went_first),
                        bcp_submitted = COALESCE(EXCLUDED.bcp_submitted, tracker_games.bcp_submitted),
                        updated_at = NOW();
                    """, (
                        match_id, p1_name, p1_faction, p1_detachment, p1_score,
                        p2_name, p2_faction, p2_detachment, p2_score,
                        str(uid_p1) if uid_p1 else None,
                        str(uid_p2) if uid_p2 else None,
                        refs_sql,
                        primary_mission, deployment, mission_rule,
                        current_round, started, is_finished, winner_name,
                        version, json.dumps(state),
                        str(event_id) if event_id else None,
                        round_num, table_num, who_went_first, bcp_submitted
                    ))
                conn.commit()
            return True

        try:
            return do_insert()
        except Exception as err:
            logger.warning(f"First attempt saving tracker game {match_id} failed ({err}). Running ensure_tracker_table()...")
            try:
                self.ensure_tracker_table()
                return do_insert()
            except Exception as retry_err:
                logger.error(f"Final error persisting tracker game {match_id} to DB: {retry_err}", exc_info=True)
                return False

    def get_tracker_game(self, match_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a persisted tracker game by match_id."""
        if not match_id:
            return None
        match_id = match_id.strip().upper()
        
        def do_select():
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    cursor.execute("""
                    SELECT * FROM tracker_games WHERE match_id = %s;
                    """, (match_id,))
                    row = cursor.fetchone()
                    if row:
                        d = dict(row)
                        if isinstance(d.get("state_json"), str):
                            try:
                                d["state"] = json.loads(d["state_json"])
                            except Exception:
                                d["state"] = {}
                        elif isinstance(d.get("state_json"), dict):
                            d["state"] = d["state_json"]
                        if isinstance(d.get("chess_clock"), str):
                            try:
                                d["chess_clock"] = json.loads(d["chess_clock"])
                            except Exception:
                                d["chess_clock"] = None
                        if isinstance(d.get("p1_army_list"), str):
                            try:
                                d["p1_army_list"] = json.loads(d["p1_army_list"])
                            except Exception:
                                pass
                        if isinstance(d.get("p2_army_list"), str):
                            try:
                                d["p2_army_list"] = json.loads(d["p2_army_list"])
                            except Exception:
                                pass
                        return d
                    return None

        try:
            return do_select()
        except Exception as e:
            logger.warning(f"Tracker load notice ({e}). Running ensure_tracker_table()...")
            self.ensure_tracker_table()
            try:
                return do_select()
            except Exception:
                return None

    def update_tracker_army_list(self, match_id: str, role: str, army_list: Dict[str, Any]) -> bool:
        """Persists attached player army list into the tracker_games table."""
        if not match_id:
            return False
        match_id = match_id.strip().upper()
        col_list = "p1_army_list" if role in ["player1", "p1"] else "p2_army_list"
        col_id = "p1_army_list_id" if role in ["player1", "p1"] else "p2_army_list_id"
        col_fac = "p1_faction" if role in ["player1", "p1"] else "p2_faction"
        col_det = "p1_detachment" if role in ["player1", "p1"] else "p2_detachment"

        list_id = army_list.get("id") if isinstance(army_list, dict) else None
        list_json = json.dumps(army_list) if army_list else None
        faction = army_list.get("faction") if isinstance(army_list, dict) else None
        detachment = army_list.get("detachment") if isinstance(army_list, dict) else None

        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    # Update row if exists
                    cursor.execute(f"""
                    UPDATE tracker_games
                    SET {col_list} = %s::jsonb,
                        {col_id} = COALESCE(%s, {col_id}),
                        {col_fac} = COALESCE(%s, {col_fac}),
                        {col_det} = COALESCE(%s, {col_det}),
                        updated_at = NOW()
                    WHERE match_id = %s;
                    """, (list_json, list_id, faction, detachment, match_id))
                    
                    if cursor.rowcount == 0:
                        cursor.execute(f"""
                        INSERT INTO tracker_games (match_id, {col_list}, {col_id}, {col_fac}, {col_det}, updated_at, created_at)
                        VALUES (%s, %s::jsonb, %s, %s, %s, NOW(), NOW())
                        ON CONFLICT (match_id) DO UPDATE
                        SET {col_list} = EXCLUDED.{col_list},
                            {col_id} = COALESCE(EXCLUDED.{col_id}, tracker_games.{col_id}),
                            {col_fac} = COALESCE(EXCLUDED.{col_fac}, tracker_games.{col_fac}),
                            {col_det} = COALESCE(EXCLUDED.{col_det}, tracker_games.{col_det}),
                            updated_at = NOW();
                        """, (match_id, list_json, list_id, faction, detachment))
                conn.commit()
            return True
        except Exception as e:
            logger.warning(f"Error updating tracker army list for match {match_id}: {e}")
            try:
                self.ensure_tracker_table()
            except Exception:
                pass
            return False

    def save_tracker_clock(self, match_id: str, clock_data: Dict[str, Any]) -> bool:
        """Persists live tournament chess clock state in PostgreSQL."""
        if not match_id or not clock_data:
            return False
        match_id = match_id.strip().upper()
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                    UPDATE tracker_games
                    SET chess_clock = %s::jsonb, updated_at = NOW()
                    WHERE match_id = %s;
                    """, (json.dumps(clock_data), match_id))
                conn.commit()
            return True
        except Exception as e:
            logger.debug(f"Notice saving tracker clock: {e}")
            return False

    def get_tracker_history(self, limit: int = 50, search: Optional[str] = None, user_id: Optional[str] = None, user_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns recent persistent tracker games, optionally filtered by player user_id/name and excluding soft-deleted games."""
        def do_query():
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    query = """
                    SELECT match_id, p1_name, p1_faction, p1_detachment, p1_score,
                           p2_name, p2_faction, p2_detachment, p2_score,
                           user_id_p1, user_id_p2,
                           primary_mission, deployment, mission_rule,
                           current_round, started, is_finished, winner_name,
                           version, created_at, updated_at
                    FROM tracker_games
                    """
                    conditions = []
                    params = []
                    
                    if user_id:
                        if user_name:
                            conditions.append("((user_id_p1 = %s OR user_id_p2 = %s) OR (LOWER(p1_name) = LOWER(%s) OR LOWER(p2_name) = LOWER(%s)))")
                            params.extend([user_id, user_id, user_name.strip(), user_name.strip()])
                        else:
                            conditions.append("(user_id_p1 = %s OR user_id_p2 = %s)")
                            params.extend([user_id, user_id])
                        conditions.append("NOT (%s = ANY(COALESCE(hidden_user_ids, '{}')))")
                        params.append(user_id)
                        
                    if search:
                        conditions.append("(match_id ILIKE %s OR p1_name ILIKE %s OR p2_name ILIKE %s)")
                        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
                        
                    if conditions:
                        query += " WHERE " + " AND ".join(conditions)
                        
                    query += " ORDER BY updated_at DESC LIMIT %s;"
                    params.append(limit)
                    
                    cursor.execute(query, tuple(params))
                    rows = cursor.fetchall()
                    res = []
                    for r in rows:
                        d = dict(r)
                        if d.get("updated_at"):
                            d["date"] = d["updated_at"].strftime("%b %d, %Y")
                        res.append(d)
                    return res

        try:
            return do_query()
        except Exception as e:
            logger.warning(f"Tracker history load notice ({e}). Running ensure_tracker_table()...")
            self.ensure_tracker_table()
            try:
                return do_query()
            except Exception as err:
                logger.error(f"Error fetching tracker history: {err}")
                return []

    def hide_tracker_game_for_user(self, match_id: str, user_id: str) -> bool:
        """Soft-deletes/hides a tracker game for a specific user without affecting opponents/referees."""
        if not match_id or not user_id:
            return False
        match_id = match_id.strip().upper()
        self.ensure_tracker_table()
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                UPDATE tracker_games
                SET hidden_user_ids = ARRAY(
                    SELECT DISTINCT unnest(COALESCE(hidden_user_ids, '{}') || ARRAY[%s::TEXT])
                )
                WHERE match_id = %s;
                """, (user_id, match_id))
            conn.commit()
        return True

    def unhide_tracker_game_for_user(self, match_id: str, user_id: str) -> bool:
        """Unhides a tracker game for a specific user."""
        if not match_id or not user_id:
            return False
        match_id = match_id.strip().upper()
        self.ensure_tracker_table()
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                UPDATE tracker_games
                SET hidden_user_ids = array_remove(COALESCE(hidden_user_ids, '{}'), %s::TEXT)
                WHERE match_id = %s;
                """, (user_id, match_id))
            conn.commit()
        return True

    def get_user_tracker_sessions(self, user_id: Optional[str] = None, user_name: Optional[str] = None) -> Dict[str, Any]:
        """Returns structured 3-tier active slot management:
        1. primary_active: most recently updated unfinished match (< 24h)
        2. unfinished_sessions: other unfinished matches (< 14d)
        3. completed_history: completed matches (verified scorecards)
        """
        all_games = self.get_tracker_history(limit=100, user_id=user_id, user_name=user_name)
        now = datetime.now(timezone.utc)
        
        primary_active = None
        unfinished_sessions = []
        completed_history = []
        
        for g in all_games:
            is_finished = g.get("is_finished") is True
            updated_at = g.get("updated_at")
            
            if is_finished:
                completed_history.append(g)
            else:
                age_hours = 0.0
                if updated_at:
                    if isinstance(updated_at, datetime):
                        dt = updated_at if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)
                        age_hours = (now - dt).total_seconds() / 3600.0
                
                if age_hours <= 24.0 and primary_active is None:
                    primary_active = g
                else:
                    unfinished_sessions.append(g)
                    
        return {
            "primary_active": primary_active,
            "unfinished_sessions": unfinished_sessions,
            "completed_history": completed_history,
            "total_games": len(all_games)
        }

    # =========================================================================
    # EVENT STUDIO: TOURNAMENT MANAGEMENT & BCP TWO-WAY SYNC
    # =========================================================================

    def get_studio_events(self, organizer_id: Optional[str] = None, organizer_bcp_id: Optional[str] = None, player_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetches all events organized by or linked to a specific user/TO."""
        if not organizer_id and not organizer_bcp_id and not player_id:
            return []
        from psycopg2 import extras
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    params = []
                    clauses = []
                    if organizer_id:
                        clauses.append("organizer_id = %s")
                        params.append(organizer_id)
                    if organizer_bcp_id:
                        clauses.append("organizer_bcp_id = %s")
                        params.append(organizer_bcp_id)
                    if player_id and player_id != organizer_bcp_id:
                        clauses.append("organizer_bcp_id = %s")
                        params.append(player_id)

                    query = "SELECT * FROM events WHERE (" + " OR ".join(clauses) + ") ORDER BY event_date DESC NULLS LAST, scraped_at DESC LIMIT 100;"
                    cursor.execute(query, tuple(params))
                    rows = cursor.fetchall()
                    results = []
                    for r in rows:
                        item = dict(r)
                        for d_key in ("event_date", "end_date", "scraped_at", "created_at"):
                            if item.get(d_key) and hasattr(item[d_key], "isoformat"):
                                item[d_key] = item[d_key].isoformat()
                        roster = item.get("roster") or []
                        item["roster_count"] = len(roster) if isinstance(roster, list) else 0
                        results.append(item)
                    return results
        except Exception as e:
            logger.warning(f"get_studio_events error: {e}")
            return []

    def get_studio_event(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves full tournament details, roster, and round pairings for Event Studio."""
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT id, name, event_date, end_date, city, state, country, venue,
                       tier, total_players, num_rounds, current_round, is_ended,
                       points, capacity, mission_pack, organizer_id, organizer_bcp_id,
                       roster, pairings, raw_json, scraped_at,
                       COALESCE(event_type, 'singles') as event_type,
                       COALESCE(team_size, 1) as team_size,
                       COALESCE(circuits, '[]'::jsonb) as circuits,
                       COALESCE(started, false) as started,
                       COALESCE(pairings_status, 'draft') as pairings_status
                FROM events
                WHERE id = %s;
                """, (event_id,))
                row = cursor.fetchone()
                if not row:
                    return None
                ev = dict(row)

                # If roster is empty or null, populate from event_participants + player_ratings
                if not ev.get("roster") or ev.get("roster") == []:
                    cursor.execute("""
                    SELECT ep.player_id as id, COALESCE(ep.full_name, p.full_name, ep.player_id) as name, 
                           COALESCE(ep.faction, 'Unassigned') as faction, 
                           COALESCE(ep.team, 'Standard') as detachment,
                           COALESCE(ep.checked_in, true) as checked_in,
                           COALESCE(pr.current_elo, 1500.0) as current_elo
                    FROM event_participants ep
                    LEFT JOIN players p ON ep.player_id = p.id
                    LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                    WHERE ep.event_id = %s
                    ORDER BY ep.placement ASC NULLS LAST;
                    """, (event_id,))
                    p_rows = cursor.fetchall()
                    if p_rows:
                        ev["roster"] = [
                            {
                                "id": str(pr["id"]),
                                "name": pr["name"],
                                "faction": pr["faction"],
                                "detachment": pr["detachment"],
                                "checkedIn": pr["checked_in"],
                                "currentElo": round(float(pr["current_elo"] or 1500.0), 1),
                                "listSubmitted": bool(pr["detachment"])
                            }
                            for pr in p_rows
                        ]

                # If pairings is empty or null, populate from matches
                if not ev.get("pairings") or ev.get("pairings") == {}:
                    cursor.execute("""
                    SELECT m.round, m.table_number, m.player1_id, m.player2_id,
                           COALESCE(m.player1_name, 'Player 1') as p1_name, 
                           COALESCE(m.player2_name, 'Player 2') as p2_name,
                           COALESCE(m.player1_faction, '') as p1_faction, 
                           COALESCE(m.player2_faction, '') as p2_faction,
                           m.player1_score, m.player2_score
                    FROM matches m
                    WHERE m.event_id = %s
                    ORDER BY m.round ASC, m.table_number ASC;
                    """, (event_id,))
                    m_rows = cursor.fetchall()
                    if m_rows:
                        pairings_dict = {}
                        for mr in m_rows:
                            r_str = str(mr["round"] or 1)
                            if r_str not in pairings_dict:
                                pairings_dict[r_str] = []
                            is_done = mr["player1_score"] is not None and mr["player2_score"] is not None
                            pairings_dict[r_str].append({
                                "table": mr["table_number"] or len(pairings_dict[r_str]) + 1,
                                "p1": str(mr["player1_id"] or ""),
                                "p2": str(mr["player2_id"] or ""),
                                "p1_name": mr["p1_name"],
                                "p2_name": mr["p2_name"],
                                "p1_faction": mr["p1_faction"],
                                "p2_faction": mr["p2_faction"],
                                "p1Score": mr["player1_score"],
                                "p2Score": mr["player2_score"],
                                "status": "completed" if is_done else "pending"
                            })
                        ev["pairings"] = pairings_dict

                for d_key in ("event_date", "end_date", "scraped_at", "created_at"):
                    if ev.get(d_key) and hasattr(ev[d_key], "isoformat"):
                        ev[d_key] = ev[d_key].isoformat()

                return ev

    def save_studio_event(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates a tournament in the database."""
        event_id = str(event_data.get("id") or event_data.get("event_id") or f"ES-{uuid.uuid4().hex[:8].upper()}")
        name = event_data.get("name") or "Warhammer 40k Tournament"
        tier = event_data.get("tier") or "Grand Tournament"
        event_date = event_data.get("event_date") or event_data.get("startDate") or datetime.now(timezone.utc)
        end_date = event_data.get("end_date") or event_data.get("endDate") or event_date
        city = event_data.get("city") or ""
        state = event_data.get("state") or ""
        country = event_data.get("country") or "United States"
        venue = event_data.get("venue") or event_data.get("venue_name") or ""
        venue_name = event_data.get("venue_name") or venue
        address = event_data.get("address") or ""
        postal_code = event_data.get("postal_code") or event_data.get("postalCode") or ""
        latitude = event_data.get("latitude") if event_data.get("latitude") is not None else event_data.get("lat")
        longitude = event_data.get("longitude") if event_data.get("longitude") is not None else event_data.get("lng")
        place_id = event_data.get("place_id") or ""
        total_players = int(event_data.get("total_players") or len(event_data.get("roster") or []) or 0)
        num_rounds = int(event_data.get("num_rounds") or event_data.get("rounds") or 5)
        current_round = int(event_data.get("current_round") or 1)
        points = int(event_data.get("points") or 2000)
        capacity = int(event_data.get("capacity") or 32)
        mission_pack = event_data.get("mission_pack") or event_data.get("missionPack") or "11th Edition Core"
        organizer_id = event_data.get("organizer_id")
        organizer_bcp_id = event_data.get("organizer_bcp_id")
        
        raw_et = str(event_data.get("event_type") or event_data.get("eventType") or "singles").lower()
        if "doubles" in raw_et or event_data.get("doubles_event") or event_data.get("doublesEvent"):
            event_type = "doubles"
            default_ts = 2
        elif "team" in raw_et or event_data.get("team_event") or event_data.get("teamEvent"):
            event_type = "teams"
            default_ts = 5
        else:
            event_type = "singles"
            default_ts = 1
            
        team_size = int(event_data.get("team_size") or event_data.get("teamSize") or default_ts)
        circuits = event_data.get("circuits") or []
        circuits_json = json.dumps(circuits if isinstance(circuits, list) else [], default=str)
        started = bool(event_data.get("started", False))
        pairings_status = str(event_data.get("pairings_status") or "draft")
        
        roster_json = json.dumps(event_data.get("roster") or [], default=str)
        pairings_json = json.dumps(event_data.get("pairings") or {}, default=str)
        raw_json = json.dumps(event_data.get("raw_json") or event_data, default=str)

        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO events (
                    id, name, event_date, end_date, city, state, country, venue,
                    tier, total_players, num_rounds, current_round, points, capacity,
                    mission_pack, organizer_id, organizer_bcp_id, roster, pairings,
                    raw_json, scraped_at, event_type, team_size, circuits,
                    venue_name, address, postal_code, latitude, longitude, place_id,
                    started, pairings_status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb, %s::jsonb,
                    %s::jsonb, NOW(), %s, %s, %s::jsonb,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    tier = EXCLUDED.tier,
                    event_date = EXCLUDED.event_date,
                    end_date = EXCLUDED.end_date,
                    city = EXCLUDED.city,
                    state = EXCLUDED.state,
                    country = EXCLUDED.country,
                    venue = EXCLUDED.venue,
                    total_players = EXCLUDED.total_players,
                    num_rounds = EXCLUDED.num_rounds,
                    current_round = EXCLUDED.current_round,
                    points = EXCLUDED.points,
                    capacity = EXCLUDED.capacity,
                    mission_pack = EXCLUDED.mission_pack,
                    event_type = EXCLUDED.event_type,
                    team_size = EXCLUDED.team_size,
                    circuits = COALESCE(EXCLUDED.circuits, events.circuits),
                    organizer_id = COALESCE(EXCLUDED.organizer_id, events.organizer_id),
                    organizer_bcp_id = COALESCE(EXCLUDED.organizer_bcp_id, events.organizer_bcp_id),
                    roster = COALESCE(EXCLUDED.roster, events.roster),
                    pairings = COALESCE(EXCLUDED.pairings, events.pairings),
                    raw_json = COALESCE(EXCLUDED.raw_json, events.raw_json),
                    venue_name = COALESCE(EXCLUDED.venue_name, events.venue_name),
                    address = COALESCE(EXCLUDED.address, events.address),
                    postal_code = COALESCE(EXCLUDED.postal_code, events.postal_code),
                    latitude = COALESCE(EXCLUDED.latitude, events.latitude),
                    longitude = COALESCE(EXCLUDED.longitude, events.longitude),
                    place_id = COALESCE(EXCLUDED.place_id, events.place_id),
                    started = COALESCE(EXCLUDED.started, events.started),
                    pairings_status = COALESCE(EXCLUDED.pairings_status, events.pairings_status),
                    scraped_at = NOW();
                """, (
                    event_id, name, event_date, end_date, city, state, country, venue,
                    tier, total_players, num_rounds, current_round, points, capacity,
                    mission_pack, organizer_id, organizer_bcp_id, roster_json, pairings_json,
                    raw_json, event_type, team_size, circuits_json,
                    venue_name, address, postal_code,
                    float(latitude) if latitude is not None else None,
                    float(longitude) if longitude is not None else None,
                    place_id,
                    started, pairings_status
                ))
            conn.commit()

        return self.get_studio_event(event_id) or {"id": event_id, "name": name}

    def delete_studio_event(self, event_id: str, organizer_id: Optional[str] = None) -> bool:
        """Deletes a tournament event and associated data from the database."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS deleted_studio_events (
                    event_id VARCHAR(64) PRIMARY KEY,
                    deleted_at TIMESTAMPTZ DEFAULT NOW()
                );
                """)
                cursor.execute("INSERT INTO deleted_studio_events (event_id, deleted_at) VALUES (%s, NOW()) ON CONFLICT (event_id) DO UPDATE SET deleted_at = NOW();", (event_id,))
                cursor.execute("DELETE FROM events WHERE id = %s;", (event_id,))
                cursor.execute("DELETE FROM event_participants WHERE event_id = %s;", (event_id,))
                cursor.execute("DELETE FROM matches WHERE event_id = %s;", (event_id,))
            conn.commit()
        return True

    def is_event_deleted(self, event_id: str) -> bool:
        """Checks if an event was recently marked as deleted."""
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM deleted_studio_events WHERE event_id = %s AND deleted_at > NOW() - INTERVAL '7 days';", (event_id,))
                    return bool(cursor.fetchone())
        except Exception:
            return False

    def save_user_army_list(self, user_id: Optional[str], list_data: Dict[str, Any]) -> Dict[str, Any]:
        """Saves or updates a user army list in the database."""
        list_id = str(list_data.get("id") or f"list_{uuid.uuid4().hex[:10]}")
        name = str(list_data.get("name") or "Unnamed Army List")
        faction = str(list_data.get("faction") or "Unknown Faction")
        detachment = str(list_data.get("detachment") or "")
        points = int(list_data.get("points") or 2000)
        points_limit = int(list_data.get("points_limit") or 2000)
        warlord = str(list_data.get("warlord") or "")
        source_format = str(list_data.get("source_format") or "Custom")
        raw_text = str(list_data.get("raw_text") or "")
        list_json = json.dumps(list_data)

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                INSERT INTO user_army_lists (
                    id, user_id, name, faction, detachment, points, points_limit,
                    warlord, source_format, raw_text, list_data, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb, NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    faction = EXCLUDED.faction,
                    detachment = EXCLUDED.detachment,
                    points = EXCLUDED.points,
                    points_limit = EXCLUDED.points_limit,
                    warlord = EXCLUDED.warlord,
                    source_format = EXCLUDED.source_format,
                    raw_text = EXCLUDED.raw_text,
                    list_data = EXCLUDED.list_data,
                    updated_at = NOW();
                """, (
                    list_id, user_id, name, faction, detachment, points, points_limit,
                    warlord, source_format, raw_text, list_json
                ))
            conn.commit()

        return self.get_user_army_list(list_id, user_id=user_id) or list_data

    def get_user_army_lists(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves all saved army lists for a given user or global defaults."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                if user_id:
                    cursor.execute("""
                    SELECT id, user_id, name, faction, detachment, points, points_limit,
                           warlord, source_format, list_data, created_at, updated_at
                    FROM user_army_lists
                    WHERE user_id = %s OR user_id IS NULL
                    ORDER BY updated_at DESC;
                    """, (user_id,))
                else:
                    cursor.execute("""
                    SELECT id, user_id, name, faction, detachment, points, points_limit,
                           warlord, source_format, list_data, created_at, updated_at
                    FROM user_army_lists
                    ORDER BY updated_at DESC
                    LIMIT 50;
                    """)
                rows = cursor.fetchall()
                res = []
                for r in rows:
                    item = dict(r)
                    ld = item.get("list_data")
                    if isinstance(ld, str):
                        try:
                            ld = json.loads(ld)
                        except Exception:
                            ld = None
                    if isinstance(ld, dict):
                        for k, v in ld.items():
                            if k not in item or not item[k]:
                                item[k] = v
                    res.append(item)
                return res

    def get_user_army_list(self, list_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves a single army list by ID."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                SELECT id, user_id, name, faction, detachment, points, points_limit,
                       warlord, source_format, raw_text, list_data, created_at, updated_at
                FROM user_army_lists
                WHERE id = %s;
                """, (list_id,))
                row = cursor.fetchone()
                if not row:
                    return None
                item = dict(row)
                ld = item.get("list_data")
                if isinstance(ld, str):
                    try:
                        ld = json.loads(ld)
                    except Exception:
                        ld = None
                if isinstance(ld, dict):
                    for k, v in ld.items():
                        if k not in item or not item[k]:
                            item[k] = v
                return item

    def delete_user_army_list(self, list_id: str, user_id: Optional[str] = None) -> bool:
        """Deletes an army list by ID from user_army_lists table."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM user_army_lists WHERE id = %s;", (list_id,))
            conn.commit()
        return True

    # =========================================================================
    # EVENT STUDIO: JUDGE DISPATCH & TO CALLS
    # =========================================================================

    def create_judge_call(
        self,
        event_id: str,
        table_num: Optional[int] = None,
        match_id: Optional[str] = None,
        player_name: str = "Competitor",
        category: str = "Rules Dispute",
        note: str = ""
    ) -> Dict[str, Any]:
        """Creates a judge dispatch call from a tournament game table."""
        call_id = f"JC-{uuid.uuid4().hex[:8].upper()}"
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO tournament_judge_calls (
                    id, event_id, table_num, match_id, player_name, category, note, status, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', NOW())
                RETURNING id, event_id, table_num, match_id, player_name, category, note, status, created_at;
                """, (call_id, event_id, table_num, match_id, player_name, category, note))
                row = cursor.fetchone()
            conn.commit()
        return {
            "id": call_id,
            "event_id": event_id,
            "table_num": table_num,
            "match_id": match_id,
            "player_name": player_name,
            "category": category,
            "note": note,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }

    def get_judge_calls(self, event_id: str, active_only: bool = False) -> List[Dict[str, Any]]:
        """Lists judge dispatch calls for a tournament."""
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                sql = "SELECT * FROM tournament_judge_calls WHERE event_id = %s"
                if active_only:
                    sql += " AND status IN ('pending', 'en_route')"
                sql += " ORDER BY created_at DESC LIMIT 100;"
                cursor.execute(sql, (event_id,))
                rows = cursor.fetchall()
                calls = []
                for r in rows:
                    c = dict(r)
                    if c.get("created_at"):
                        c["created_at"] = c["created_at"].isoformat()
                    if c.get("resolved_at"):
                        c["resolved_at"] = c["resolved_at"].isoformat()
                    calls.append(c)
                return calls

    def resolve_judge_call(self, call_id: str, status: str = "resolved") -> bool:
        """Marks a judge call as en_route, resolved, or cancelled."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                if status == "resolved":
                    cursor.execute("""
                    UPDATE tournament_judge_calls 
                    SET status = %s, resolved_at = NOW() 
                    WHERE id = %s;
                    """, (status, call_id))
                else:
                    cursor.execute("""
                    UPDATE tournament_judge_calls 
                    SET status = %s 
                    WHERE id = %s;
                    """, (status, call_id))
            conn.commit()
        return True

    # =========================================================================
    # EVENT STUDIO: WTC / TEAM MATCH PAIRING DRAFT
    # =========================================================================

    def save_wtc_draft(self, event_id: str, round_num: int, team_a_name: str, team_b_name: str, draft_state: Dict[str, Any]) -> Dict[str, Any]:
        """Saves active WTC team captain pairing draft state."""
        draft_id = f"WTC-{event_id}-{round_num}"
        draft_json = json.dumps(draft_state)
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO tournament_wtc_drafts (
                    id, event_id, round_num, team_a_name, team_b_name, draft_state, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
                ON CONFLICT (event_id, round_num) DO UPDATE SET
                    team_a_name = EXCLUDED.team_a_name,
                    team_b_name = EXCLUDED.team_b_name,
                    draft_state = EXCLUDED.draft_state,
                    updated_at = NOW();
                """, (draft_id, event_id, round_num, team_a_name, team_b_name, draft_json))
            conn.commit()
        return {"success": True, "draft_id": draft_id, "event_id": event_id, "round_num": round_num}

    def get_wtc_draft(self, event_id: str, round_num: int) -> Optional[Dict[str, Any]]:
        """Retrieves WTC team captain pairing draft state."""
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                SELECT * FROM tournament_wtc_drafts
                WHERE event_id = %s AND round_num = %s;
                """, (event_id, round_num))
                row = cursor.fetchone()
                if not row:
                    return None
                res = dict(row)
                if isinstance(res.get("draft_state"), str):
                    try:
                        res["draft_state"] = json.loads(res["draft_state"])
                    except Exception:
                        pass
                return res

    # =========================================================================
    # EVENT STUDIO: AUTOMATED MULTI-DAY POD & BRACKET PROGRESSION
    # =========================================================================

    def generate_day2_pod_brackets(
        self,
        event_id: str,
        pod_size: int = 4,
        num_pods: int = 2,
        target_round: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Automates Day 1 -> Day 2 Pod & Bracket progression.
        Ranks players based on Day 1 Swiss standings, assigns them into Pods (Championship Pod 1, Consolation Pod 2, etc.),
        and generates tournament bracket pairings (1 vs 4, 2 vs 3).
        """
        ev = self.get_event_details(event_id)
        if not ev or not ev.get("players"):
            # Fallback to studio event roster
            ev_studio = self.get_studio_event(event_id)
            if not ev_studio or not ev_studio.get("roster"):
                return {"error": "No players found to generate pod brackets."}
            players = ev_studio.get("roster", [])
        else:
            players = ev.get("players", [])

        # Current total rounds
        curr_round = ev.get("num_rounds") or 5
        day2_round = target_round or (curr_round + 1)

        pod_assignments = []
        assigned_pairings = []
        table_counter = 1

        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                # Assign each slice of players to a Pod
                for p_idx in range(num_pods):
                    p_num = p_idx + 1
                    start_idx = p_idx * pod_size
                    end_idx = start_idx + pod_size
                    pod_players = players[start_idx:end_idx]
                    
                    if not pod_players:
                        break

                    pod_name = "Championship Bracket" if p_num == 1 else (f"Consolation Bracket {p_num - 1}" if p_num <= 3 else f"Flight Pod {p_num}")
                    pod_assignments.append({
                        "pod_num": p_num,
                        "pod_name": pod_name,
                        "seeds": [{"seed": idx + 1, "player_id": p.get("player_id") or p.get("id"), "name": p.get("full_name") or p.get("name"), "faction": p.get("faction")} for idx, p in enumerate(pod_players)]
                    })

                    # Update pod_num in event_participants
                    for p in pod_players:
                        pid = str(p.get("player_id") or p.get("id"))
                        cursor.execute("""
                        UPDATE event_participants 
                        SET pod_num = %s 
                        WHERE event_id = %s AND player_id = %s;
                        """, (p_num, event_id, pid))

                    # Generate initial bracket pairings (Seed 1 vs Seed 4, Seed 2 vs Seed 3 for 4-man pod)
                    if len(pod_players) == 4:
                        pairs = [
                            (pod_players[0], pod_players[3]),  # 1 vs 4
                            (pod_players[1], pod_players[2])   # 2 vs 3
                        ]
                    elif len(pod_players) == 8:
                        pairs = [
                            (pod_players[0], pod_players[7]),  # 1 vs 8
                            (pod_players[3], pod_players[4]),  # 4 vs 5
                            (pod_players[1], pod_players[6]),  # 2 vs 7
                            (pod_players[2], pod_players[5])   # 3 vs 6
                        ]
                    else:
                        # Standard fold
                        pairs = []
                        half = len(pod_players) // 2
                        for i in range(half):
                            pairs.append((pod_players[i], pod_players[len(pod_players) - 1 - i]))

                    for p1, p2 in pairs:
                        p1_id = str(p1.get("player_id") or p1.get("id"))
                        p2_id = str(p2.get("player_id") or p2.get("id"))
                        p1_name = p1.get("full_name") or p1.get("name") or "Player 1"
                        p2_name = p2.get("full_name") or p2.get("name") or "Player 2"
                        p1_fac = p1.get("faction") or "Unknown"
                        p2_fac = p2.get("faction") or "Unknown"

                        assigned_pairings.append({
                            "table": table_counter,
                            "round": day2_round,
                            "pod_num": p_num,
                            "pod_name": pod_name,
                            "p1": p1_id,
                            "p2": p2_id,
                            "p1_name": p1_name,
                            "p2_name": p2_name,
                            "p1_faction": p1_fac,
                            "p2_faction": p2_fac,
                            "p1Score": None,
                            "p2Score": None,
                            "status": "pending"
                        })
                        table_counter += 1

                # Save generated pairings to event JSON
                cursor.execute("SELECT pairings FROM events WHERE id = %s;", (event_id,))
                existing_pairings_row = cursor.fetchone()
                existing_pairings = {}
                if existing_pairings_row and existing_pairings_row[0]:
                    existing_pairings = existing_pairings_row[0] if isinstance(existing_pairings_row[0], dict) else json.loads(existing_pairings_row[0])
                
                existing_pairings[str(day2_round)] = assigned_pairings

                cursor.execute("""
                UPDATE events 
                SET pairings = %s::jsonb, num_rounds = GREATEST(num_rounds, %s)
                WHERE id = %s;
                """, (json.dumps(existing_pairings), day2_round, event_id))
            conn.commit()

        return {
            "success": True,
            "event_id": event_id,
            "target_round": day2_round,
            "num_pods": len(pod_assignments),
            "pods": pod_assignments,
            "pairings": assigned_pairings
        }

    # =========================================================================
    # WAHAPEDIA 11TH EDITION REFERENCE & AUTO-ENRICHMENT ENGINE
    # =========================================================================

    def waha_get_sync_status(self) -> Dict[str, Any]:
        """Returns the current Wahapedia 11th edition sync state and statistics."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT value, updated_at FROM waha_sync_metadata WHERE key = 'last_update';")
                row = cursor.fetchone()
                last_update = row[0] if row else None
                last_sync_time = row[1].isoformat() if row and row[1] else None

                counts = {}
                for tbl in ["waha_datasheets", "waha_datasheet_models", "waha_datasheet_wargear", 
                            "waha_datasheet_abilities", "waha_stratagems", "waha_enhancements", "waha_detachments"]:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM {tbl};")
                        r = cursor.fetchone()
                        counts[tbl] = r[0] if r else 0
                    except Exception:
                        counts[tbl] = 0

                return {
                    "edition": "11th Edition (wh40k11ed)",
                    "last_update": last_update,
                    "last_sync_time": last_sync_time,
                    "counts": counts
                }

    def waha_find_unit(self, unit_name: str, faction_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Finds and builds a full enriched datasheet dict for a unit by name from PostgreSQL."""
        clean_name = unit_name.strip()
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                clean_name = unit_name.strip()
                # 1. Exact match (and curly quote normalization)
                cursor.execute("SELECT * FROM waha_datasheets WHERE LOWER(name) = LOWER(%s) OR LOWER(name) = LOWER(%s) OR LOWER(name) = LOWER(%s) LIMIT 1;", (
                    clean_name,
                    clean_name.replace("'", "’"),
                    clean_name.replace("’", "'")
                ))
                row = cursor.fetchone()

                # 2. Variants match
                if not row:
                    variants = [
                        clean_name.replace(" Squad", "").replace(" squad", "").strip(),
                        clean_name.replace("Deathwing ", "").strip(),
                        clean_name.replace("Ravenwing ", "").strip(),
                        clean_name.replace("Vanguard ", "").strip(),
                        clean_name.replace("Sternguard ", "").strip(),
                        clean_name.replace("'", "’"),
                        clean_name.replace("’", "'"),
                        clean_name.replace("’", "").replace("'", "")
                    ]
                    for var in variants:
                        if var and var != clean_name:
                            cursor.execute("SELECT * FROM waha_datasheets WHERE LOWER(name) = LOWER(%s) OR LOWER(name) = LOWER(%s) LIMIT 1;", (var, var.replace("'", "’")))
                            row = cursor.fetchone()
                            if row:
                                break

                # 3. Fuzzy ILIKE match
                if not row:
                    search_term = clean_name.replace("'", "%").replace("’", "%")
                    cursor.execute("SELECT * FROM waha_datasheets WHERE name ILIKE %s ORDER BY LENGTH(name) ASC LIMIT 1;", (f"%%{search_term}%%",))
                    row = cursor.fetchone()

                if not row:
                    return None

                ds_id = row["id"]
                ds_name = row["name"]
                faction_id = row["faction_id"]
                role = row["role"]

                # Models / stats
                cursor.execute("SELECT * FROM waha_datasheet_models WHERE datasheet_id = %s ORDER BY line ASC;", (ds_id,))
                models = [dict(m) for m in cursor.fetchall()]
                stats = {}
                if models:
                    m0 = models[0]
                    stats = {
                        "M": m0.get("m") or '6"',
                        "T": m0.get("t") or "4",
                        "SV": m0.get("sv") or "3+",
                        "INV": m0.get("inv_sv") or "-",
                        "W": int(m0.get("w", 2)) if str(m0.get("w", "")).isdigit() else m0.get("w", "2"),
                        "LD": m0.get("ld") or "6+",
                        "OC": m0.get("oc") or "1"
                    }

                # Weapons
                cursor.execute("SELECT * FROM waha_datasheet_wargear WHERE datasheet_id = %s ORDER BY line ASC, line_in_wargear ASC;", (ds_id,))
                wargear_rows = cursor.fetchall()
                weapons = []
                for w in wargear_rows:
                    rng = w["range"] or "Melee"
                    w_type = "Ranged" if (w["type"] and "Ranged" in w["type"]) or rng != "Melee" else "Melee"
                    skill_val = w["bs_ws"] or "3+"
                    weapons.append({
                        "name": w["name"],
                        "type": w_type,
                        "range": rng,
                        "Range": rng,
                        "A": w["a"] or "1",
                        "skill": skill_val,
                        "BS": skill_val if w_type == "Ranged" else "-",
                        "WS": skill_val if w_type == "Melee" else "-",
                        "S": w["s"] or "4",
                        "AP": w["ap"] or "0",
                        "D": w["d"] or "1",
                        "description": w["description"] or "",
                        "keywords": [k.strip() for k in (w["description"] or "").split(",") if k.strip()] if (w["description"] and not w["description"].startswith("■")) else []
                    })

                # Abilities
                cursor.execute("SELECT * FROM waha_datasheet_abilities WHERE datasheet_id = %s AND name IS NOT NULL AND name != '' ORDER BY line ASC;", (ds_id,))
                abilities = []
                for a in cursor.fetchall():
                    abilities.append({
                        "name": a["name"],
                        "description": a["description"] or "",
                        "type": a["type"] or "Abilities"
                    })

                # Keywords
                cursor.execute("SELECT keyword FROM waha_datasheet_keywords WHERE datasheet_id = %s AND keyword IS NOT NULL AND keyword != '';", (ds_id,))
                keywords = [k["keyword"] for k in cursor.fetchall() if k["keyword"]]

                # Points costs
                cursor.execute("SELECT description, cost FROM waha_datasheet_costs WHERE datasheet_id = %s AND description IS NOT NULL AND description != '' ORDER BY line ASC;", (ds_id,))
                costs = [dict(c) for c in cursor.fetchall()]

                return {
                    "id": ds_id,
                    "name": ds_name,
                    "faction_id": faction_id,
                    "role": role,
                    "stats": stats,
                    "weapons": weapons,
                    "abilities": abilities,
                    "keywords": keywords,
                    "costs": costs,
                    "models": models
                }

    def _extract_detachment_search_terms(self, detachment_name: str) -> Tuple[List[str], List[str]]:
        """Extracts candidate detachment names and rule names from an arbitrary detachment input string."""
        if not detachment_name:
            return [], []
        import re
        raw = detachment_name.replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
        
        # 1. Extract parenthetical expressions as candidate rule names (ignoring points/upgrades)
        raw_parens = re.findall(r'\((.*?)\)', raw)
        rule_hints = []
        for r in raw_parens:
            r_clean = r.strip()
            if not r_clean:
                continue
            if re.search(r'\d+\s*(?:detachment\s*points?|pts?|points?)', r_clean, re.IGNORECASE):
                continue
            if r_clean.lower() in ('upgrade', 'enhancement', 'warlord'):
                continue
            rule_hints.append(r_clean)
        
        # 2. Strip parentheses for the base detachment string
        no_parens = re.sub(r'\(.*?\)', '', raw).strip()
        
        # 3. Strip any faction prefixes like 'Xenos - Necrons:' or 'Necrons -'
        if ':' in no_parens:
            no_parens = no_parens.split(':', 1)[-1].strip()
        if ' - ' in no_parens and not any(kw in no_parens.lower() for kw in ['task force', 'spearhead', 'legion', 'court', 'host', 'fleet', 'phalanx', 'cadre', 'detachment']):
            parts = no_parens.split(' - ')
            no_parens = parts[-1].strip()
            
        # 4. Split by comma, semicolon, slash, ampersand, or " and " (e.g. "Cursed Legion and Skyshroud Spearhead")
        sub_parts = [p.strip() for p in re.split(r'[,;/&]+|\s+and\s+', no_parens, flags=re.IGNORECASE) if p.strip()]
        
        candidate_dets = []
        for sp in sub_parts:
            clean_sp = re.sub(r'\s+detachment$', '', sp, flags=re.IGNORECASE).strip()
            if clean_sp and clean_sp not in candidate_dets:
                candidate_dets.append(clean_sp)
            if sp and sp not in candidate_dets:
                candidate_dets.append(sp)
        if no_parens and no_parens not in candidate_dets:
            candidate_dets.append(no_parens)
        if raw and raw not in candidate_dets:
            candidate_dets.append(raw)
            
        return candidate_dets, rule_hints

    def waha_find_enhancement(self, enhancement_name: str, faction_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Finds a specific enhancement by name from PostgreSQL."""
        if not enhancement_name:
            return None
        import re
        clean_name = re.sub(r'\(.*?\)', '', str(enhancement_name)).strip()
        clean_name = re.sub(r'^[•\-\*\s]+', '', clean_name).strip()
        if not clean_name:
            return None
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT * FROM waha_enhancements
                    WHERE LOWER(name) = LOWER(%s)
                    LIMIT 1;
                """, (clean_name,))
                row = cursor.fetchone()
                if row:
                    return dict(row)
                
                cursor.execute("""
                    SELECT * FROM waha_enhancements
                    WHERE name ILIKE %s OR %s ILIKE ('%%' || name || '%%')
                    LIMIT 1;
                """, (f"%{clean_name}%", clean_name))
                row = cursor.fetchone()
                if row:
                    return dict(row)
                return None

    def waha_get_stratagems(self, detachment_name: str, faction_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns all stratagems associated with a specific detachment (plus core stratagems) from PostgreSQL."""
        if not detachment_name:
            return []
        candidate_dets, rule_hints = self._extract_detachment_search_terms(detachment_name)
        if not candidate_dets and not rule_hints:
            return []
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                expanded_dets = list(candidate_dets)
                if rule_hints:
                    r_clauses = ["LOWER(name) = LOWER(%s) OR name ILIKE %s" for _ in rule_hints]
                    r_params = []
                    for rh in rule_hints:
                        r_params.extend([rh, f"%{rh}%"])
                    cursor.execute(f"SELECT DISTINCT detachment FROM waha_detachment_abilities WHERE {' OR '.join(r_clauses)};", tuple(r_params))
                    for row in cursor.fetchall():
                        d = row.get("detachment")
                        if d and d not in expanded_dets:
                            expanded_dets.append(d)

                clauses = []
                params = []
                for det in expanded_dets:
                    clauses.append("LOWER(detachment) = LOWER(%s) OR detachment ILIKE %s")
                    params.extend([det, f"%{det}%"])
                
                # Include Core Stratagems
                clauses.append("LOWER(detachment) = 'core' OR LOWER(detachment) = 'core stratagems'")
                
                query = f"""
                    SELECT * FROM waha_stratagems 
                    WHERE ({' OR '.join(clauses)})
                      AND name IS NOT NULL AND TRIM(name) != ''
                      AND cp_cost IS NOT NULL AND TRIM(cp_cost) != ''
                    ORDER BY CASE WHEN LOWER(detachment) = 'core' THEN 2 ELSE 1 END, name ASC;
                """
                cursor.execute(query, tuple(params))
                rows = [dict(r) for r in cursor.fetchall()]
                seen = set()
                deduped = []
                for r in rows:
                    n = (r.get("name") or "").strip().lower()
                    if n and n not in seen:
                        seen.add(n)
                        deduped.append(r)
                return deduped

    def waha_get_enhancements(self, detachment_name: str) -> List[Dict[str, Any]]:
        """Returns all enhancements associated with a specific detachment from PostgreSQL."""
        if not detachment_name:
            return []
        candidate_dets, rule_hints = self._extract_detachment_search_terms(detachment_name)
        if not candidate_dets and not rule_hints:
            return []
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                expanded_dets = list(candidate_dets)
                if rule_hints:
                    r_clauses = ["LOWER(name) = LOWER(%s) OR name ILIKE %s" for _ in rule_hints]
                    r_params = []
                    for rh in rule_hints:
                        r_params.extend([rh, f"%{rh}%"])
                    cursor.execute(f"SELECT DISTINCT detachment FROM waha_detachment_abilities WHERE {' OR '.join(r_clauses)};", tuple(r_params))
                    for row in cursor.fetchall():
                        d = row.get("detachment")
                        if d and d not in expanded_dets:
                            expanded_dets.append(d)

                clauses = []
                params = []
                for det in expanded_dets:
                    clauses.append("LOWER(detachment) = LOWER(%s) OR detachment ILIKE %s")
                    params.extend([det, f"%{det}%"])
                
                query = f"""
                    SELECT * FROM waha_enhancements 
                    WHERE ({' OR '.join(clauses)})
                      AND name IS NOT NULL AND name != ''
                    ORDER BY name ASC;
                """
                cursor.execute(query, tuple(params))
                rows = [dict(r) for r in cursor.fetchall()]
                seen = set()
                deduped = []
                for r in rows:
                    n = (r.get("name") or "").strip().lower()
                    if n and n not in seen:
                        seen.add(n)
                        deduped.append(r)
                return deduped

    def waha_get_detachment_rules(self, detachment_name: str) -> List[Dict[str, Any]]:
        """Returns all detachment rules associated with a specific detachment or rule name from PostgreSQL."""
        if not detachment_name:
            return []
        candidate_dets, rule_hints = self._extract_detachment_search_terms(detachment_name)
        if not candidate_dets and not rule_hints:
            return []
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                clauses = []
                params = []
                for det in candidate_dets:
                    clauses.append("LOWER(detachment) = LOWER(%s) OR detachment ILIKE %s")
                    params.extend([det, f"%{det}%"])
                for r_hint in rule_hints:
                    clauses.append("LOWER(name) = LOWER(%s) OR name ILIKE %s")
                    params.extend([r_hint, f"%{r_hint}%"])
                
                query = f"""
                    SELECT * FROM waha_detachment_abilities 
                    WHERE ({' OR '.join(clauses)})
                      AND name IS NOT NULL AND name != ''
                    ORDER BY name ASC;
                """
                cursor.execute(query, tuple(params))
                rows = [dict(r) for r in cursor.fetchall()]
                seen = set()
                deduped = []
                for r in rows:
                    n = (r.get("name") or "").strip().lower()
                    if n and n not in seen:
                        seen.add(n)
                        deduped.append(r)
                return deduped

    def _resolve_waha_faction_ids(self, faction_name: str) -> List[str]:
        """Resolves arbitrary faction string, keywords, and chapters to Wahapedia faction IDs (e.g. 'SM', 'NEC', 'CSM')."""
        if not faction_name:
            return []
        f_clean = faction_name.lower().replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
        matched_ids = []
        
        # Space Marines / Chapters
        if any(k in f_clean for k in ['adeptus astartes', 'space marine', 'dark angel', 'blood angel', 'space wolf', 'space wolves', 'black templar', 'deathwatch', 'ultramarine', 'imperial fist', 'iron hand', 'raven guard', 'salamander', 'white scar', 'iron hands', 'salamanders', 'white scars']):
            matched_ids.append('SM')
            
        # Chaos Space Marines / Legions
        if any(k in f_clean for k in ['chaos space marine', 'heretic astartes', 'black legion', 'iron warriors', 'night lords', 'word bearers', 'alpha legion']):
            matched_ids.append('CSM')
        if 'world eater' in f_clean:
            matched_ids.append('WE')
        if 'death guard' in f_clean:
            matched_ids.append('DG')
        if 'thousand son' in f_clean:
            matched_ids.append('TS')
        if "emperor's children" in f_clean or "emperors children" in f_clean:
            matched_ids.append('EC')
        if 'chaos daemon' in f_clean or 'daemons of chaos' in f_clean:
            matched_ids.append('CD')
        if 'chaos knight' in f_clean:
            matched_ids.append('QT')
            
        # Imperium
        if 'adepta sororitas' in f_clean or 'sisters of battle' in f_clean:
            matched_ids.append('AS')
        if 'adeptus custodes' in f_clean or 'custodes' in f_clean:
            matched_ids.append('AC')
        if 'adeptus mechanicus' in f_clean or 'admech' in f_clean or 'mechanicus' in f_clean:
            matched_ids.append('AdM')
        if 'astra militarum' in f_clean or 'imperial guard' in f_clean:
            matched_ids.append('AM')
        if 'grey knight' in f_clean:
            matched_ids.append('GK')
        if 'imperial knight' in f_clean:
            matched_ids.append('QI')
        if 'imperial agent' in f_clean or 'agents of the imperium' in f_clean or 'inquisition' in f_clean:
            matched_ids.append('AoI')
            
        # Xenos
        if 'necron' in f_clean:
            matched_ids.append('NEC')
        if 'tyranid' in f_clean:
            matched_ids.append('TYR')
        if 'genestealer cult' in f_clean or 'gsc' in f_clean:
            matched_ids.append('GC')
        if 'aeldari' in f_clean or 'craftworld' in f_clean or 'asuryani' in f_clean or 'ynnari' in f_clean:
            matched_ids.append('AE')
        if 'drukhari' in f_clean or 'dark eldar' in f_clean:
            matched_ids.append('DRU')
        if 'ork' in f_clean:
            matched_ids.append('ORK')
        if 'tau' in f_clean or 't’au' in f_clean:
            matched_ids.append('TAU')
        if 'votann' in f_clean:
            matched_ids.append('LoV')
            
        return matched_ids

    def waha_get_army_rules(self, faction_name: str) -> List[Dict[str, Any]]:
        """Returns all army rules (e.g. Oath of Moment, Reanimation Protocols) for a faction or chapter."""
        if not faction_name:
            return []
        fac_clean = faction_name.replace('\u00a0', ' ').strip()
        fac_lower = fac_clean.lower()
        matched_fac_ids = self._resolve_waha_faction_ids(fac_clean)
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                clauses = []
                params = []
                
                # 1. Direct faction matching
                clauses.append("(LOWER(f.name) = LOWER(%s) OR f.name ILIKE %s OR LOWER(ab.faction_id) = LOWER(%s) OR ab.faction_id ILIKE %s)")
                params.extend([fac_clean, f"%{fac_clean}%", fac_clean, f"%{fac_clean}%"])
                
                # 2. Resolved faction IDs (e.g. 'SM', 'NEC', 'CSM')
                if matched_fac_ids:
                    id_placeholders = ", ".join(["%s"] * len(matched_fac_ids))
                    clauses.append(f"ab.faction_id IN ({id_placeholders})")
                    params.extend(matched_fac_ids)
                
                query = f"""
                    SELECT ab.* FROM waha_army_abilities ab
                    LEFT JOIN waha_factions f ON ab.faction_id = f.id
                    WHERE ({' OR '.join(clauses)})
                      AND ab.faction_id IS NOT NULL AND ab.faction_id != ''
                    ORDER BY ab.name ASC;
                """
                cursor.execute(query, tuple(params))
                raw_rules = [dict(r) for r in cursor.fetchall()]
                
                # 3. Filter / prioritize chapter-specific vs generic abilities
                filtered_rules = []
                for r in raw_rules:
                    r_name = (r.get("name") or "").strip()
                    r_fac = r.get("faction_id") or ""
                    
                    if r_fac == 'SM':
                        # Core SM rule: Oath of Moment is always included
                        if r_name == 'Oath of Moment':
                            filtered_rules.append(r)
                        elif r_name in ('The Unforgiven', 'The Deathwing', 'The Ravenwing') and any(k in fac_lower for k in ['dark angel', 'unforgiven', 'deathwing', 'ravenwing']):
                            filtered_rules.append(r)
                        elif r_name == 'The Sons of Sanguinius' and 'blood angel' in fac_lower:
                            filtered_rules.append(r)
                        elif r_name in ('Sons of Russ', 'Sagas', 'Curse of the Wulfen') and any(k in fac_lower for k in ['space wolf', 'space wolves', 'fenris']):
                            filtered_rules.append(r)
                        elif r_name in ('Templar Vows', 'Heirs of Sigismund') and 'black templar' in fac_lower:
                            filtered_rules.append(r)
                        elif r_name in ('Mission Tactics', 'Kill Teams', 'Deathwatch') and 'deathwatch' in fac_lower:
                            filtered_rules.append(r)
                        elif r_name == 'Space Marine Chapters' and not any(ch in fac_lower for ch in ['dark angel', 'blood angel', 'space wolf', 'space wolves', 'black templar', 'deathwatch']):
                            filtered_rules.append(r)
                    else:
                        filtered_rules.append(r)
                
                # Deduplicate by ability name
                seen = set()
                deduped = []
                for r in filtered_rules or raw_rules:
                    n = (r.get("name") or "").strip().lower()
                    if n and n not in seen:
                        seen.add(n)
                        deduped.append(r)
                return deduped

    def save_feedback(self, feedback_type: str, message: str, user_id: Optional[str] = None, user_email: Optional[str] = None, page_url: Optional[str] = None, device_info: Optional[str] = None) -> str:
        """Saves user feedback / bug report to PostgreSQL."""
        import uuid
        fb_id = f"fb_{uuid.uuid4().hex[:12]}"
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO user_feedbacks (id, user_id, user_email, feedback_type, message, page_url, device_info, status, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'new', NOW());
                """, (fb_id, user_id, user_email, feedback_type, message, page_url, device_info))
                conn.commit()
        return fb_id

    def get_feedbacks(self, limit: int = 100, status: Optional[str] = None, feedback_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves recent user feedbacks from PostgreSQL with optional filtering."""
        from psycopg2 import extras
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                clauses = []
                params = []
                if status and status.lower() != 'all':
                    clauses.append("LOWER(status) = LOWER(%s)")
                    params.append(status)
                if feedback_type and feedback_type.lower() != 'all':
                    clauses.append("LOWER(feedback_type) = LOWER(%s)")
                    params.append(feedback_type)
                
                where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
                query = f"""
                    SELECT * FROM user_feedbacks
                    {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s;
                """
                params.append(limit)
                cursor.execute(query, tuple(params))
                return [dict(r) for r in cursor.fetchall()]

    def update_feedback(self, feedback_id: str, status: Optional[str] = None, admin_notes: Optional[str] = None, message: Optional[str] = None, feedback_type: Optional[str] = None) -> bool:
        """Updates status, admin notes, or message of a feedback entry."""
        if not feedback_id:
            return False
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                updates = ["updated_at = NOW()"]
                params = []
                if status is not None:
                    updates.append("status = %s")
                    params.append(status)
                if admin_notes is not None:
                    updates.append("admin_notes = %s")
                    params.append(admin_notes)
                if message is not None:
                    updates.append("message = %s")
                    params.append(message)
                if feedback_type is not None:
                    updates.append("feedback_type = %s")
                    params.append(feedback_type)
                
                params.append(feedback_id)
                query = f"UPDATE user_feedbacks SET {', '.join(updates)} WHERE id = %s;"
                cursor.execute(query, tuple(params))
                conn.commit()
                return cursor.rowcount > 0

    def delete_feedback(self, feedback_id: str) -> bool:
        """Deletes a feedback entry from PostgreSQL."""
        if not feedback_id:
            return False
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM user_feedbacks WHERE id = %s;", (feedback_id,))
                conn.commit()
                return cursor.rowcount > 0

    # ---------------------------------------------------------
    # OMNICONNECT & LOCAL SPARRING RADAR
    # ---------------------------------------------------------

    def get_lfg_profile(self, user_id: str) -> Dict[str, Any]:
        """Gets or builds default LFG profile for a user."""
        if not user_id:
            return {}
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT * FROM player_lfg_profiles WHERE player_id = %s;
                """, (user_id,))
                row = cursor.fetchone()
                if row:
                    return dict(row)
                
                # Check user details & default city from match history
                cursor.execute("SELECT id, display_name, email, player_id FROM users WHERE id = %s;", (user_id,))
                u = cursor.fetchone()
                bcp_pid = (u.get("player_id") or u.get("id")) if u else user_id

                # Try inferring location from most played events
                cursor.execute("""
                    SELECT e.city, e.state, e.country, e.latitude, e.longitude, COUNT(*) as cnt
                    FROM event_participants ep
                    JOIN events e ON ep.event_id = e.id
                    WHERE ep.player_id = %s AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
                    GROUP BY e.city, e.state, e.country, e.latitude, e.longitude
                    ORDER BY cnt DESC, MAX(e.event_date) DESC
                    LIMIT 1;
                """, (bcp_pid,))
                loc = cursor.fetchone()
                return {
                    "player_id": user_id,
                    "is_active": False,
                    "home_venue_name": "",
                    "address": "",
                    "city": loc.get("city") if loc else "San Diego",
                    "state": loc.get("state") if loc else "CA",
                    "country": loc.get("country") if loc else "United States",
                    "postal_code": "",
                    "latitude": float(loc["latitude"]) if loc and loc.get("latitude") is not None else 32.7157,
                    "longitude": float(loc["longitude"]) if loc and loc.get("longitude") is not None else -117.1611,
                    "radius_miles": 30,
                    "preferred_points": 2000,
                    "play_style": "Competitive",
                    "availability_notes": "",
                    "factions": ""
                }

    def save_lfg_profile(self, user_id: str, data: Dict[str, Any]) -> bool:
        """Upserts user's LFG matchmaking profile."""
        if not user_id:
            return False
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO player_lfg_profiles (
                        player_id, is_active, home_venue_name, address, city, state, country,
                        postal_code, latitude, longitude, radius_miles, preferred_points,
                        play_style, availability_notes, factions, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, NOW()
                    )
                    ON CONFLICT (player_id) DO UPDATE SET
                        is_active = EXCLUDED.is_active,
                        home_venue_name = EXCLUDED.home_venue_name,
                        address = EXCLUDED.address,
                        city = EXCLUDED.city,
                        state = EXCLUDED.state,
                        country = EXCLUDED.country,
                        postal_code = EXCLUDED.postal_code,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        radius_miles = EXCLUDED.radius_miles,
                        preferred_points = EXCLUDED.preferred_points,
                        play_style = EXCLUDED.play_style,
                        availability_notes = EXCLUDED.availability_notes,
                        factions = EXCLUDED.factions,
                        updated_at = NOW();
                """, (
                    user_id,
                    bool(data.get("is_active", False)),
                    data.get("home_venue_name") or "",
                    data.get("address") or "",
                    data.get("city") or "",
                    data.get("state") or "",
                    data.get("country") or "United States",
                    data.get("postal_code") or "",
                    float(data["latitude"]) if data.get("latitude") is not None else None,
                    float(data["longitude"]) if data.get("longitude") is not None else None,
                    int(data.get("radius_miles") or 30),
                    int(data.get("preferred_points") or 2000),
                    data.get("play_style") or "Competitive",
                    data.get("availability_notes") or "",
                    data.get("factions") or ""
                ))
                conn.commit()
                return True

    def search_nearby_lfg_players(
        self,
        current_user_id: str,
        lat: float,
        lng: float,
        radius_miles: float = 50.0,
        elo_bracket: Optional[str] = None,
        play_style: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Finds nearby opt-in players looking for games, ranked by distance & Elo."""
        if lat is None or lng is None:
            return []
        
        # Haversine distance in SQL
        distance_sql = """
            (3959 * acos(
                LEAST(1.0, GREATEST(-1.0, 
                    cos(radians(%s)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(%s)) +
                    sin(radians(%s)) * sin(radians(p.latitude))
                ))
            ))
        """
        query = f"""
            SELECT 
                p.player_id,
                u.display_name,
                u.email,
                p.is_active,
                p.home_venue_name,
                p.address,
                p.city,
                p.state,
                p.latitude,
                p.longitude,
                p.radius_miles,
                p.preferred_points,
                p.play_style,
                p.availability_notes,
                p.factions,
                p.updated_at,
                COALESCE(pr.current_elo, 1500.0) as current_elo,
                pr.peak_elo,
                pr.matches_played,
                pr.win_rate,
                pr.top_faction,
                ROUND({distance_sql}::numeric, 1) as distance_miles,
                mr.id as existing_request_id,
                mr.status as existing_request_status,
                mr.sender_id as existing_request_sender_id
            FROM player_lfg_profiles p
            JOIN users u ON p.player_id = u.id
            LEFT JOIN player_ratings pr ON (u.player_id = pr.player_id OR u.id = pr.player_id)
            LEFT JOIN match_requests mr ON (
                (mr.sender_id = %s AND mr.receiver_id = p.player_id) OR
                (mr.receiver_id = %s AND mr.sender_id = p.player_id)
            ) AND mr.status != 'declined'
            WHERE p.is_active = TRUE
              AND p.player_id != %s
              AND p.latitude IS NOT NULL 
              AND p.longitude IS NOT NULL
              AND {distance_sql} <= %s
        """
        params = [
            lat, lng, lat,
            current_user_id, current_user_id, current_user_id,
            lat, lng, lat, radius_miles
        ]

        if play_style and play_style.strip() and play_style.lower() != 'all':
            query += " AND LOWER(p.play_style) = %s"
            params.append(play_style.strip().lower())

        query += " ORDER BY distance_miles ASC, current_elo DESC LIMIT 50;"

        results = []
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute(query, tuple(params))
                for row in cursor.fetchall():
                    r = dict(row)
                    r["distance_miles"] = float(r["distance_miles"]) if r.get("distance_miles") is not None else 0.0
                    r["current_elo"] = float(r["current_elo"]) if r.get("current_elo") is not None else 1500.0
                    results.append(r)
        return results

    def get_user_for_player(self, player_id: str, player_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Finds if a player is registered as an OmniTactica user."""
        if not player_id and not player_name:
            return None
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                # 1. Match by player_id, bcp_user_id, or user id
                cursor.execute("""
                    SELECT id, display_name, email, role, player_id, bcp_user_id, created_at
                    FROM users
                    WHERE (player_id IS NOT NULL AND player_id != '' AND player_id = %s)
                       OR (bcp_user_id IS NOT NULL AND bcp_user_id != '' AND bcp_user_id = %s)
                       OR id = %s
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """, (player_id, player_id, player_id))
                user = cursor.fetchone()
                if user:
                    return dict(user)

                # 2. Fallback match by exact player name (case-insensitive) if provided
                if player_name and player_name.strip():
                    name_clean = player_name.strip()
                    cursor.execute("""
                        SELECT id, display_name, email, role, player_id, bcp_user_id, created_at
                        FROM users
                        WHERE LOWER(display_name) = LOWER(%s)
                        ORDER BY updated_at DESC
                        LIMIT 1;
                    """, (name_clean,))
                    user = cursor.fetchone()
                    if user:
                        return dict(user)
        return None

    def get_existing_match_request(self, user1_id: str, user2_id: str) -> Optional[Dict[str, Any]]:
        """Gets active or pending match request between two users."""
        if not user1_id or not user2_id:
            return None
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT id, status, sender_id, receiver_id, proposed_venue, proposed_points, proposed_date, note, created_at, updated_at
                    FROM match_requests
                    WHERE ((sender_id = %s AND receiver_id = %s) OR (sender_id = %s AND receiver_id = %s))
                      AND status IN ('pending', 'accepted')
                    ORDER BY updated_at DESC
                    LIMIT 1;
                """, (user1_id, user2_id, user2_id, user1_id))
                row = cursor.fetchone()
                return dict(row) if row else None

    def create_match_request(
        self,
        sender_id: str,
        receiver_id: str,
        proposed_venue: str = "",
        proposed_points: int = 2000,
        proposed_date: str = "",
        note: str = ""
    ) -> Dict[str, Any]:
        """Creates a pending sparring match request between players."""
        if not sender_id or not receiver_id:
            return {"success": False, "error": "Invalid participants"}

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                # 1. Resolve receiver_id to a valid users.id
                cursor.execute("""
                    SELECT id FROM users
                    WHERE id = %s
                       OR (player_id IS NOT NULL AND player_id != '' AND player_id = %s)
                       OR (bcp_user_id IS NOT NULL AND bcp_user_id != '' AND bcp_user_id = %s)
                    LIMIT 1;
                """, (receiver_id, receiver_id, receiver_id))
                user_match = cursor.fetchone()

                if not user_match:
                    # Fallback check display_name
                    cursor.execute("""
                        SELECT id FROM users WHERE LOWER(display_name) = LOWER(%s) LIMIT 1;
                    """, (receiver_id,))
                    user_match = cursor.fetchone()

                if not user_match:
                    return {
                        "success": False,
                        "error": "This player is not registered on OmniTactica. Chat requests can only be sent to registered OmniTactica users."
                    }

                resolved_receiver_id = user_match["id"]
                if sender_id == resolved_receiver_id:
                    return {"success": False, "error": "Cannot send a chat request to yourself"}

                # Check existing request
                cursor.execute("""
                    SELECT id, status FROM match_requests
                    WHERE ((sender_id = %s AND receiver_id = %s) OR (sender_id = %s AND receiver_id = %s))
                      AND status IN ('pending', 'accepted');
                """, (sender_id, resolved_receiver_id, resolved_receiver_id, sender_id))
                existing = cursor.fetchone()
                if existing:
                    if existing["status"] == "accepted":
                        return {
                            "success": True,
                            "already_connected": True,
                            "request_id": existing["id"],
                            "status": "accepted"
                        }
                    return {
                        "success": False,
                        "error": "A chat request is already pending with this player",
                        "request_id": existing["id"],
                        "status": existing["status"]
                    }

                import uuid
                req_id = f"mrq_{uuid.uuid4().hex[:16]}"
                cursor.execute("""
                    INSERT INTO match_requests (
                        id, sender_id, receiver_id, status, proposed_venue,
                        proposed_points, proposed_date, note, created_at, updated_at
                    ) VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id;
                """, (req_id, sender_id, resolved_receiver_id, proposed_venue or "", proposed_points or 2000, proposed_date or "", note or ""))
                conn.commit()
                return {"success": True, "request_id": req_id}

    def respond_match_request(self, request_id: str, user_id: str, action: str, reply_message: Optional[str] = None) -> Dict[str, Any]:
        """Accepts, declines, or blocks a match request."""
        action = action.lower().strip()
        if action not in ("accept", "decline", "block"):
            return {"success": False, "error": "Action must be accept, decline, or block"}

        new_status = "accepted" if action == "accept" else ("declined" if action == "decline" else "blocked")
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT * FROM match_requests WHERE id = %s;
                """, (request_id,))
                req = cursor.fetchone()
                if not req:
                    return {"success": False, "error": "Request not found"}

                # Receiver can accept/decline; either party can block
                if action in ("accept", "decline") and req["receiver_id"] != user_id:
                    return {"success": False, "error": "Only the recipient can accept or decline this request"}

                cursor.execute("""
                    UPDATE match_requests
                    SET status = %s, updated_at = NOW()
                    WHERE id = %s;
                """, (new_status, request_id))

                if action == "accept":
                    import uuid
                    # 1. Insert original note into chat if present
                    if req.get("note") and req["note"].strip():
                        cursor.execute("SELECT id FROM match_chat_messages WHERE request_id = %s LIMIT 1;", (request_id,))
                        if not cursor.fetchone():
                            cursor.execute("""
                                INSERT INTO match_chat_messages (id, request_id, sender_id, message_text, created_at)
                                VALUES (%s, %s, %s, %s, %s);
                            """, (f"msg_{uuid.uuid4().hex[:16]}", request_id, req["sender_id"], req["note"].strip(), req["created_at"]))

                    # 2. Insert recipient's reply message if provided
                    if reply_message and reply_message.strip():
                        cursor.execute("""
                            INSERT INTO match_chat_messages (id, request_id, sender_id, message_text, created_at)
                            VALUES (%s, %s, %s, %s, NOW());
                        """, (f"msg_{uuid.uuid4().hex[:16]}", request_id, user_id, reply_message.strip()))

                conn.commit()
                return {"success": True, "status": new_status}

    def get_user_match_requests(self, user_id: str) -> List[Dict[str, Any]]:
        """Retrieves all active, pending, and accepted requests for the user."""
        if not user_id:
            return []
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT 
                        mr.id,
                        mr.sender_id,
                        mr.receiver_id,
                        mr.status,
                        mr.proposed_venue,
                        mr.proposed_points,
                        mr.proposed_date,
                        mr.note,
                        mr.created_at,
                        mr.updated_at,
                        su.display_name as sender_name,
                        su.email as sender_email,
                        ru.display_name as receiver_name,
                        ru.email as receiver_email,
                        COALESCE(spr.current_elo, 1500.0) as sender_elo,
                        spr.top_faction as sender_faction,
                        COALESCE(rpr.current_elo, 1500.0) as receiver_elo,
                        rpr.top_faction as receiver_faction,
                        (SELECT COUNT(*) FROM match_chat_messages mcm 
                         WHERE mcm.request_id = mr.id AND mcm.sender_id != %s AND mcm.read_at IS NULL) as unread_count,
                        COALESCE(
                            (SELECT message_text FROM match_chat_messages mcm 
                             WHERE mcm.request_id = mr.id ORDER BY mcm.created_at DESC LIMIT 1),
                            mr.note
                        ) as last_message,
                        COALESCE(
                            (SELECT created_at FROM match_chat_messages mcm 
                             WHERE mcm.request_id = mr.id ORDER BY mcm.created_at DESC LIMIT 1),
                            mr.created_at
                        ) as last_message_time
                    FROM match_requests mr
                    JOIN users su ON mr.sender_id = su.id
                    JOIN users ru ON mr.receiver_id = ru.id
                    LEFT JOIN player_ratings spr ON (su.player_id = spr.player_id OR su.id = spr.player_id)
                    LEFT JOIN player_ratings rpr ON (ru.player_id = rpr.player_id OR ru.id = rpr.player_id)
                    WHERE (mr.sender_id = %s OR mr.receiver_id = %s)
                      AND mr.status != 'declined'
                    ORDER BY mr.updated_at DESC;
                """, (user_id, user_id, user_id))
                return [dict(r) for r in cursor.fetchall()]

    def get_chat_messages(self, request_id: str, user_id: str) -> Dict[str, Any]:
        """Gets chat thread for an accepted match request and marks unread as read."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT mr.*, 
                           su.display_name as sender_name,
                           ru.display_name as receiver_name
                    FROM match_requests mr
                    JOIN users su ON mr.sender_id = su.id
                    JOIN users ru ON mr.receiver_id = ru.id
                    WHERE mr.id = %s;
                """, (request_id,))
                req = cursor.fetchone()
                if not req:
                    return {"success": False, "error": "Conversation not found"}

                if user_id not in (req["sender_id"], req["receiver_id"]):
                    return {"success": False, "error": "Unauthorized"}

                if req["status"] != "accepted":
                    return {"success": False, "error": f"Chat is not active. Status: {req['status']}"}

                # Mark other user's messages as read
                cursor.execute("""
                    UPDATE match_chat_messages
                    SET read_at = NOW()
                    WHERE request_id = %s AND sender_id != %s AND read_at IS NULL;
                """, (request_id, user_id))
                conn.commit()

                # Fetch chronological messages
                cursor.execute("""
                    SELECT 
                        mcm.id,
                        mcm.request_id,
                        mcm.sender_id,
                        u.display_name as sender_name,
                        mcm.message_text,
                        mcm.room_key,
                        mcm.created_at,
                        mcm.read_at
                    FROM match_chat_messages mcm
                    JOIN users u ON mcm.sender_id = u.id
                    WHERE mcm.request_id = %s
                    ORDER BY mcm.created_at ASC;
                """, (request_id,))
                messages = [dict(m) for m in cursor.fetchall()]

                other_user_id = req["receiver_id"] if user_id == req["sender_id"] else req["sender_id"]
                other_user_name = req["receiver_name"] if user_id == req["sender_id"] else req["sender_name"]

                return {
                    "success": True,
                    "request": dict(req),
                    "other_user_id": other_user_id,
                    "other_user_name": other_user_name,
                    "messages": messages
                }

    def send_chat_message(self, request_id: str, sender_id: str, message_text: str, room_key: Optional[str] = None, message_id: Optional[str] = None) -> Dict[str, Any]:
        """Appends a new chat message to an accepted match request."""
        if not message_text and not room_key:
            return {"success": False, "error": "Message content cannot be empty"}

        import uuid
        msg_id = message_id.strip() if (message_id and isinstance(message_id, str)) else f"msg_{uuid.uuid4().hex[:16]}"
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("SELECT sender_id, receiver_id, status FROM match_requests WHERE id = %s;", (request_id,))
                req = cursor.fetchone()
                if not req:
                    return {"success": False, "error": "Request not found"}

                if sender_id not in (req["sender_id"], req["receiver_id"]):
                    return {"success": False, "error": "Unauthorized"}

                if req["status"] != "accepted":
                    return {"success": False, "error": "Cannot message on an unaccepted request"}

                cursor.execute("""
                    INSERT INTO match_chat_messages (
                        id, request_id, sender_id, message_text, room_key, created_at
                    ) VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO NOTHING
                    RETURNING id, created_at;
                """, (msg_id, request_id, sender_id, (message_text or '').strip(), room_key.strip() if room_key else None))
                row = cursor.fetchone()
                if not row:
                    cursor.execute("SELECT created_at FROM match_chat_messages WHERE id = %s;", (msg_id,))
                    row = cursor.fetchone()

                cursor.execute("UPDATE match_requests SET updated_at = NOW() WHERE id = %s;", (request_id,))
                conn.commit()
                created_at = row["created_at"] if row else None
                created_at_str = created_at.isoformat() if hasattr(created_at, "isoformat") else (str(created_at) if created_at else None)
                return {"success": True, "message_id": msg_id, "created_at": created_at_str}

    def get_connect_unread_count(self, user_id: str) -> int:
        """Returns total unread match requests and chat messages for user."""
        if not user_id:
            return 0
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        (SELECT COUNT(*) FROM match_requests WHERE receiver_id = %s AND status = 'pending') +
                        (SELECT COUNT(*) FROM match_chat_messages mcm
                         JOIN match_requests mr ON mcm.request_id = mr.id
                         WHERE (mr.sender_id = %s OR mr.receiver_id = %s)
                           AND mcm.sender_id != %s
                           AND mcm.read_at IS NULL
                        ) as total_unread;
                """, (user_id, user_id, user_id, user_id))
                row = cursor.fetchone()
                return int(row[0]) if row and row[0] is not None else 0

    def find_chat_room_key(self, room_key: str) -> Optional[Dict[str, Any]]:
        """Finds metadata for a room_key issued in chat to auto-recover orphaned room invites."""
        if not room_key:
            return None
        room_key = room_key.strip().upper()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor if extras else None) as cursor:
                cursor.execute("""
                    SELECT mcm.room_key, mcm.request_id, mcm.sender_id, mcm.created_at,
                           mr.sender_id AS req_sender_id, mr.receiver_id AS req_receiver_id,
                           su.display_name AS sender_name, ru.display_name AS receiver_name,
                           spr.top_faction AS sender_faction, rpr.top_faction AS receiver_faction
                    FROM match_chat_messages mcm
                    LEFT JOIN match_requests mr ON mcm.request_id = mr.id
                    LEFT JOIN users su ON mr.sender_id = su.id
                    LEFT JOIN users ru ON mr.receiver_id = ru.id
                    LEFT JOIN player_ratings spr ON (su.player_id = spr.player_id OR su.id = spr.player_id)
                    LEFT JOIN player_ratings rpr ON (ru.player_id = rpr.player_id OR ru.id = rpr.player_id)
                    WHERE UPPER(mcm.room_key) = %s
                    ORDER BY mcm.created_at DESC LIMIT 1;
                """, (room_key,))
                row = cursor.fetchone()
                return dict(row) if row else None


    # =========================================================================
    # REGIONAL COMMUNITY HUB & COMPETITOR DISCOVERY
    # =========================================================================
    # COMMUNITY HUB: GPS RADIUS TOURNAMENT & LOCAL COMPETITOR DISCOVERY
    # =========================================================================

    KNOWN_COMMUNITY_HUBS = {
        "san diego": (32.7157, -117.1611, "San Diego, CA"),
        "socal": (32.7157, -117.1611, "Southern California"),
        "los angeles": (34.0522, -118.2437, "Los Angeles, CA"),
        "orange county": (33.7175, -117.8311, "Orange County, CA"),
        "temecula": (33.4936, -117.1484, "Temecula, CA"),
        "pasadena": (34.1478, -118.1445, "Pasadena, CA"),
        "burbank": (34.1808, -118.3090, "Burbank, CA"),
        "anaheim": (33.8366, -117.9143, "Anaheim, CA"),
        "long beach": (33.7701, -118.1937, "Long Beach, CA"),
        "irvine": (33.6846, -117.8265, "Irvine, CA"),
        "riverside": (33.9806, -117.3755, "Riverside, CA"),
        "san francisco": (37.7749, -122.4194, "San Francisco, CA"),
        "norcal": (37.7749, -122.4194, "Northern California"),
        "san jose": (37.3382, -121.8863, "San Jose, CA"),
        "sacramento": (38.5816, -121.4944, "Sacramento, CA"),
        "austin": (30.2672, -97.7431, "Austin, TX"),
        "texas": (30.2672, -97.7431, "Texas"),
        "dallas": (32.7767, -96.7970, "Dallas, TX"),
        "houston": (29.7604, -95.3698, "Houston, TX"),
        "san antonio": (29.4241, -98.4936, "San Antonio, TX"),
        "chicago": (41.8781, -87.6298, "Chicago, IL"),
        "midwest": (41.8781, -87.6298, "Midwest"),
        "seattle": (47.6062, -122.3321, "Seattle, WA"),
        "portland": (45.5152, -122.6784, "Portland, OR"),
        "pnw": (47.6062, -122.3321, "Pacific Northwest"),
        "denver": (39.7392, -104.9903, "Denver, CO"),
        "phoenix": (33.4484, -112.0740, "Phoenix, AZ"),
        "las vegas": (36.1699, -115.1398, "Las Vegas, NV"),
        "minneapolis": (44.9778, -93.2650, "Minneapolis, MN"),
        "new york": (40.7128, -74.0060, "New York, NY"),
        "nyc": (40.7128, -74.0060, "New York, NY"),
        "philadelphia": (39.9526, -75.1652, "Philadelphia, PA"),
        "boston": (42.3601, -71.0589, "Boston, MA"),
        "northeast": (40.7128, -74.0060, "Northeast"),
        "atlanta": (33.7490, -84.3880, "Atlanta, GA"),
        "orlando": (28.5383, -81.3792, "Orlando, FL"),
        "miami": (25.7617, -80.1918, "Miami, FL"),
        "charlotte": (35.2271, -80.8431, "Charlotte, NC"),
        "columbus": (39.9612, -82.9988, "Columbus, OH"),
        "southeast": (33.7490, -84.3880, "Southeast"),
        "toronto": (43.6532, -79.3832, "Toronto, Canada"),
        "vancouver": (49.2827, -123.1207, "Vancouver, Canada"),
        "london": (51.5074, -0.1278, "London, UK"),
        "manchester": (53.4808, -2.2426, "Manchester, UK"),
        "paris": (48.8566, 2.3522, "Paris, France"),
        "sydney": (-33.8688, 151.2093, "Sydney, Australia"),
        "melbourne": (-37.8136, 144.9631, "Melbourne, Australia"),
        "uk": (51.5074, -0.1278, "United Kingdom")
    }

    COMMUNITY_REGIONS = [
        {"id": "socal", "name": "Southern California", "badge": "🌴 SoCal", "description": "Los Angeles, San Diego, Orange County", "lat": 32.7157, "lng": -117.1611},
        {"id": "norcal", "name": "Northern California", "badge": "🌉 NorCal", "description": "San Francisco, Bay Area, Sacramento", "lat": 37.7749, "lng": -122.4194},
        {"id": "texas", "name": "Texas Metro", "badge": "⭐ Texas", "description": "Dallas, Austin, Houston, San Antonio", "lat": 30.2672, "lng": -97.7431},
        {"id": "midwest", "name": "Midwest", "badge": "🏙️ Midwest", "description": "Chicago, Indianapolis, Great Lakes", "lat": 41.8781, "lng": -87.6298},
        {"id": "northeast", "name": "Northeast", "badge": "🗽 Northeast", "description": "New York, Philadelphia, Boston, DC", "lat": 40.7128, "lng": -74.0060},
        {"id": "pnw", "name": "Pacific Northwest", "badge": "🌲 PNW", "description": "Seattle, Portland, Vancouver", "lat": 47.6062, "lng": -122.3321},
        {"id": "southeast", "name": "Southeast", "badge": "☀️ Southeast", "description": "Atlanta, Orlando, Miami, Charlotte", "lat": 33.7490, "lng": -84.3880},
        {"id": "uk", "name": "United Kingdom", "badge": "🏰 UK", "description": "London, Manchester, Midlands", "lat": 51.5074, "lng": -0.1278}
    ]

    def get_community_regions(self) -> List[Dict[str, Any]]:
        """Returns standard regional hubs for community selection."""
        return self.COMMUNITY_REGIONS

    def fetch_bcp_upcoming_events(
        self,
        user_lat: float,
        user_lng: float,
        radius_miles: float = 50.0,
        days_ahead: int = 92
    ) -> List[Dict[str, Any]]:
        """
        Queries live upcoming Warhammer 40k events directly from the Best Coast Pairings (BCP) API
        for the specified GPS coordinates and radius, looking ahead up to days_ahead (default 92 days / ~3 months),
        starting from yesterday (to capture ongoing multi-day weekend tournaments).
        """
        if user_lat is None or user_lng is None:
            return []

        effective_radius = max(5, int(round(radius_miles)))
        cache_key = (
            round(user_lat, 2),
            round(user_lng, 2),
            effective_radius,
            days_ahead
        )
        cached = PostgresDatabase.get_cached(PostgresDatabase._bcp_upcoming_cache_dict, cache_key, ttl=300)
        if cached is not None:
            return list(cached)

        now_utc = datetime.now(timezone.utc)
        # Start from yesterday (24h back) to capture ongoing multi-day weekend events
        start_iso = (now_utc - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00.000Z")
        end_iso = (now_utc + timedelta(days=days_ahead)).strftime("%Y-%m-%dT23:59:59.999Z")

        params = {
            "limit": 50,
            "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
            "startDate": start_iso,
            "endDate": end_iso,
            "excludeOnline": "true",
            "sortKey": "eventDate",
            "sortAscending": "true",
            "location": json.dumps({
                "distance": effective_radius,
                "distanceType": "miles",
                "center": {
                    "lat": str(user_lat),
                    "long": str(user_lng)
                }
            })
        }

        headers = DEFAULT_HEADERS.copy()
        raw_events = []
        next_key = None

        for _ in range(2):  # Cap to 2 pages (up to 100 events) - page 1 has 50, UI displays up to 35
            if next_key:
                params["nextKey"] = next_key
            url = f"{BCP_API_BASE}/events?{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    evs = data.get("data", [])
                    if not evs:
                        break
                    raw_events.extend(evs)
                    if len(raw_events) >= 35:
                        break
                    next_key = data.get("nextKey")
                    if not next_key:
                        break
            except Exception as e:
                logger.warning(f"Live BCP upcoming events query notice for ({user_lat}, {user_lng}): {e}")
                break

        normalized_events = []
        seen_ids = set()

        for ev in raw_events:
            eid = str(ev.get("id") or ev.get("objectId") or "")
            if not eid or eid in seen_ids:
                continue
            seen_ids.add(eid)

            loc_obj = ev.get("location") if isinstance(ev.get("location"), dict) else {}
            venue = (
                ev.get("venue") or ev.get("venue_name") or
                loc_obj.get("name") or loc_obj.get("venue") or ""
            )
            city = ev.get("city") or loc_obj.get("city") or ""
            state = ev.get("state") or loc_obj.get("state") or ""
            country = ev.get("country") or loc_obj.get("country") or ""

            # Coordinates parsing: BCP GeoJSON format is [longitude, latitude]
            ev_lat, ev_lng = None, None
            coord = ev.get("coordinate")
            if not coord and isinstance(loc_obj.get("coordinate"), list):
                coord = loc_obj.get("coordinate")

            if isinstance(coord, list) and len(coord) >= 2:
                try:
                    ev_lng = float(coord[0])
                    ev_lat = float(coord[1])
                except (ValueError, TypeError):
                    ev_lat, ev_lng = None, None
            elif ev.get("latitude") is not None and ev.get("longitude") is not None:
                try:
                    ev_lat = float(ev["latitude"])
                    ev_lng = float(ev["longitude"])
                except (ValueError, TypeError):
                    ev_lat, ev_lng = None, None
            elif loc_obj.get("latitude") is not None and loc_obj.get("longitude") is not None:
                try:
                    ev_lat = float(loc_obj["latitude"])
                    ev_lng = float(loc_obj["longitude"])
                except (ValueError, TypeError):
                    ev_lat, ev_lng = None, None

            # Haversine distance calculation in miles
            dist_miles = None
            if ev_lat is not None and ev_lng is not None and not (ev_lat == 0.0 and ev_lng == 0.0):
                try:
                    R = 3959.0
                    dlat = math.radians(ev_lat - user_lat)
                    dlng = math.radians(ev_lng - user_lng)
                    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(ev_lat)) * math.sin(dlng / 2.0) ** 2
                    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
                    dist_miles = round(R * c, 1)
                except Exception:
                    dist_miles = None

            # Safety filter: if coordinates exist and calculated distance exceeds radius * 1.25, exclude it
            if dist_miles is not None and dist_miles > (effective_radius * 1.25):
                continue

            event_date = ev.get("eventDate") or ev.get("event_date")
            end_date = ev.get("endDate") or ev.get("end_date")
            if hasattr(event_date, "isoformat"):
                event_date = event_date.isoformat()
            if hasattr(end_date, "isoformat"):
                end_date = end_date.isoformat()

            total_players = 0
            try:
                total_players = int(ev.get("totalPlayers") or ev.get("total_players") or ev.get("enrolled_count") or 0)
            except (ValueError, TypeError):
                total_players = 0

            num_rounds = 0
            try:
                num_rounds = int(ev.get("numberOfRounds") or ev.get("num_rounds") or 0)
            except (ValueError, TypeError):
                num_rounds = 0

            current_round = 0
            try:
                current_round = int(ev.get("currentRound") or ev.get("current_round") or 0)
            except (ValueError, TypeError):
                current_round = 0

            is_ended = bool(ev.get("isEnded") or ev.get("is_ended") or False)
            circuits = ev.get("circuits") or []

            normalized_events.append({
                "id": eid,
                "name": ev.get("name") or "Tournament",
                "event_date": event_date,
                "end_date": end_date,
                "city": city,
                "state": state,
                "country": country,
                "venue": venue,
                "total_players": total_players,
                "num_rounds": num_rounds,
                "current_round": current_round,
                "is_ended": is_ended,
                "circuits": circuits,
                "distance_miles": dist_miles,
                "event_group": "upcoming"
            })

        PostgresDatabase.set_cached(PostgresDatabase._bcp_upcoming_cache_dict, cache_key, normalized_events)
        return normalized_events

    def get_community_overview(
        self,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        radius_miles: float = 50.0,
        location_name: Optional[str] = None,
        region: Optional[str] = None,
        current_user_id: Optional[str] = None,
        current_player_id: Optional[str] = None,
        include_bcp: bool = False
    ) -> Dict[str, Any]:
        """
        Builds complete community hub payload based on GPS location and search radius:
        - Upcoming & ongoing tournaments within radius (event_date >= CURRENT_DATE - INTERVAL '1 day')
        - Recent tournament history & field ratings within radius (event_date < CURRENT_DATE - INTERVAL '1 day')
        - Local community leaderboard derived exclusively from competitors who played in those tournaments
        - Local competitors discovered via tournament participation
        """
        try:
            radius_miles = float(radius_miles or 50.0)
        except (ValueError, TypeError):
            radius_miles = 50.0
        radius_miles = max(5.0, min(radius_miles, 1000.0))

        user_lat = None
        user_lng = None
        if lat is not None and lng is not None:
            try:
                user_lat = float(lat)
                user_lng = float(lng)
            except (ValueError, TypeError):
                user_lat = None
                user_lng = None

        # Safeguard against stale client form coordinates / city mismatches:
        # If user_lat and user_lng are provided along with location_name:
        if user_lat is not None and user_lng is not None and location_name:
            loc_lower = location_name.strip().lower()
            first_tok = loc_lower.split(',')[0].strip()
            matched_hub = None
            if loc_lower in self.KNOWN_COMMUNITY_HUBS:
                matched_hub = self.KNOWN_COMMUNITY_HUBS[loc_lower]
            elif first_tok in self.KNOWN_COMMUNITY_HUBS:
                matched_hub = self.KNOWN_COMMUNITY_HUBS[first_tok]
            else:
                for k, v in self.KNOWN_COMMUNITY_HUBS.items():
                    if k in loc_lower or loc_lower in k:
                        matched_hub = v
                        break

            if matched_hub:
                hub_lat, hub_lng, hub_name = matched_hub
                # Haversine distance between client coordinates and matched hub coordinates
                R = 3959.0
                dlat = math.radians(hub_lat - user_lat)
                dlng = math.radians(hub_lng - user_lng)
                a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(hub_lat)) * math.sin(dlng / 2.0) ** 2
                c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
                dist_to_hub = R * c
                if dist_to_hub > 75.0:
                    logger.info(f"Overriding stale user coordinates ({user_lat}, {user_lng}) for '{location_name}' with hub '{hub_name}' ({hub_lat}, {hub_lng}) [dist={dist_to_hub:.1f}mi]")
                    user_lat = hub_lat
                    user_lng = hub_lng
            elif abs(user_lat - 32.7157) < 0.005 and abs(user_lng - (-117.1611)) < 0.005:
                if "san diego" not in loc_lower and "socal" not in loc_lower:
                    user_lat = None
                    user_lng = None

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                # 1. Resolve user coordinates if missing
                if (user_lat is None or user_lng is None) and current_user_id:
                    cursor.execute("""
                        SELECT latitude, longitude, city, state, home_venue_name
                        FROM player_lfg_profiles
                        WHERE player_id = %s AND latitude IS NOT NULL AND longitude IS NOT NULL;
                    """, (current_user_id,))
                    p_row = cursor.fetchone()
                    if p_row:
                        user_lat = float(p_row["latitude"])
                        user_lng = float(p_row["longitude"])
                        if not location_name:
                            location_name = p_row.get("home_venue_name") or f"{p_row.get('city')}, {p_row.get('state')}"

                if (user_lat is None or user_lng is None) and current_player_id:
                    # Check explicit profile location for player
                    cursor.execute("""
                        SELECT p.latitude, p.longitude, p.city, p.state, p.home_venue_name
                        FROM player_lfg_profiles p
                        WHERE p.player_id = %s AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                        UNION ALL
                        SELECT p.latitude, p.longitude, p.city, p.state, p.home_venue_name
                        FROM player_lfg_profiles p
                        JOIN users u ON u.id = p.player_id
                        WHERE u.player_id = %s AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                        LIMIT 1;
                    """, (current_player_id, current_player_id))
                    p_row2 = cursor.fetchone()
                    if p_row2:
                        user_lat = float(p_row2["latitude"])
                        user_lng = float(p_row2["longitude"])
                        if not location_name:
                            location_name = p_row2.get("home_venue_name") or f"{p_row2.get('city')}, {p_row2.get('state')}"

                # Only if explicit profile is missing, fallback to tournament match history
                if (user_lat is None or user_lng is None) and current_player_id:
                    cursor.execute("""
                        SELECT e.latitude, e.longitude, e.city, e.state, COUNT(*) as cnt
                        FROM event_participants ep
                        JOIN events e ON ep.event_id = e.id
                        WHERE ep.player_id = %s AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
                        GROUP BY e.latitude, e.longitude, e.city, e.state
                        ORDER BY cnt DESC, MAX(e.event_date) DESC
                        LIMIT 1;
                    """, (current_player_id,))
                    e_loc = cursor.fetchone()
                    if e_loc and e_loc.get("latitude") and e_loc.get("longitude"):
                        user_lat = float(e_loc["latitude"])
                        user_lng = float(e_loc["longitude"])
                        if not location_name:
                            location_name = f"{e_loc.get('city')}, {e_loc.get('state')}"

                if user_lat is None or user_lng is None:
                    raw_loc = (region or location_name or "san diego").strip().lower()
                    
                    # 1. Exact match
                    if raw_loc in self.KNOWN_COMMUNITY_HUBS:
                        hub_lat, hub_lng, hub_name = self.KNOWN_COMMUNITY_HUBS[raw_loc]
                        user_lat, user_lng = hub_lat, hub_lng
                        if not location_name:
                            location_name = hub_name
                    else:
                        # 2. Token or substring match (e.g. "Seattle, WA, USA" -> "seattle")
                        first_token = raw_loc.split(',')[0].strip()
                        matched_hub = None
                        if first_token in self.KNOWN_COMMUNITY_HUBS:
                            matched_hub = self.KNOWN_COMMUNITY_HUBS[first_token]
                        else:
                            for k, v in self.KNOWN_COMMUNITY_HUBS.items():
                                if k in raw_loc or raw_loc in k:
                                    matched_hub = v
                                    break
                        if matched_hub:
                            user_lat, user_lng, hub_name = matched_hub
                            if not location_name:
                                location_name = hub_name
                        else:
                            # 3. Query events table for matching tournament city
                            cursor.execute("""
                                SELECT latitude, longitude, city, state
                                FROM events
                                WHERE (LOWER(city) = %s OR LOWER(city) = %s)
                                  AND latitude IS NOT NULL AND longitude IS NOT NULL
                                  AND NOT (latitude = 0.0 AND longitude = 0.0)
                                ORDER BY event_date DESC
                                LIMIT 1;
                            """, (first_token, raw_loc))
                            ev_loc = cursor.fetchone()
                            if ev_loc and ev_loc.get("latitude") and ev_loc.get("longitude"):
                                user_lat = float(ev_loc["latitude"])
                                user_lng = float(ev_loc["longitude"])
                                if not location_name:
                                    c_name = ev_loc.get("city")
                                    s_name = ev_loc.get("state")
                                    location_name = f"{c_name}, {s_name}" if s_name else c_name
                            else:
                                user_lat = 32.7157
                                user_lng = -117.1611
                                if not location_name:
                                    location_name = "San Diego, CA"

                if not location_name:
                    location_name = f"{user_lat:.2f}, {user_lng:.2f}"

                # Cache lookup
                cache_key = (
                    round(user_lat, 3),
                    round(user_lng, 3),
                    int(round(radius_miles)),
                    str(current_player_id or ""),
                    str(current_user_id or ""),
                    bool(include_bcp)
                )
                cached = PostgresDatabase.get_cached(PostgresDatabase._community_overview_cache_dict, cache_key, ttl=90)
                if cached is not None:
                    return cached

                # Bounding box delta: 1 degree latitude ~ 69 miles
                lat_delta = (radius_miles / 69.0) * 1.15
                cos_lat = max(0.01, abs(math.cos(math.radians(user_lat))))
                lng_delta = (radius_miles / (69.0 * cos_lat)) * 1.15
                min_lat = max(-90.0, user_lat - lat_delta)
                max_lat = min(90.0, user_lat + lat_delta)
                min_lng = max(-180.0, user_lng - lng_delta)
                max_lng = min(180.0, user_lng + lng_delta)

                # 2. Combined Haversine distance query with bounding-box pre-filtering
                combined_events_sql = """
                    WITH events_filtered AS (
                        SELECT 
                            e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country,
                            COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') as venue,
                            e.total_players, e.num_rounds, e.current_round, e.is_ended, e.circuits,
                            COALESCE(
                                e.latitude,
                                CASE 
                                    WHEN jsonb_typeof(e.raw_json->'coordinate') = 'array' 
                                         AND jsonb_array_length(e.raw_json->'coordinate') = 2 
                                    THEN (e.raw_json->'coordinate'->>1)::double precision 
                                    WHEN jsonb_typeof(e.raw_json->'location'->'coordinate') = 'array'
                                         AND jsonb_array_length(e.raw_json->'location'->'coordinate') = 2
                                    THEN (e.raw_json->'location'->'coordinate'->>1)::double precision
                                    ELSE NULL 
                                END,
                                CASE LOWER(TRIM(COALESCE(e.city, '')))
                                    WHEN 'san diego' THEN 32.7157
                                    WHEN 'los angeles' THEN 34.0522
                                    WHEN 'temecula' THEN 33.4936
                                    WHEN 'pasadena' THEN 34.1478
                                    WHEN 'burbank' THEN 34.1808
                                    WHEN 'anaheim' THEN 33.8366
                                    WHEN 'long beach' THEN 33.7701
                                    WHEN 'irvine' THEN 33.6846
                                    WHEN 'riverside' THEN 33.9806
                                    WHEN 'san francisco' THEN 37.7749
                                    WHEN 'san jose' THEN 37.3382
                                    WHEN 'sacramento' THEN 38.5816
                                    WHEN 'austin' THEN 30.2672
                                    WHEN 'dallas' THEN 32.7767
                                    WHEN 'houston' THEN 29.7604
                                    WHEN 'chicago' THEN 41.8781
                                    WHEN 'seattle' THEN 47.6062
                                    WHEN 'orlando' THEN 28.5383
                                    WHEN 'london' THEN 51.5074
                                    ELSE NULL
                                END
                            ) AS ev_lat,
                            COALESCE(
                                e.longitude,
                                CASE 
                                    WHEN jsonb_typeof(e.raw_json->'coordinate') = 'array' 
                                         AND jsonb_array_length(e.raw_json->'coordinate') = 2 
                                    THEN (e.raw_json->'coordinate'->>0)::double precision 
                                    WHEN jsonb_typeof(e.raw_json->'location'->'coordinate') = 'array'
                                         AND jsonb_array_length(e.raw_json->'location'->'coordinate') = 2
                                    THEN (e.raw_json->'location'->'coordinate'->>0)::double precision
                                    ELSE NULL 
                                END,
                                CASE LOWER(TRIM(COALESCE(e.city, '')))
                                    WHEN 'san diego' THEN -117.1611
                                    WHEN 'los angeles' THEN -118.2437
                                    WHEN 'temecula' THEN -117.1484
                                    WHEN 'pasadena' THEN -118.1445
                                    WHEN 'burbank' THEN -118.3090
                                    WHEN 'anaheim' THEN -117.9143
                                    WHEN 'long beach' THEN -118.1937
                                    WHEN 'irvine' THEN -117.8265
                                    WHEN 'riverside' THEN -117.3755
                                    WHEN 'san francisco' THEN -122.4194
                                    WHEN 'san jose' THEN -121.8863
                                    WHEN 'sacramento' THEN -121.4944
                                    WHEN 'austin' THEN -97.7431
                                    WHEN 'dallas' THEN -96.7970
                                    WHEN 'houston' THEN -95.3698
                                    WHEN 'chicago' THEN -87.6298
                                    WHEN 'seattle' THEN -122.3321
                                    WHEN 'orlando' THEN -81.3792
                                    WHEN 'london' THEN -0.1278
                                    ELSE NULL
                                END
                            ) AS ev_lng
                        FROM events e
                        WHERE (
                            (e.latitude BETWEEN %s AND %s AND e.longitude BETWEEN %s AND %s)
                            OR (e.latitude IS NULL)
                        )
                    ),
                    events_dist AS (
                        SELECT *,
                            (3959.0 * acos(
                                LEAST(1.0, GREATEST(-1.0,
                                    cos(radians(%s)) * cos(radians(ev_lat)) * cos(radians(ev_lng) - radians(%s)) +
                                    sin(radians(%s)) * sin(radians(ev_lat))
                                ))
                            )) AS distance_miles
                        FROM events_filtered
                        WHERE ev_lat IS NOT NULL AND ev_lng IS NOT NULL
                          AND ev_lat BETWEEN %s AND %s
                          AND ev_lng BETWEEN %s AND %s
                          AND NOT (ev_lat = 0.0 AND ev_lng = 0.0)
                    )
                    (
                        SELECT id, name, event_date, end_date, city, state, country,
                               venue, total_players, num_rounds, current_round, is_ended, circuits,
                               ROUND(distance_miles::numeric, 1) as distance_miles,
                               'upcoming' as event_group
                        FROM events_dist
                        WHERE distance_miles <= %s
                          AND event_date >= CURRENT_DATE - INTERVAL '1 day'
                          AND event_date <= CURRENT_DATE + (INTERVAL '1 day' * 92)
                        ORDER BY event_date ASC, distance_miles ASC
                        LIMIT 30
                    )
                    UNION ALL
                    (
                        SELECT id, name, event_date, end_date, city, state, country,
                               venue, total_players, num_rounds, current_round, is_ended, circuits,
                               ROUND(distance_miles::numeric, 1) as distance_miles,
                               'recent' as event_group
                        FROM events_dist
                        WHERE distance_miles <= %s
                          AND event_date < CURRENT_DATE - INTERVAL '1 day'
                        ORDER BY event_date DESC, distance_miles ASC
                        LIMIT 50
                    );
                """
                cursor.execute(
                    combined_events_sql,
                    (
                        min_lat, max_lat, min_lng, max_lng,
                        user_lat, user_lng, user_lat,
                        min_lat, max_lat, min_lng, max_lng,
                        radius_miles, radius_miles
                    )
                )
                all_event_rows = cursor.fetchall()
                events_upcoming_db = [dict(r) for r in all_event_rows if r.get("event_group") == "upcoming"]
                events_recent_all = [dict(r) for r in all_event_rows if r.get("event_group") == "recent"]
                events_recent = events_recent_all[:25]

                # Fetch live upcoming tournaments from BCP API (3 months / 92 days ahead)
                bcp_upcoming = []
                if include_bcp:
                    try:
                        bcp_upcoming = self.fetch_bcp_upcoming_events(
                            user_lat=user_lat,
                            user_lng=user_lng,
                            radius_miles=radius_miles,
                            days_ahead=92
                        )
                    except Exception as e:
                        logger.warning(f"Notice fetching live BCP upcoming tournaments: {e}")
                else:
                    # Non-blocking: check if we already have warm cached BCP events in memory
                    try:
                        effective_radius = max(5, int(round(radius_miles)))
                        bcp_cache_key = (
                            round(user_lat, 2),
                            round(user_lng, 2),
                            effective_radius,
                            92
                        )
                        cached_bcp = PostgresDatabase.get_cached(PostgresDatabase._bcp_upcoming_cache_dict, bcp_cache_key, ttl=300)
                        if cached_bcp:
                            bcp_upcoming = list(cached_bcp)
                    except Exception:
                        pass

                # Merge BCP upcoming with DB upcoming events, deduplicating by event ID
                seen_upcoming_ids = set()
                merged_upcoming = []
                db_upcoming_map = {e["id"]: e for e in events_upcoming_db if e.get("id")}

                for b_ev in bcp_upcoming:
                    eid = b_ev.get("id")
                    if not eid or eid in seen_upcoming_ids:
                        continue
                    seen_upcoming_ids.add(eid)

                    if eid in db_upcoming_map:
                        db_ev = db_upcoming_map[eid]
                        combined = dict(db_ev)
                        if b_ev.get("total_players") and b_ev["total_players"] > (combined.get("total_players") or 0):
                            combined["total_players"] = b_ev["total_players"]
                        if b_ev.get("current_round"):
                            combined["current_round"] = b_ev["current_round"]
                        if b_ev.get("is_ended"):
                            combined["is_ended"] = b_ev["is_ended"]
                        if combined.get("distance_miles") is None and b_ev.get("distance_miles") is not None:
                            combined["distance_miles"] = b_ev["distance_miles"]
                        merged_upcoming.append(combined)
                    else:
                        merged_upcoming.append(b_ev)

                for db_ev in events_upcoming_db:
                    eid = db_ev.get("id")
                    if eid and eid not in seen_upcoming_ids:
                        seen_upcoming_ids.add(eid)
                        merged_upcoming.append(db_ev)

                def upcoming_sort_key(ev):
                    d_raw = ev.get("event_date") or "9999-12-31"
                    d_str = d_raw.isoformat() if hasattr(d_raw, "isoformat") else str(d_raw)
                    dist = ev.get("distance_miles")
                    dist_val = float(dist) if dist is not None else 999999.0
                    return (d_str, dist_val)

                merged_upcoming.sort(key=upcoming_sort_key)
                events_upcoming = merged_upcoming[:35]

                # Collect event IDs for field stats and player discovery
                all_event_ids = list({e["id"] for e in (events_upcoming + events_recent_all) if e.get("id")})
                field_stats_map = self.get_events_field_stats(all_event_ids) if all_event_ids else {}

                for ev in (events_upcoming + events_recent):
                    eid = ev["id"]
                    stats = field_stats_map.get(eid, {})
                    ev["avg_field_elo"] = stats.get("avg_field_elo")
                    ev["top_seed_elo"] = stats.get("top_seed_elo")
                    if ev.get("event_date") and hasattr(ev["event_date"], "isoformat"):
                        ev["event_date"] = ev["event_date"].isoformat()
                    if ev.get("end_date") and hasattr(ev["end_date"], "isoformat"):
                        ev["end_date"] = ev["end_date"].isoformat()
                    if ev.get("distance_miles") is not None:
                        ev["distance_miles"] = float(ev["distance_miles"])

                # 3. Discover Local Competitors & Tournament Participants
                user_event_ids = set()
                user_event_names = {}
                user_elo = None

                # Resolve user Elo for relevance and delta calculations
                if current_player_id:
                    cursor.execute("SELECT current_elo FROM player_ratings WHERE player_id = %s;", (current_player_id,))
                    u_elo_row = cursor.fetchone()
                    if u_elo_row and u_elo_row.get("current_elo"):
                        user_elo = float(u_elo_row["current_elo"])
                if user_elo is None and current_user_id:
                    cursor.execute("""
                        SELECT pr.current_elo 
                        FROM users u 
                        JOIN player_ratings pr ON (
                            (u.player_id IS NOT NULL AND u.player_id != '' AND pr.player_id = u.player_id)
                            OR
                            (u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND pr.player_id = u.bcp_user_id)
                        ) 
                        WHERE u.id = %s;
                    """, (current_user_id,))
                    u_elo_row = cursor.fetchone()
                    if u_elo_row and u_elo_row.get("current_elo"):
                        user_elo = float(u_elo_row["current_elo"])

                if current_player_id:
                    cursor.execute("""
                        SELECT DISTINCT ep.event_id, e.name as event_name
                        FROM event_participants ep
                        LEFT JOIN events e ON ep.event_id = e.id
                        WHERE ep.player_id = %s
                        UNION
                        SELECT DISTINCT m.event_id, e.name as event_name
                        FROM matches m
                        LEFT JOIN events e ON m.event_id = e.id
                        WHERE m.player1_id = %s
                        UNION
                        SELECT DISTINCT m.event_id, e.name as event_name
                        FROM matches m
                        LEFT JOIN events e ON m.event_id = e.id
                        WHERE m.player2_id = %s;
                    """, (current_player_id, current_player_id, current_player_id))
                    for u_row in cursor.fetchall():
                        eid = u_row["event_id"]
                        if eid:
                            user_event_ids.add(eid)
                            user_event_names[eid] = u_row["event_name"] or "Tournament Match"

                local_competitors = []
                player_local_stats = collections.defaultdict(lambda: {
                    "elo": 1500.0,
                    "peak_elo": 1500.0,
                    "matches": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "events": set(),
                    "factions": collections.Counter(),
                })

                if all_event_ids:
                    # Query all completed regional matches chronologically for on-the-fly local Elo calculation
                    cursor.execute("""
                        SELECT m.id, m.event_id, m.round,
                               COALESCE(m.match_date, e.event_date) as match_date,
                               m.player1_id, m.player2_id, m.winner_id, m.loser_id, m.is_draw,
                               m.player1_faction, m.player2_faction
                        FROM matches m
                        LEFT JOIN events e ON m.event_id = e.id
                        WHERE m.event_id = ANY(%s)
                          AND m.is_done = TRUE
                          AND m.is_bye = FALSE
                          AND m.player1_id IS NOT NULL AND m.player1_id != ''
                          AND m.player2_id IS NOT NULL AND m.player2_id != ''
                        ORDER BY COALESCE(m.match_date, e.event_date) ASC NULLS LAST, m.round ASC, m.id ASC;
                    """, (all_event_ids,))
                    regional_matches = cursor.fetchall()

                    for m in regional_matches:
                        p1 = m.get("player1_id")
                        p2 = m.get("player2_id")
                        if not p1 or not p2 or p1 == p2:
                            continue

                        eid = m.get("event_id")
                        if eid:
                            player_local_stats[p1]["events"].add(eid)
                            player_local_stats[p2]["events"].add(eid)

                        if m.get("player1_faction"):
                            player_local_stats[p1]["factions"][m["player1_faction"]] += 1
                        if m.get("player2_faction"):
                            player_local_stats[p2]["factions"][m["player2_faction"]] += 1

                        r1 = player_local_stats[p1]["elo"]
                        r2 = player_local_stats[p2]["elo"]

                        k1 = 32.0 if player_local_stats[p1]["matches"] < 10 else 24.0
                        k2 = 32.0 if player_local_stats[p2]["matches"] < 10 else 24.0

                        exp1 = 1.0 / (1.0 + math.pow(10.0, (r2 - r1) / 400.0))
                        exp2 = 1.0 - exp1

                        is_draw = bool(m.get("is_draw"))
                        w_id = m.get("winner_id")
                        l_id = m.get("loser_id")

                        if is_draw:
                            s1, s2 = 0.5, 0.5
                            player_local_stats[p1]["draws"] += 1
                            player_local_stats[p2]["draws"] += 1
                        elif w_id == p1 or l_id == p2:
                            s1, s2 = 1.0, 0.0
                            player_local_stats[p1]["wins"] += 1
                            player_local_stats[p2]["losses"] += 1
                        elif w_id == p2 or l_id == p1:
                            s1, s2 = 0.0, 1.0
                            player_local_stats[p2]["wins"] += 1
                            player_local_stats[p1]["losses"] += 1
                        else:
                            continue

                        new_r1 = r1 + k1 * (s1 - exp1)
                        new_r2 = r2 + k2 * (s2 - exp2)

                        player_local_stats[p1]["elo"] = new_r1
                        player_local_stats[p2]["elo"] = new_r2
                        player_local_stats[p1]["peak_elo"] = max(player_local_stats[p1]["peak_elo"], new_r1)
                        player_local_stats[p2]["peak_elo"] = max(player_local_stats[p2]["peak_elo"], new_r2)
                        player_local_stats[p1]["matches"] += 1
                        player_local_stats[p2]["matches"] += 1

                    cursor.execute("""
                        SELECT 
                            ep.player_id,
                            COUNT(DISTINCT ep.event_id) as regional_events_count,
                            ARRAY_AGG(DISTINCT ep.event_id) as event_ids,
                            COALESCE(pr.player_name, MAX(ep.full_name), 'Competitor') as player_name,
                            COALESCE(pr.current_elo, 1500.0) as current_elo,
                            COALESCE(pr.peak_elo, 1500.0) as peak_elo,
                            COALESCE(pr.top_faction, MAX(ep.faction), 'Unknown Faction') as top_faction,
                            COALESCE(pr.team, MAX(ep.team)) as team,
                            COALESCE(pr.matches_played, 0) as matches_played,
                            COALESCE(pr.wins, 0) as wins,
                            COALESCE(pr.losses, 0) as losses,
                            COALESCE(pr.win_rate, 0.0) as win_rate,
                            MAX(u.id) as account_user_id,
                            MAX(u.display_name) as account_display_name,
                            CASE WHEN MAX(u.id) IS NOT NULL THEN TRUE ELSE FALSE END as has_account
                        FROM event_participants ep
                        LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                        LEFT JOIN users u ON (
                            (u.player_id IS NOT NULL AND u.player_id != '' AND u.player_id = ep.player_id)
                            OR (u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND u.bcp_user_id = ep.player_id)
                            OR u.id = ep.player_id
                        )
                        WHERE ep.event_id = ANY(%s) AND ep.player_id IS NOT NULL AND ep.player_id != ''
                        GROUP BY ep.player_id, pr.player_name, pr.current_elo, pr.peak_elo, pr.top_faction,
                                 pr.team, pr.matches_played, pr.wins, pr.losses, pr.win_rate
                        ORDER BY current_elo DESC
                        LIMIT 500;
                    """, (all_event_ids,))
                    comp_rows = cursor.fetchall()

                    # Check if any players in player_local_stats were missing from event_participants
                    comp_rows_pids = {r["player_id"] for r in comp_rows}
                    missing_pids = [pid for pid in player_local_stats if pid not in comp_rows_pids]
                    if missing_pids:
                        cursor.execute("""
                            SELECT 
                                pr.player_id,
                                COALESCE(pr.player_name, 'Competitor') as player_name,
                                COALESCE(pr.current_elo, 1500.0) as current_elo,
                                COALESCE(pr.peak_elo, 1500.0) as peak_elo,
                                COALESCE(pr.top_faction, 'Unknown Faction') as top_faction,
                                pr.team as team,
                                COALESCE(pr.matches_played, 0) as matches_played,
                                COALESCE(pr.wins, 0) as wins,
                                COALESCE(pr.losses, 0) as losses,
                                COALESCE(pr.win_rate, 0.0) as win_rate,
                                u.id as account_user_id,
                                u.display_name as account_display_name,
                                CASE WHEN u.id IS NOT NULL THEN TRUE ELSE FALSE END as has_account
                            FROM player_ratings pr
                            LEFT JOIN users u ON (
                                (u.player_id IS NOT NULL AND u.player_id != '' AND u.player_id = pr.player_id)
                                OR (u.bcp_user_id IS NOT NULL AND u.bcp_user_id != '' AND u.bcp_user_id = pr.player_id)
                                OR u.id = pr.player_id
                            )
                            WHERE pr.player_id = ANY(%s);
                        """, (missing_pids,))
                        for mr in cursor.fetchall():
                            md = dict(mr)
                            md["event_ids"] = list(player_local_stats[md["player_id"]]["events"])
                            md["regional_events_count"] = len(md["event_ids"])
                            comp_rows.append(md)

                    event_title_map = {e["id"]: e.get("name", "Tournament") for e in (events_recent_all + events_upcoming)}

                    user_local_elo = None
                    if current_player_id and current_player_id in player_local_stats and player_local_stats[current_player_id]["matches"] > 0:
                        user_local_elo = round(player_local_stats[current_player_id]["elo"], 1)

                    for r in comp_rows:
                        p_dict = dict(r)
                        pid = p_dict["player_id"]
                        l_stats = player_local_stats.get(pid)

                        e_ids = set(p_dict.get("event_ids") or [])
                        if l_stats and l_stats["events"]:
                            e_ids.update(l_stats["events"])
                        p_dict["event_ids"] = list(e_ids)
                        reg_events = max(int(p_dict.get("regional_events_count") or 1), len(e_ids) if e_ids else 1)
                        p_dict["regional_events_count"] = reg_events

                        shared_ids = [eid for eid in e_ids if eid in user_event_ids]
                        shared_names = [event_title_map.get(eid) or user_event_names.get(eid) for eid in shared_ids if (event_title_map.get(eid) or user_event_names.get(eid))]
                        recent_local_names = [event_title_map.get(eid) for eid in e_ids if eid in event_title_map]

                        p_dict["shared_events_count"] = len(shared_ids)
                        p_dict["shared_event_names"] = shared_names[:3]
                        p_dict["has_shared_events"] = len(shared_ids) > 0
                        p_dict["recent_local_event"] = recent_local_names[0] if recent_local_names else (shared_names[0] if shared_names else None)

                        # Local circuit rating & record
                        if l_stats and l_stats["matches"] > 0:
                            p_dict["local_elo"] = round(float(l_stats["elo"]), 1)
                            p_dict["local_peak_elo"] = round(float(l_stats["peak_elo"]), 1)
                            p_dict["local_matches"] = l_stats["matches"]
                            p_dict["local_wins"] = l_stats["wins"]
                            p_dict["local_losses"] = l_stats["losses"]
                            p_dict["local_draws"] = l_stats["draws"]
                            p_dict["local_record"] = f"{l_stats['wins']}-{l_stats['losses']}-{l_stats['draws']}"
                            p_dict["local_win_rate"] = round((l_stats["wins"] / l_stats["matches"]) * 100.0, 1)
                            if l_stats["factions"]:
                                p_dict["local_top_faction"] = l_stats["factions"].most_common(1)[0][0]
                            else:
                                p_dict["local_top_faction"] = p_dict.get("top_faction")
                        else:
                            p_dict["local_elo"] = 1500.0
                            p_dict["local_peak_elo"] = 1500.0
                            p_dict["local_matches"] = 0
                            p_dict["local_wins"] = 0
                            p_dict["local_losses"] = 0
                            p_dict["local_draws"] = 0
                            p_dict["local_record"] = "0-0-0"
                            p_dict["local_win_rate"] = 0.0
                            p_dict["local_top_faction"] = p_dict.get("top_faction")

                        # Qualified: >= 5 local matches OR >= 2 local events. Provisional if < 5 matches AND < 2 events.
                        p_dict["is_provisional"] = bool(p_dict["local_matches"] < 5 and reg_events < 2)

                        if p_dict.get("current_elo"): p_dict["current_elo"] = round(float(p_dict["current_elo"]), 1)
                        if p_dict.get("peak_elo"): p_dict["peak_elo"] = round(float(p_dict["peak_elo"]), 1)
                        if p_dict.get("win_rate"): p_dict["win_rate"] = round(float(p_dict["win_rate"]), 1)

                        # Relevance & Elo Delta calculation
                        comp_elo = float(p_dict.get("local_elo") if p_dict.get("local_matches", 0) > 0 else (p_dict.get("current_elo") or 1500.0))
                        baseline = float(user_local_elo) if user_local_elo is not None else (float(user_elo) if user_elo is not None else 1500.0)
                        elo_diff = comp_elo - baseline
                        p_dict["elo_delta"] = round(abs(elo_diff), 1)
                        p_dict["elo_diff"] = round(elo_diff, 1)
                        p_dict["user_elo"] = round(user_elo, 1) if user_elo is not None else None
                        p_dict["user_local_elo"] = user_local_elo
                        p_dict["can_chat"] = bool(p_dict.get("has_account"))
                        p_dict["is_self"] = bool(
                            (current_player_id and p_dict["player_id"] == current_player_id) or
                            (current_user_id and p_dict.get("account_user_id") == current_user_id)
                        )

                        local_competitors.append(p_dict)

                # 4. Local Player Leaderboard (Option 3: Hybrid Local Ranking)
                # Qualified local regulars (>= 5 matches or >= 2 events) rank first by Local Elo.
                # Provisional competitors (< 5 matches and 1 event) rank below qualified players.
                def leaderboard_sort_key(c):
                    has_played = 1 if c.get("local_matches", 0) > 0 else 0
                    is_qualified = 1 if not c.get("is_provisional", True) else 0
                    local_elo = float(c.get("local_elo") or 1500.0)
                    local_wr = float(c.get("local_win_rate") or 0.0)
                    local_w = int(c.get("local_wins") or 0)
                    reg_events = int(c.get("regional_events_count") or 1)
                    global_elo = float(c.get("current_elo") or 1500.0)
                    return (has_played, is_qualified, local_elo, local_wr, local_w, reg_events, global_elo)

                sorted_leaderboard = sorted(
                    local_competitors,
                    key=leaderboard_sort_key,
                    reverse=True
                )

                leaderboard = []
                for idx, c in enumerate(sorted_leaderboard[:50], start=1):
                    leaderboard.append({
                        "rank": idx,
                        "player_id": c["player_id"],
                        "player_name": c.get("player_name") or "Competitor",
                        "local_elo": c.get("local_elo", 1500.0),
                        "local_peak_elo": c.get("local_peak_elo", 1500.0),
                        "local_record": c.get("local_record", "0-0-0"),
                        "local_matches": c.get("local_matches", 0),
                        "local_wins": c.get("local_wins", 0),
                        "local_losses": c.get("local_losses", 0),
                        "local_draws": c.get("local_draws", 0),
                        "local_win_rate": c.get("local_win_rate", 0.0),
                        "is_provisional": c.get("is_provisional", False),
                        "current_elo": c.get("current_elo", 1500.0),
                        "peak_elo": c.get("peak_elo", 1500.0),
                        "top_faction": c.get("local_top_faction") or c.get("top_faction") or "Unknown Faction",
                        "team": c.get("team"),
                        "win_rate": c.get("win_rate", 0.0),
                        "matches_played": c.get("matches_played", 0),
                        "regional_events_count": c.get("regional_events_count", 1),
                        "shared_events_count": c.get("shared_events_count", 0),
                        "has_shared_events": c.get("has_shared_events", False),
                        "has_account": c.get("has_account", False),
                        "can_chat": c.get("can_chat", False),
                        "account_user_id": c.get("account_user_id")
                    })

                # Sort local_competitors for Sparring cards:
                # 1) Registered users with accounts (can chat) at the top
                # 2) Closest Elo delta to current user
                # 3) Most shared events
                # 4) Qualified before provisional
                # 5) Higher Local Elo
                def competitor_rank_key(c):
                    acc_rank = -1 if c.get("has_account") else 0
                    delta = float(c.get("elo_delta") if c.get("elo_delta") is not None else 9999.0)
                    shared = int(c.get("shared_events_count") or 0)
                    is_qual = -1 if not c.get("is_provisional") else 0
                    local_elo = float(c.get("local_elo") or 1500.0)
                    return (acc_rank, delta, -shared, is_qual, -local_elo)

                local_competitors.sort(key=competitor_rank_key)

                # 5. Local Team Leaderboard (teams represented by competitors in regional events)
                local_teams = []
                if all_event_ids:
                    cursor.execute("""
                        SELECT 
                            TRIM(COALESCE(NULLIF(TRIM(ep.team), ''), NULLIF(TRIM(pr.team), ''))) as team_name,
                            COUNT(DISTINCT ep.player_id) as local_members_count,
                            ROUND(AVG(COALESCE(pr.current_elo, 1500.0))::numeric, 1) as avg_elo,
                            ROUND(MAX(COALESCE(pr.current_elo, 1500.0))::numeric, 1) as top_player_elo,
                            (ARRAY_AGG(COALESCE(pr.player_name, ep.full_name, 'Player') ORDER BY COALESCE(pr.current_elo, 1500.0) DESC))[1] as top_player_name,
                            (ARRAY_AGG(ep.player_id ORDER BY COALESCE(pr.current_elo, 1500.0) DESC))[1] as top_player_id,
                            COUNT(DISTINCT ep.event_id) as regional_events_count,
                            SUM(COALESCE(pr.wins, 0)) as total_wins,
                            SUM(COALESCE(pr.losses, 0)) as total_losses,
                            SUM(COALESCE(pr.draws, 0)) as total_draws,
                            SUM(COALESCE(pr.matches_played, 0)) as total_matches,
                            ROUND((
                                SUM(COALESCE(pr.wins, 0)) * 100.0 / NULLIF(SUM(COALESCE(pr.matches_played, 0)), 0)
                            )::numeric, 1) as team_win_rate
                        FROM event_participants ep
                        LEFT JOIN player_ratings pr ON ep.player_id = pr.player_id
                        WHERE ep.event_id = ANY(%s)
                          AND (
                              (ep.team IS NOT NULL AND TRIM(ep.team) != '' AND LOWER(TRIM(ep.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-'))
                              OR
                              (pr.team IS NOT NULL AND TRIM(pr.team) != '' AND LOWER(TRIM(pr.team)) NOT IN ('none', 'n/a', 'unaligned', 'unaffiliated', 'no team', 'null', 'unknown', '-'))
                          )
                        GROUP BY TRIM(COALESCE(NULLIF(TRIM(ep.team), ''), NULLIF(TRIM(pr.team), '')))
                        HAVING COUNT(DISTINCT ep.player_id) >= 1
                        ORDER BY avg_elo DESC, local_members_count DESC
                        LIMIT 50;
                    """, (all_event_ids,))
                    team_rows = cursor.fetchall()
                    for idx, tr in enumerate(team_rows, start=1):
                        td = dict(tr)
                        td["rank"] = idx
                        if td.get("avg_elo"): td["avg_elo"] = float(td["avg_elo"])
                        if td.get("top_player_elo"): td["top_player_elo"] = float(td["top_player_elo"])
                        if td.get("team_win_rate"): td["team_win_rate"] = float(td["team_win_rate"])
                        local_teams.append(td)

                radius_int = int(round(radius_miles))
                result = {
                    "success": True,
                    "location": {
                        "lat": round(user_lat, 4),
                        "lng": round(user_lng, 4),
                        "radius_miles": radius_int,
                        "location_name": location_name,
                        "badge": f"📍 {radius_int}-Mile Tournament Radius",
                        "description": f"Showing tournaments and competitors within {radius_int} miles of {location_name}."
                    },
                    "region": {
                        "id": "local",
                        "name": location_name,
                        "badge": f"📍 {radius_int}-Mile Radius",
                        "description": f"Tournaments within {radius_int} miles of {location_name}"
                    },
                    "events_upcoming": events_upcoming,
                    "events_recent": events_recent,
                    "local_competitors": local_competitors[:50],
                    "local_leaderboard": leaderboard,
                    "local_teams_leaderboard": local_teams,
                    "user_elo": round(user_elo, 1) if user_elo is not None else None,
                    "user_local_elo": user_local_elo,
                    "available_regions": self.COMMUNITY_REGIONS,
                    "disclaimer": (
                        f"Competitors and local standings are calculated on the fly from verified tournament match records "
                        f"and rosters within {radius_int} miles of {location_name}."
                    ),
                    "bcp_prompt": {
                        "is_linked": bool(current_player_id),
                        "prompt_title": "Link Best Coast Pairings for Automatic Local Matching",
                        "prompt_text": (
                            "Linking your BCP account enables automatic tournament discovery, surfaces competitors "
                            "you've shared events with, and enters you into the local standings."
                        )
                    }
                }

                PostgresDatabase.set_cached(PostgresDatabase._community_overview_cache_dict, cache_key, result)
                return result

    @classmethod
    def is_valid_game_store_name(
        cls,
        name: str,
        types: Optional[List[str]] = None,
        is_from_google_places: bool = False
    ) -> bool:
        """
        Validates whether a venue corresponds to a legitimate local game/hobby store
        rather than a hotel, convention hall, brewery, private residence, tournament title, or junk test event.
        """
        if not name or len(name.strip()) < 3:
            return False

        name_clean = name.strip()
        norm = name_clean.lower().replace("'", "").replace('"', '').strip()

        # 1. Obvious junk / test strings / virtual platforms / private residences
        JUNK_EXACT = {
            "asdf", "test", "testing", "tbd", "na", "n/a", "none", "null", "undefined",
            "unknown", "online", "discord", "tabletop simulator", "tts", "vassal",
            "home", "house", "garage", "basement", "private", "my house", "my home",
            "somewhere", "anywhere", "tba", "zoom", "google meet", "room"
        }
        if norm in JUNK_EXACT:
            return False

        # Single word without store keywords (e.g. personal names like "Luis", "Dave", "John")
        words = [w for w in norm.split() if w]
        if len(words) == 1 and len(norm) <= 7:
            if not any(k in norm for k in ("game", "hobby", "comic", "cards", "dice", "gunnzo")):
                return False

        # 2. Google Places specific type check
        if types:
            excluded_types = {"lodging", "hotel", "campground", "tourist_attraction", "airport", "movie_theater"}
            if any(t in excluded_types for t in types):
                return False

        # 3. Excluded non-store venue categories (Hotels, Fairgrounds, Convention Centers, Breweries, etc.)
        NON_STORE_PATTERNS = (
            r"\b("
            r"hotel|motel|resort|suites|inn\b|lodge|banquet|ballroom|fairground|fairgrounds|"
            r"convention\s*center|conference\s*center|expo\s*center|civic\s*center|events?\s*center|"
            r"coliseum|arena|pavilion|hall\b|"
            r"brewing|brewery|brewhouse|beer|winery|vineyard|saloon|bar\s*&\s*grill|bar\s*and\s*grill|"
            r"tavern|pub\b|pizzeria|pizza|restaurant|bistro|cantina|"
            r"park|recreation\s*center|rec\s*center|church|temple|chapel|community\s*center|"
            r"elementary|high\s*school|middle\s*school|university|college|campus"
            r")\b"
        )
        SPECIFIC_NON_STORES = {
            "del mar fairgrounds", "town and country san diego", "town and country",
            "handlery hotel", "handlery hotel: garden space", "crowne plaza", "crowne plaza san diego",
            "alesmith", "alesmith brewing", "alesmith brewing company", "stone brewing", "ballast point"
        }

        if any(bad in norm for bad in SPECIFIC_NON_STORES):
            return False

        if re.search(NON_STORE_PATTERNS, norm, re.IGNORECASE):
            # Exception only if explicitly marked as a board game / tabletop cafe
            if not any(good in norm for good in ("board game", "boardgame", "tabletop cafe", "game cafe", "gaming cafe")):
                return False

        # 4. Tournament / Event title in place of venue name (e.g. "Warhammer League 12", "San Diego GT")
        EVENT_TITLES_PATTERN = (
            r"\b("
            r"tournament|grand\s*tournament|\bgt\b|\brtt\b|championship|invitational|"
            r"qualifier|\bleague\b|\bcup\b"
            r")\b"
        )
        if re.search(EVENT_TITLES_PATTERN, norm, re.IGNORECASE):
            if not any(good in norm for good in ("store", "shop", "hobbies", "hobby", "games", "gaming")):
                return False

        # If from Google Places, we already know it was returned for a game store query
        if is_from_google_places:
            return True

        # 5. For database tournament venues: require explicit store/hobby keywords or known store whitelist
        STORE_KEYWORDS = (
            r"\b("
            r"game|games|gaming|hobby|hobbies|tabletop|comic|comics|card|cards|"
            r"collectible|collectibles|warhammer|games\s*workshop|miniature|miniatures|"
            r"dice|wargame|wargames|wargaming|boardgame|boardgames|tcg"
            r")\b"
        )
        KNOWN_STORES = {
            "tc rockets", "tcs rockets", "tc's rockets", "gunnzo", "pair a dice",
            "off the shelf", "crazy squirrel", "bards & cards", "bards and cards",
            "at ease", "game empire", "warp rider", "villainous lair", "so cal games",
            "socal games", "brookhurst"
        }

        if any(known in norm for known in KNOWN_STORES):
            return True

        if re.search(STORE_KEYWORDS, norm, re.IGNORECASE):
            return True

        return False

    def get_local_game_stores(
        self,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        radius_miles: float = 50.0,
        query: Optional[str] = None,
        location_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Discovers local game stores and clubs for Warhammer 40k within a specified radius:
        1. Queries Google Places TextSearch API (if Google Maps API key is configured).
        2. Queries verified Warhammer 40k tournament venues from the PostgreSQL events database.
        3. Merges, enriches with tournament hosting history, calculates distances, and sorts by proximity.
        """
        try:
            radius_miles = float(radius_miles or 50.0)
        except (ValueError, TypeError):
            radius_miles = 50.0
        radius_miles = max(5.0, min(radius_miles, 250.0))

        user_lat = None
        user_lng = None
        if lat is not None and lng is not None:
            try:
                user_lat = float(lat)
                user_lng = float(lng)
            except (ValueError, TypeError):
                user_lat = None
                user_lng = None

        # Cross-validate against named location to prevent coordinate mismatches
        if location_name:
            loc_lower = location_name.strip().lower()
            first_tok = loc_lower.split(',')[0].strip()
            matched_hub = None
            if loc_lower in self.KNOWN_COMMUNITY_HUBS:
                matched_hub = self.KNOWN_COMMUNITY_HUBS[loc_lower]
            elif first_tok in self.KNOWN_COMMUNITY_HUBS:
                matched_hub = self.KNOWN_COMMUNITY_HUBS[first_tok]
            else:
                for k, v in self.KNOWN_COMMUNITY_HUBS.items():
                    if k in loc_lower or loc_lower in k:
                        matched_hub = v
                        break
            if matched_hub:
                hub_lat, hub_lng, hub_name = matched_hub
                if user_lat is not None and user_lng is not None:
                    R = 3959.0
                    dlat = math.radians(hub_lat - user_lat)
                    dlng = math.radians(hub_lng - user_lng)
                    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(hub_lat)) * math.sin(dlng / 2.0) ** 2
                    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
                    if (R * c) > 75.0:
                        user_lat = hub_lat
                        user_lng = hub_lng
                else:
                    user_lat = hub_lat
                    user_lng = hub_lng
                if not location_name:
                    location_name = hub_name

        if user_lat is None or user_lng is None:
            user_lat = 32.7157
            user_lng = -117.1611
            if not location_name:
                location_name = "San Diego, CA"

        clean_query = (query or "").strip()
        cache_key = (
            "v3",
            round(user_lat, 2),
            round(user_lng, 2),
            int(round(radius_miles)),
            clean_query.lower()
        )
        cached = PostgresDatabase.get_cached(PostgresDatabase._stores_cache_dict, cache_key, ttl=1800)
        if cached is not None:
            return cached

        stores = []
        seen_names = set()
        seen_place_ids = set()

        # 1. Query Google Places API if key is available
        google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
        if not google_maps_key:
            try:
                from config import GOOGLE_MAPS_API_KEY
                google_maps_key = GOOGLE_MAPS_API_KEY
            except Exception:
                pass

        if google_maps_key:
            search_text = f"{clean_query} game store" if clean_query else "Warhammer 40k game store"
            params = {
                "query": search_text,
                "location": f"{user_lat},{user_lng}",
                "radius": int(min(50000, radius_miles * 1609.34)),
                "key": google_maps_key
            }
            url = f"https://maps.googleapis.com/maps/api/place/textsearch/json?{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "EloRanking/1.0", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=3.5) as resp:
                    p_data = json.loads(resp.read().decode("utf-8"))
                    results = p_data.get("results", [])
                    for place in results:
                        status = place.get("business_status", "OPERATIONAL")
                        if status == "CLOSED_PERMANENTLY":
                            continue
                        pid = place.get("place_id") or ""
                        p_name = place.get("name", "Game Store").strip()
                        types = place.get("types") or []
                        if not self.is_valid_game_store_name(p_name, types=types, is_from_google_places=True):
                            continue
                        geom = place.get("geometry", {}).get("location", {})
                        p_lat = geom.get("lat")
                        p_lng = geom.get("lng")
                        if p_lat is None or p_lng is None:
                            continue

                        # Haversine distance
                        R = 3959.0
                        dlat = math.radians(p_lat - user_lat)
                        dlng = math.radians(p_lng - user_lng)
                        a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(p_lat)) * math.sin(dlng / 2.0) ** 2
                        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
                        dist = round(R * c, 1)

                        if dist > (radius_miles * 1.25):
                            continue

                        norm_name = p_name.lower().replace("'", "").replace('"', '').strip()
                        if pid and pid in seen_place_ids:
                            continue
                        if norm_name in seen_names:
                            continue

                        if pid:
                            seen_place_ids.add(pid)
                        seen_names.add(norm_name)

                        opening_hours = place.get("opening_hours") or {}
                        open_now = opening_hours.get("open_now")
                        photos = place.get("photos") or []
                        photo_ref = photos[0].get("photo_reference") if photos else None

                        is_gw_official = bool("warhammer" in norm_name or "games workshop" in norm_name)

                        # Check if website was already cached from Place Details
                        cached_details = PostgresDatabase.get_cached(PostgresDatabase._place_details_cache_dict, pid, ttl=86400 * 7) if pid else None
                        initial_website = cached_details.get("website") if cached_details else None
                        if not initial_website and is_gw_official:
                            initial_website = "https://www.warhammer.com/en-US/store-finder"

                        stores.append({
                            "id": pid or f"g_{len(stores)}",
                            "place_id": pid,
                            "name": p_name,
                            "address": place.get("formatted_address", ""),
                            "latitude": float(p_lat),
                            "longitude": float(p_lng),
                            "distance_miles": dist,
                            "rating": float(place.get("rating", 0.0)) if place.get("rating") else None,
                            "user_ratings_total": int(place.get("user_ratings_total", 0)),
                            "open_now": open_now,
                            "photo_reference": photo_ref,
                            "is_official_warhammer": is_gw_official,
                            "is_tournament_venue": False,
                            "tournament_count": 0,
                            "website": initial_website,
                            "source": "google_places"
                        })
            except Exception as e:
                logger.warning(f"Google Places TextSearch query notice: {e}")

        # 2. Query verified Warhammer tournament venues from PostgreSQL database (using fast spatial bounding box)
        try:
            lat_delta = (radius_miles * 1.25) / 69.0
            cos_lat = max(0.2, math.cos(math.radians(user_lat)))
            lng_delta = (radius_miles * 1.25) / (69.0 * cos_lat)
            min_lat = user_lat - lat_delta
            max_lat = user_lat + lat_delta
            min_lng = user_lng - lng_delta
            max_lng = user_lng + lng_delta

            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    cursor.execute("""
                        WITH venues_filtered AS (
                            SELECT 
                                COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') as venue_name,
                                e.city, e.state, e.country,
                                COALESCE(e.raw_json->>'address', e.raw_json->'location'->>'address', '') as address,
                                e.latitude as lat,
                                e.longitude as lng,
                                COUNT(*) as tournament_count,
                                MAX(e.event_date) as last_tournament_date,
                                MAX(COALESCE(
                                    NULLIF(TRIM(e.raw_json->>'website'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'website'), ''),
                                    NULLIF(TRIM(e.raw_json->>'url'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'url'), ''),
                                    NULLIF(TRIM(e.raw_json->>'facebook'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'facebook'), '')
                                )) as website
                            FROM events e
                            WHERE e.latitude BETWEEN %s AND %s
                              AND e.longitude BETWEEN %s AND %s
                              AND (e.venue IS NOT NULL OR e.venue_name IS NOT NULL OR e.raw_json->>'locationName' IS NOT NULL)
                            GROUP BY 1, 2, 3, 4, 5, 6, 7
                        ),
                        venues_dist AS (
                            SELECT *,
                                (3959.0 * acos(
                                    LEAST(1.0, GREATEST(-1.0,
                                        cos(radians(%s)) * cos(radians(lat)) * cos(radians(lng) - radians(%s)) +
                                        sin(radians(%s)) * sin(radians(lat))
                                    ))
                                )) AS distance_miles
                            FROM venues_filtered
                            WHERE lat IS NOT NULL AND lng IS NOT NULL
                              AND NOT (lat = 0.0 AND lng = 0.0)
                        )
                        SELECT venue_name, city, state, country, address, lat, lng,
                               tournament_count, last_tournament_date, website,
                               ROUND(distance_miles::numeric, 1) as distance_miles
                        FROM venues_dist
                        WHERE distance_miles <= %s
                        ORDER BY distance_miles ASC, tournament_count DESC
                        LIMIT 40;
                    """, (min_lat, max_lat, min_lng, max_lng, user_lat, user_lng, user_lat, radius_miles))
                    db_venues = cursor.fetchall()
                    for v in db_venues:
                        v_name = (v.get("venue_name") or "").strip()
                        if not v_name or len(v_name) < 3:
                            continue
                        if not self.is_valid_game_store_name(v_name, is_from_google_places=False):
                            continue
                        v_norm = v_name.lower().replace("'", "").replace('"', '').strip()
                        v_dist = float(v.get("distance_miles") or 0.0)
                        v_lat = float(v.get("lat") or 0.0)
                        v_lng = float(v.get("lng") or 0.0)
                        v_website = (v.get("website") or "").strip() or None
                        t_count = int(v.get("tournament_count") or 0)
                        last_date = v.get("last_tournament_date")
                        if hasattr(last_date, "isoformat"):
                            last_date = last_date.isoformat()

                        matched_existing = None
                        for s in stores:
                            s_norm = s["name"].lower().replace("'", "").replace('"', '').strip()
                            if s_norm in v_norm or v_norm in s_norm or (abs(s["latitude"] - v_lat) < 0.003 and abs(s["longitude"] - v_lng) < 0.003):
                                matched_existing = s
                                break

                        if matched_existing:
                            matched_existing["is_tournament_venue"] = True
                            matched_existing["tournament_count"] = max(matched_existing["tournament_count"], t_count)
                            matched_existing["last_tournament_date"] = last_date
                            if not matched_existing.get("website") and v_website:
                                matched_existing["website"] = v_website
                        else:
                            if v_norm not in seen_names:
                                seen_names.add(v_norm)
                                is_gw = bool("warhammer" in v_norm or "games workshop" in v_norm)
                                city_state = f"{v.get('city') or ''}, {v.get('state') or ''}".strip(', ')
                                full_addr = v.get("address") or city_state or location_name
                                venue_web = v_website or ("https://www.warhammer.com/en-US/store-finder" if is_gw else None)
                                stores.append({
                                    "id": f"db_{len(stores)}",
                                    "place_id": None,
                                    "name": v_name,
                                    "address": full_addr,
                                    "city": v.get("city") or "",
                                    "state": v.get("state") or "",
                                    "latitude": v_lat,
                                    "longitude": v_lng,
                                    "distance_miles": v_dist,
                                    "rating": None,
                                    "user_ratings_total": 0,
                                    "open_now": None,
                                    "photo_reference": None,
                                    "is_official_warhammer": is_gw,
                                    "is_tournament_venue": True,
                                    "tournament_count": t_count,
                                    "last_tournament_date": last_date,
                                    "website": venue_web,
                                    "source": "database_tournaments"
                                })
        except Exception as e:
            logger.warning(f"Database tournament venues notice: {e}")

        # Sort stores by distance
        stores.sort(key=lambda s: (s.get("distance_miles") if s.get("distance_miles") is not None else 9999.0))

        result = {
            "success": True,
            "stores": stores,
            "total_found": len(stores),
            "location": {
                "lat": user_lat,
                "lng": user_lng,
                "radius_miles": radius_miles,
                "location_name": location_name
            }
        }
        PostgresDatabase.set_cached(PostgresDatabase._stores_cache_dict, cache_key, result)
        return result

    def get_store_tournaments(
        self,
        store_name: str,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        place_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retrieves all verified Warhammer 40k tournaments hosted by a specific game store or venue.
        Matches by Google Place ID, spatial proximity (~350m), or normalized venue name.
        """
        clean_name = (store_name or "").strip()
        s_norm = clean_name.lower().replace("'", "").replace('"', '').strip()

        # Extract core name by removing common geographical / corporate suffixes
        core_name = s_norm
        for suffix in [" san diego", " llc", " inc", " store", " game store", " hobby shop", " games"]:
            if core_name.endswith(suffix):
                core_name = core_name[:-len(suffix)].strip()

        p_lat = None
        p_lng = None
        if lat is not None and lng is not None:
            try:
                p_lat = float(lat)
                p_lng = float(lng)
            except (ValueError, TypeError):
                p_lat = None
                p_lng = None

        events = []
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    # Spatial bounding box (~0.006 deg is ~600m)
                    min_lat = p_lat - 0.006 if p_lat is not None else None
                    max_lat = p_lat + 0.006 if p_lat is not None else None
                    min_lng = p_lng - 0.006 if p_lng is not None else None
                    max_lng = p_lng + 0.006 if p_lng is not None else None

                    like_name = f"%{clean_name}%" if clean_name else "%"
                    like_core = f"%{core_name}%" if core_name and len(core_name) >= 3 else like_name

                    sql = """
                    SELECT 
                        e.id,
                        e.name,
                        e.event_date,
                        e.end_date,
                        e.city,
                        e.state,
                        e.country,
                        COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') as venue,
                        COALESCE(e.address, e.raw_json->>'address', e.raw_json->'location'->>'address') as address,
                        COALESCE(
                            NULLIF(TRIM(e.raw_json->>'website'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'website'), ''),
                            NULLIF(TRIM(e.raw_json->>'url'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'url'), ''),
                            NULLIF(TRIM(e.raw_json->>'facebook'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'facebook'), '')
                        ) as venue_website,
                        COALESCE(e.total_players, 0) as total_players,
                        COALESCE(e.num_rounds, 0) as num_rounds,
                        COALESCE(e.current_round, 0) as current_round,
                        e.is_ended,
                        e.event_type,
                        e.latitude,
                        e.longitude,
                        e.place_id,
                        COALESCE(
                            w.winner_name,
                            e.raw_json->>'winnerName',
                            e.raw_json->'winner'->>'name'
                        ) as winner_name,
                        w.winner_faction
                    FROM events e
                    LEFT JOIN LATERAL (
                        SELECT ep.full_name as winner_name, ep.faction as winner_faction
                        FROM event_participants ep
                        WHERE ep.event_id = e.id AND ep.placement = 1
                        ORDER BY ep.placement ASC
                        LIMIT 1
                    ) w ON true
                    WHERE 
                        (
                            %s IS NOT NULL AND %s IS NOT NULL
                            AND e.latitude BETWEEN %s AND %s
                            AND e.longitude BETWEEN %s AND %s
                        )
                        OR (
                            %s IS NOT NULL AND %s != ''
                            AND (
                                e.place_id = %s
                                OR e.raw_json->>'place_id' = %s
                                OR e.raw_json->'location'->>'placeId' = %s
                            )
                        )
                        OR (
                            %s IS NOT NULL AND %s != ''
                            AND (
                                COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') ILIKE %s
                                OR COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') ILIKE %s
                            )
                        )
                    ORDER BY e.event_date DESC NULLS LAST;
                    """

                    params = (
                        min_lat, min_lng, min_lat, max_lat, min_lng, max_lng,
                        place_id, place_id, place_id, place_id, place_id,
                        clean_name, clean_name, like_name, like_core
                    )

                    cursor.execute(sql, params)
                    raw_rows = cursor.fetchall()

                    seen_ids = set()
                    found_website = None
                    for r in raw_rows:
                        eid = str(r.get("id"))
                        if eid in seen_ids:
                            continue

                        v_name = (r.get("venue") or "").strip()
                        v_norm = v_name.lower().replace("'", "").replace('"', '').strip()
                        ev_lat = r.get("latitude")
                        ev_lng = r.get("longitude")
                        ev_pid = r.get("place_id")

                        is_match = False
                        if place_id and ev_pid and ev_pid == place_id:
                            is_match = True
                        elif p_lat is not None and p_lng is not None and ev_lat is not None and ev_lng is not None:
                            if abs(p_lat - float(ev_lat)) < 0.0035 and abs(p_lng - float(ev_lng)) < 0.0035:
                                is_match = True

                        if not is_match and s_norm and v_norm and len(v_norm) >= 3:
                            if s_norm in v_norm or v_norm in s_norm:
                                is_match = True
                            elif core_name and len(core_name) >= 3 and (core_name in v_norm or v_norm in core_name):
                                is_match = True

                        if is_match:
                            seen_ids.add(eid)
                            if not found_website and r.get("venue_website"):
                                found_website = (r.get("venue_website") or "").strip() or None

                            ed = r.get("event_date")
                            if hasattr(ed, "isoformat"):
                                ed = ed.isoformat()
                            end_d = r.get("end_date")
                            if hasattr(end_d, "isoformat"):
                                end_d = end_d.isoformat()

                            events.append({
                                "id": eid,
                                "name": r.get("name") or "Tournament",
                                "event_date": ed,
                                "end_date": end_d,
                                "city": r.get("city") or "",
                                "state": r.get("state") or "",
                                "country": r.get("country") or "",
                                "venue": v_name,
                                "address": r.get("address") or "",
                                "total_players": int(r.get("total_players") or 0),
                                "num_rounds": int(r.get("num_rounds") or 0),
                                "current_round": int(r.get("current_round") or 0),
                                "is_ended": bool(r.get("is_ended")),
                                "event_type": r.get("event_type") or "singles",
                                "winner_name": r.get("winner_name"),
                                "winner_faction": r.get("winner_faction")
                            })
        except Exception as e:
            logger.error(f"Error getting store tournaments for {store_name}: {e}")

        if not found_website and place_id:
            cached_d = PostgresDatabase.get_cached(PostgresDatabase._place_details_cache_dict, place_id, ttl=86400 * 7)
            if cached_d and cached_d.get("website"):
                found_website = cached_d.get("website")

        return {
            "success": True,
            "store_name": clean_name,
            "store_website": found_website,
            "total_tournaments": len(events),
            "tournaments": events
        }

    def get_place_details(self, place_id: str) -> Dict[str, Any]:
        """
        Fetches Google Place Details (website, maps url, phone) with in-memory 7-day caching.
        """
        if not place_id or not place_id.strip():
            return {"success": False, "error": "Missing place_id"}

        clean_pid = place_id.strip()
        cached = PostgresDatabase.get_cached(PostgresDatabase._place_details_cache_dict, clean_pid, ttl=86400 * 7)
        if cached is not None:
            return cached

        google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
        if not google_maps_key:
            try:
                from config import GOOGLE_MAPS_API_KEY
                google_maps_key = GOOGLE_MAPS_API_KEY
            except Exception:
                pass

        if not google_maps_key:
            return {"success": False, "error": "GOOGLE_MAPS_API_KEY not configured"}

        url = f"https://maps.googleapis.com/maps/api/place/details/json?place_id={urllib.parse.quote(clean_pid)}&fields=website,url,formatted_phone_number,name&key={google_maps_key}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EloRanking/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                result = data.get("result", {})
                website = (result.get("website") or "").strip() or None
                maps_url = result.get("url") or None
                phone = result.get("formatted_phone_number") or None
                name = result.get("name") or None
                res = {
                    "success": True,
                    "place_id": clean_pid,
                    "name": name,
                    "website": website,
                    "maps_url": maps_url,
                    "phone": phone
                }
                PostgresDatabase.set_cached(PostgresDatabase._place_details_cache_dict, clean_pid, res)
                return res
        except Exception as e:
            logger.warning(f"Error fetching Google Place details for {clean_pid}: {e}")
            return {"success": False, "error": str(e)}

    def get_community_chat_messages(self, region: str = "socal", limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves recent community messages for regional channel."""
        limit = max(1, min(int(limit or 50), 100))
        region_key = (region or "socal").strip().lower()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT id, region, sender_id, sender_name, sender_role, sender_elo, message_text, created_at
                    FROM community_chat_messages
                    WHERE region = %s OR region = 'global'
                    ORDER BY created_at ASC
                    LIMIT %s;
                """, (region_key, limit))
                rows = cursor.fetchall()
                res = []
                for r in rows:
                    d = dict(r)
                    if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
                        d["created_at"] = d["created_at"].isoformat()
                    res.append(d)
                return res

    def save_community_chat_message(
        self,
        region: str,
        sender_id: str,
        sender_name: str,
        sender_role: str = "player",
        sender_elo: Optional[float] = None,
        message_text: str = ""
    ) -> Dict[str, Any]:
        """Saves new community chat message."""
        import uuid
        msg_id = str(uuid.uuid4())
        region_key = (region or "socal").strip().lower()
        cleaned_text = (message_text or "").strip()
        if not cleaned_text:
            return {"success": False, "error": "Message text cannot be empty"}

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                cursor.execute("""
                    INSERT INTO community_chat_messages (
                        id, region, sender_id, sender_name, sender_role, sender_elo, message_text, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    RETURNING created_at;
                """, (msg_id, region_key, sender_id, sender_name, sender_role, sender_elo, cleaned_text))
                row = cursor.fetchone()
                conn.commit()
                created_at = row["created_at"] if row else None
                created_at_str = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
                return {
                    "success": True,
                    "message": {
                        "id": msg_id,
                        "region": region_key,
                        "sender_id": sender_id,
                        "sender_name": sender_name,
                        "sender_role": sender_role,
                        "sender_elo": sender_elo,
                        "message_text": cleaned_text,
                        "created_at": created_at_str
                    }
                }


class PostgresConnectionContext:
    """Manages connection acquisition and release back to ThreadedConnectionPool."""
    def __init__(self, pool_instance, conn):
        self.pool = pool_instance
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is not None:
                self.conn.rollback()
            else:
                self.conn.commit()
        except Exception:
            try:
                self.conn.rollback()
            except Exception:
                pass
        finally:
            is_broken = False
            try:
                if self.conn.closed:
                    is_broken = True
                elif exc_val is not None:
                    err_msg = str(exc_val).lower()
                    if "closed" in err_msg or "terminat" in err_msg or "broken" in err_msg or "ssl" in err_msg:
                        is_broken = True
            except Exception:
                is_broken = True
            self.pool.putconn(self.conn, close=is_broken)


# Compatibility Aliases
Database = PostgresDatabase

def get_db(dsn: Optional[str] = None, db_path: Optional[str] = None, *args, **kwargs) -> PostgresDatabase:
    """Returns the active PostgresDatabase instance."""
    return PostgresDatabase(dsn=dsn)

get_database = get_db
