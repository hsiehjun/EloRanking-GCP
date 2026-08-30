"""PostgreSQL Database backend for Warhammer 40k Elo Ranking and BCP scraper."""

import json
import logging
import math
import os
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

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

    def __init__(self, dsn: Optional[str] = None, db_path: Optional[str] = None, *args, **kwargs):
        if not PSYCOPG2_AVAILABLE:
            raise ImportError("psycopg2 is not installed. Run 'pip install psycopg2-binary' or 'sudo apt install python3-psycopg2'.")

        raw_dsn = dsn or os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or "postgresql://elo_user:Jung@1475369@localhost:5432/elo_ranking"
        
        # Strip erroneous 'postgresql://' prefix if followed by keyword syntax (e.g. 'postgresql://elo_user password=...' or 'postgresql://dbname=...')
        if raw_dsn.startswith("postgresql://") and (" " in raw_dsn or "password=" in raw_dsn or "host=" in raw_dsn):
            cleaned = raw_dsn.replace("postgresql://", "").strip()
            if "dbname=" not in cleaned:
                cleaned = "dbname=elo_ranking " + cleaned
            if "user=" not in cleaned and "elo_user" in cleaned:
                cleaned = cleaned.replace("elo_user", "user=elo_user")
            raw_dsn = cleaned

        # If already in keyword DSN format (e.g. dbname=... user=... password=... host=...)
        if raw_dsn.startswith("dbname=") or ("user=" in raw_dsn and "password=" in raw_dsn):
            self.dsn = raw_dsn
        elif "/cloudsql/" in raw_dsn:
            try:
                import urllib.parse
                parsed = urllib.parse.urlparse(raw_dsn)
                qs = urllib.parse.parse_qs(parsed.query)
                host = qs.get("host", [""])[0] or (f"/cloudsql/{parsed.hostname}" if parsed.hostname else "")
                dbname = parsed.path.lstrip("/") or "elo_ranking"
                user = urllib.parse.unquote(parsed.username or "elo_user")
                password = urllib.parse.unquote(parsed.password or "")
                self.dsn = f"dbname={dbname} user={user} password={password} host={host}"
            except Exception as e:
                logger.warning(f"Error normalizing Cloud SQL DSN: {e}")
                self.dsn = raw_dsn
        else:
            self.dsn = raw_dsn

        if PostgresDatabase._pool is None:
            try:
                PostgresDatabase._pool = pool.ThreadedConnectionPool(
                    minconn=2,
                    maxconn=60,
                    dsn=self.dsn
                )
                logger.info(f"PostgreSQL connection pool initialized with DSN: {self._sanitize_dsn(self.dsn)}")
            except Exception as e:
                logger.error(f"Failed to connect to PostgreSQL pool ({self._sanitize_dsn(self.dsn)}): {e}")
                raise

        if not PostgresDatabase._db_initialized:
            self.init_db()
            self.ensure_tracker_table()
            PostgresDatabase._db_initialized = True

    @property
    def db_path(self) -> str:
        return self._sanitize_dsn(self.dsn)

    def _sanitize_dsn(self, dsn: str) -> str:
        if "@" in dsn:
            return dsn.split("@")[-1]
        return dsn

    def get_connection(self):
        """Context manager yielding a pooled PostgreSQL connection."""
        conn = PostgresDatabase._pool.getconn()
        return PostgresConnectionContext(PostgresDatabase._pool, conn)

    def init_db(self):
        """Creates PostgreSQL tables and performance indexes safely without deadlocking with active scraping jobs."""
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '4s';")
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
        for migration in [
            "ALTER TABLE players ADD COLUMN IF NOT EXISTS team TEXT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS team TEXT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS placement INT;",
            "ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS battle_points INT;",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p1 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS user_id_p2 VARCHAR(64);",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p1_role TEXT DEFAULT 'player1';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS p2_role TEXT DEFAULT 'player2';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS referee_ids TEXT[] DEFAULT '{}';",
            "ALTER TABLE tracker_games ADD COLUMN IF NOT EXISTS state_json JSONB;",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid1 ON tracker_games(user_id_p1);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid2 ON tracker_games(user_id_p2);"
        ]:
            try:
                with self.get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(migration)
                    conn.commit()
            except Exception as e:
                logger.debug(f"Migration notice: {e}")

    def ensure_tracker_table(self):
        """Guarantees that tracker_games table and all required columns exist."""
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
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_updated ON tracker_games(updated_at DESC);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_p1 ON tracker_games(p1_name);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_p2 ON tracker_games(p2_name);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid1 ON tracker_games(user_id_p1);",
            "CREATE INDEX IF NOT EXISTS idx_tracker_games_uid2 ON tracker_games(user_id_p2);"
        ]
        for s in stmts:
            try:
                with self.get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(s)
                    conn.commit()
            except Exception as e:
                logger.debug(f"Tracker ensure table notice: {e}")

    def upsert_event(self, event_data: Dict[str, Any]):
        """Inserts or updates an event record in PostgreSQL."""
        event_id = event_data.get("id") or event_data.get("objectId")
        if not event_id:
            return

        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO events (
                    id, name, event_date, end_date, city, state, country,
                    total_players, num_rounds, current_round, is_ended,
                    game_system_id, raw_json, scraped_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    scraped_at = EXCLUDED.scraped_at;
                """, (
                    event_id,
                    event_data.get("name") or "Unnamed Tournament",
                    event_data.get("eventDate") or event_data.get("event_date"),
                    event_data.get("endDate") or event_data.get("end_date"),
                    event_data.get("city"),
                    event_data.get("state"),
                    event_data.get("country"),
                    event_data.get("totalPlayers", event_data.get("total_players", 0)),
                    event_data.get("numberOfRounds", event_data.get("num_rounds", 0)),
                    event_data.get("currentRound", event_data.get("current_round", 0)),
                    bool(event_data.get("isEnded", event_data.get("is_ended", False))),
                    event_data.get("gameSystemId", event_data.get("game_system_id")),
                    json.dumps(event_data.get("raw_json", event_data)),
                    datetime.now(timezone.utc)
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
        battle_points: Optional[int] = None
    ):
        """Inserts or updates a tournament participant with team affiliation and official BCP placing."""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                INSERT INTO event_participants (
                    event_id, player_id, first_name, last_name, full_name, faction, team, dropped, checked_in, placement, battle_points
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (event_id, player_id) DO UPDATE SET
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    full_name = EXCLUDED.full_name,
                    faction = EXCLUDED.faction,
                    team = COALESCE(NULLIF(EXCLUDED.team, ''), event_participants.team),
                    dropped = EXCLUDED.dropped,
                    checked_in = EXCLUDED.checked_in,
                    placement = COALESCE(EXCLUDED.placement, event_participants.placement),
                    battle_points = COALESCE(EXCLUDED.battle_points, event_participants.battle_points);
                """, (event_id, player_id, first_name, last_name, full_name, faction, team or None, dropped, checked_in, placement, battle_points))
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
                SELECT DISTINCT top_faction as f 
                FROM player_ratings 
                WHERE top_faction IS NOT NULL AND TRIM(top_faction) != '' AND top_faction != 'Unknown Faction'
                ORDER BY f;
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
                        SELECT player1_id as p_id, (player1_faction ILIKE %s) as is_match_fac
                        FROM matches
                        WHERE player1_id IS NOT NULL AND player1_id != '' AND is_done = TRUE
                          AND player1_faction ILIKE %s
                        UNION ALL
                        SELECT player2_id as p_id, (player2_faction ILIKE %s) as is_match_fac
                        FROM matches
                        WHERE player2_id IS NOT NULL AND player2_id != '' AND is_bye = FALSE AND is_done = TRUE
                          AND player2_faction ILIKE %s
                    )
                    SELECT COUNT(DISTINCT fpm.p_id) as total_count
                    FROM faction_player_matches fpm
                    LEFT JOIN player_ratings r ON fpm.p_id = r.player_id
                    WHERE 1=1
                    """
                    count_params = [f"%{faction}%", f"%{faction}%", f"%{faction}%", f"%{faction}%"]
                    if query:
                        count_sql += " AND (r.player_name ILIKE %s OR fpm.p_id = %s)"
                        count_params.extend([f"%{query}%", query])

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
                        MAX(fpm.m_date) as last_active_date
                    FROM faction_player_matches fpm
                    LEFT JOIN player_ratings r ON fpm.p_id = r.player_id
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
                where_clauses = ["matches_played >= %s"]
                params = [min_matches]
                if query:
                    where_clauses.append("(player_name ILIKE %s OR player_id = %s)")
                    params.extend([f"%{query}%", query])

                where_sql = "WHERE " + " AND ".join(where_clauses)
                
                cursor.execute(f"SELECT COUNT(*) as total_count FROM player_ratings {where_sql};", params)
                total_count = cursor.fetchone()["total_count"] or 0

                sql = f"""
                SELECT player_id, player_name, current_elo, peak_elo,
                       matches_played, wins, losses, draws, win_rate,
                       top_faction, team, last_active_date
                FROM player_ratings
                {where_sql}
                ORDER BY {col} {dir_str} NULLS LAST
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
                       total_players, num_rounds, current_round, is_ended
                FROM events
                WHERE id = %s;
                """, (event_id,))
                event_row = cursor.fetchone()
                if not event_row:
                    event_row = {
                        "id": event_id,
                        "name": "Tournament",
                        "event_date": None,
                        "city": "",
                        "state": "",
                        "country": "",
                        "total_players": 0,
                        "num_rounds": 0,
                        "current_round": 0,
                        "is_ended": False
                    }
                res = dict(event_row)

                # 2. Match pairings
                cursor.execute("""
                SELECT id, event_id, round, table_number, match_date,
                       player1_id, player1_name, player1_faction, player1_score,
                       player2_id, player2_name, player2_faction, player2_score,
                       winner_id, loser_id, is_draw, is_bye, is_done
                FROM matches
                WHERE event_id = %s
                ORDER BY round ASC, table_number ASC;
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
                    ep.placement,
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
                                "current_elo": p_info.get("current_elo", 1500.0),
                                "peak_elo": p_info.get("peak_elo", 1500.0),
                                "global_win_rate": p_info.get("global_win_rate", 0.0),
                                "event_wins": 0,
                                "event_losses": 0,
                                "event_draws": 0,
                                "event_matches_count": 0,
                                "event_battle_points": 0,
                                "round_wins": {},
                                "opponents": []
                            }
                        ps = player_stats[p1_id]
                        ps["event_matches_count"] += 1
                        ps["event_battle_points"] += p1_score
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
                                "current_elo": p_info.get("current_elo", 1500.0),
                                "peak_elo": p_info.get("peak_elo", 1500.0),
                                "global_win_rate": p_info.get("global_win_rate", 0.0),
                                "event_wins": 0,
                                "event_losses": 0,
                                "event_draws": 0,
                                "event_matches_count": 0,
                                "event_battle_points": 0,
                                "round_wins": {},
                                "opponents": []
                            }
                        ps = player_stats[p2_id]
                        ps["event_matches_count"] += 1
                        ps["event_battle_points"] += p2_score
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

                # Add any enrolled players who haven't played a round yet
                for p_id, p_info in participants.items():
                    if p_id not in player_stats:
                        player_stats[p_id] = {
                            "player_id": p_id,
                            "full_name": p_info.get("full_name") or "Player",
                            "faction": p_info.get("faction") or "Unknown",
                            "team": p_info.get("team") or "",
                            "dropped": p_info.get("dropped", False),
                            "checked_in": p_info.get("checked_in", True),
                            "current_elo": p_info.get("current_elo", 1500.0),
                            "peak_elo": p_info.get("peak_elo", 1500.0),
                            "global_win_rate": p_info.get("global_win_rate", 0.0),
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_matches_count": 0,
                            "event_battle_points": 0,
                            "round_wins": {},
                            "opponents": []
                        }

                # Compute win% and Path to Victory (PTV)
                for p_id, ps in player_stats.items():
                    tot = ps["event_matches_count"]
                    ps["win_pct"] = (ps["event_wins"] + 0.5 * ps["event_draws"]) / max(1, tot)
                    ptv = 0
                    for r, w in ps["round_wins"].items():
                        if w == 1:
                            ptv += (1 << (r - 1))
                    ps["ptv"] = ptv

                # Compute Opponent Game Win % (SoS)
                for p_id, ps in player_stats.items():
                    opp_pcts = [max(0.33, player_stats[opp]["win_pct"]) for opp in ps["opponents"] if opp in player_stats]
                    ps["sos"] = sum(opp_pcts) / max(1, len(opp_pcts)) if opp_pcts else 0.0

                # Sort by BCP Official Tiebreakers:
                # 1. Match Wins
                # 2. Path to Victory (PTV)
                # 3. Opponent Win % (SoS)
                # 4. Battle Points
                sorted_roster = sorted(
                    player_stats.values(),
                    key=lambda p: (
                        p["event_wins"] + 0.5 * p["event_draws"],
                        p["ptv"],
                        p["sos"],
                        p["event_battle_points"],
                        p["current_elo"]
                    ),
                    reverse=True
                )

                for rank_idx, p in enumerate(sorted_roster, 1):
                    p["placement"] = rank_idx

                res["players"] = sorted_roster
                res["matches"] = matches
                res["total_players"] = res.get("total_players") or len(sorted_roster)
                res["num_rounds"] = res.get("num_rounds") or (max([m["round"] for m in matches]) if matches else 0)
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
        limit: int = 25
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
                    # Detect home region
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

                where_clauses = ["e.event_date >= CURRENT_DATE", "e.is_ended = FALSE"]
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
                    COALESCE(NULLIF(e.raw_json->>'numTickets', '')::int, NULLIF(e.raw_json->>'queryNumPlayers', '')::int, e.total_players) as max_capacity,
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
                    cap = int(r.get("max_capacity") or enrolled)
                    r["enrolled_count"] = enrolled
                    r["capacity_cap"] = cap

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

                # Sort primarily by proximity (distance in miles), then by date soonest
                def sort_key(e):
                    d = e.get("distance_miles")
                    d_score = d if d is not None else 99999.0
                    dt = e.get("event_date")
                    dt_ts = dt.timestamp() if dt else 9999999999.0
                    return (d_score, dt_ts)

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
                    COUNT(ep.player_id) as total_enrolled,
                    COUNT(pr.player_id) as rated_players_count
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

                if status == "completed":
                    where_clauses.append("e.is_ended = TRUE")
                elif status == "in_progress":
                    where_clauses.append("e.is_ended = FALSE")

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
                    "match_count": "e.total_players",
                    "is_ended": "e.is_ended"
                }
                col = allowed_cols.get(sort_by, "e.event_date")

                sql = f"""
                SELECT e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country,
                       e.total_players, e.num_rounds, e.current_round, e.is_ended,
                       (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id) as match_count
                FROM events e
                WHERE {where_sql}
                ORDER BY {col} {dir_str} NULLS LAST
                LIMIT %s OFFSET %s;
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
                        (0.40 * MAX(tm.current_elo) + 0.60 * AVG(tm.current_elo)) +
                        (((SUM(tm.wins) + 20.0) / (SUM(tm.matches_played) + 40.0) - 0.50) * 80.0) +
                        (50.0 * LOG(GREATEST(1.0, SUM(tm.wins)::numeric) + 1.0)) +
                        (2.0 * COUNT(DISTINCT tm.player_id)::numeric) +
                        (35.0 * LOG(GREATEST(1.0, COUNT(DISTINCT tm.player_id)::numeric)))
                    )::numeric, 1) as power_rating,
                    CASE WHEN COUNT(DISTINCT tm.player_id) >= 3 AND SUM(tm.matches_played) >= 20 THEN TRUE ELSE FALSE END as is_qualified
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

    def get_teams_leaderboard(self, page=1, page_size=25, min_members=2, limit=None, query=None, sort_by="power_rating", order="DESC") -> Dict[str, Any]:
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
                avg_elo = round(sum(p["current_elo"] for p in roster) / len(roster), 1)
                top_elo = roster[0]["current_elo"] if roster else 1500.0
                win_rate = round((total_wins / total_matches) * 100.0, 1) if total_matches > 0 else 0.0
                bayes_wr = (total_wins + 20.0) / (total_matches + 40.0) if (total_matches + 40.0) > 0 else 0.50
                power_rating = round(
                    (0.40 * top_elo + 0.60 * avg_elo) +
                    ((bayes_wr - 0.50) * 80.0) +
                    (50.0 * math.log10(max(1.0, total_wins) + 1.0)) +
                    (2.0 * len(roster)) +
                    (35.0 * math.log10(max(1.0, len(roster)))),
                    1
                )

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
                        "win_rate": win_rate
                    }
                }
                PostgresDatabase.set_cached(PostgresDatabase._team_roster_cache_dict, cache_key, res)
                return res

    def get_faction_meta_stats(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Returns overall faction balance metrics, timeline trends, and tier ratings (instant cached)."""
        cache_key = f"{start_date}_{end_date}"
        cached = PostgresDatabase.get_cached(PostgresDatabase._faction_meta_cache_dict, cache_key, ttl=300)
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
            if "score" in p_obj and isinstance(p_obj["score"], (int, float)):
                return int(p_obj["score"])
            pri = sum([r.get("primaryScore", 0) for r in p_obj.get("rounds", []) if isinstance(r, dict)])
            sec = sum([r.get("secondaryScore", 0) for r in p_obj.get("rounds", []) if isinstance(r, dict)])
            paint = 10 if p_obj.get("battleReady", True) else 0
            return min(100, min(50, pri) + min(40, sec) + paint)

        p1_score = calc_vp(state.get("p1"))
        p2_score = calc_vp(state.get("p2"))
        if p1_score == 0 and "p1Score" in state:
            p1_score = int(state["p1Score"])
        if p2_score == 0 and "p2Score" in state:
            p2_score = int(state["p2Score"])

        is_finished = current_round >= 5 and started

        winner_name = None
        if is_finished:
            if p1_score > p2_score:
                winner_name = p1_name
            elif p2_score > p1_score:
                winner_name = p2_name
            else:
                winner_name = "Tied"

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
                        version, state_json, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s::text[],
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s::jsonb, NOW()
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
                        updated_at = NOW();
                    """, (
                        match_id, p1_name, p1_faction, p1_detachment, p1_score,
                        p2_name, p2_faction, p2_detachment, p2_score,
                        str(uid_p1) if uid_p1 else None,
                        str(uid_p2) if uid_p2 else None,
                        refs_sql,
                        primary_mission, deployment, mission_rule,
                        current_round, started, is_finished, winner_name,
                        version, json.dumps(state)
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
                            conditions.append("((user_id_p1 = %s OR user_id_p2 = %s) OR (p1_name ILIKE %s OR p2_name ILIKE %s))")
                            params.extend([user_id, user_id, f"%{user_name}%", f"%{user_name}%"])
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
            self.pool.putconn(self.conn)


# Compatibility Aliases
Database = PostgresDatabase

def get_db(dsn: Optional[str] = None, db_path: Optional[str] = None, *args, **kwargs) -> PostgresDatabase:
    """Returns the active PostgresDatabase instance."""
    return PostgresDatabase(dsn=dsn)
