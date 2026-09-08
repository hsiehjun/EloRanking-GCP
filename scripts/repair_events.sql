-- ============================================================================
-- SQL Script: Repair Event Records in PostgreSQL
-- Restores authentic event metadata (name, is_ended, total_players, num_rounds,
-- and started) directly from the canonical raw_json stored on each event row.
-- ============================================================================

-- Option 1: Explicit update for the specific affected events
UPDATE events
SET 
    name = CASE id
        WHEN 'T7olutX9PTqa' THEN 'Warhammer 40,000 Grand Tournament - Warhammer Open Tacoma'
        WHEN 'FKsBtHi4ZqHx' THEN 'Bay Area Open 2026 - Warhammer 40k Champs'
        WHEN 'uZ4qxIz8T6a8' THEN 'The Riverside Classic by Green Banner Event Co.'
        ELSE name
    END,
    total_players = CASE id
        WHEN 'T7olutX9PTqa' THEN 530
        WHEN 'FKsBtHi4ZqHx' THEN 161
        WHEN 'uZ4qxIz8T6a8' THEN 32
        WHEN 'c86QdBEbES'   THEN 5
        ELSE total_players
    END,
    num_rounds = CASE id
        WHEN 'T7olutX9PTqa' THEN 8
        WHEN 'FKsBtHi4ZqHx' THEN 6
        WHEN 'uZ4qxIz8T6a8' THEN 5
        WHEN 'c86QdBEbES'   THEN 3
        ELSE num_rounds
    END,
    is_ended = CASE id
        WHEN 'T7olutX9PTqa' THEN TRUE
        WHEN 'FKsBtHi4ZqHx' THEN TRUE
        WHEN 'uZ4qxIz8T6a8' THEN TRUE
        WHEN 'c86QdBEbES'   THEN TRUE
        ELSE is_ended
    END,
    started = CASE id
        WHEN 'T7olutX9PTqa' THEN TRUE
        WHEN 'FKsBtHi4ZqHx' THEN TRUE
        WHEN 'uZ4qxIz8T6a8' THEN TRUE
        WHEN 'c86QdBEbES'   THEN TRUE
        ELSE started
    END
WHERE id IN ('T7olutX9PTqa', 'FKsBtHi4ZqHx', 'uZ4qxIz8T6a8', 'c86QdBEbES');

-- Option 2: General self-healing statement that fixes ANY event in the database
-- whose columns were corrupted with placeholder values but has authentic raw_json:
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
