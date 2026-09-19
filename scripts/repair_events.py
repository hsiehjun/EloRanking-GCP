"""Standalone maintenance script to heal corrupted event metadata in PostgreSQL from raw_json."""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from database import get_database

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("repair_events")

SQL_REPAIR = """
UPDATE events
SET
    name = CASE 
        WHEN NULLIF(raw_json->>'name', '') IS NOT NULL 
             AND raw_json->>'name' NOT IN ('Tournament', 'Unnamed Tournament', 'Tournament Details')
        THEN raw_json->>'name'
        ELSE name 
    END,
    total_players = CASE 
        WHEN (total_players IS NULL OR total_players = 0) 
             AND (raw_json->>'totalPlayers') ~ '^[0-9]+$' 
             AND (raw_json->>'totalPlayers')::int > 0
        THEN (raw_json->>'totalPlayers')::int
        ELSE total_players
    END,
    num_rounds = CASE 
        WHEN (raw_json->>'numberOfRounds') ~ '^[0-9]+$' 
             AND (raw_json->>'numberOfRounds')::int > 0
        THEN (raw_json->>'numberOfRounds')::int
        WHEN (raw_json->>'numRounds') ~ '^[0-9]+$' 
             AND (raw_json->>'numRounds')::int > 0
        THEN (raw_json->>'numRounds')::int
        ELSE num_rounds
    END,
    is_ended = CASE 
        WHEN raw_json->>'ended' = 'true' 
             OR raw_json->>'isEnded' = 'true' 
             OR raw_json->'status'->>'ended' = 'true'
        THEN TRUE
        ELSE is_ended
    END,
    started = CASE 
        WHEN raw_json->>'started' = 'true' 
             OR raw_json->'status'->>'started' = 'true'
        THEN TRUE
        ELSE started
    END
WHERE raw_json IS NOT NULL
  AND (
      (name IN ('Tournament', 'Unnamed Tournament', 'Tournament Details') AND raw_json->>'name' NOT IN ('Tournament', 'Unnamed Tournament', 'Tournament Details'))
      OR (is_ended = FALSE AND (raw_json->>'ended' = 'true' OR raw_json->>'isEnded' = 'true' OR raw_json->'status'->>'ended' = 'true'))
      OR ((total_players IS NULL OR total_players = 0) AND (raw_json->>'totalPlayers') ~ '^[0-9]+$' AND (raw_json->>'totalPlayers')::int > 0)
  );
"""

def main():
    db = get_database()
    logger.info(f"Connecting to database: {db.db_path}")
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(SQL_REPAIR)
            count = cur.rowcount
            conn.commit()
            logger.info(f"✅ Successfully healed {count} event record(s) from authentic raw_json!")

if __name__ == "__main__":
    main()
