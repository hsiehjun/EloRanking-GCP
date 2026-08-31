"""Wahapedia 11th Edition PostgreSQL Database Sync Engine & Service.

Periodically syncs all 11th edition data (datasheets, models, weapons, abilities,
keywords, point costs, stratagems, enhancements, detachment rules) from Wahapedia
directly into PostgreSQL for instant sub-millisecond lookup and universal army list
auto-enrichment.
"""

import os
import csv
import io
import time
import logging
import urllib.request
from typing import Dict, List, Optional, Any

from database import get_db, PostgresDatabase

logger = logging.getLogger("elo.wahapedia")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BASE_URL = "https://wahapedia.ru/wh40k11ed"

TABLE_MAPPING = {
    "Factions.csv": "waha_factions",
    "Source.csv": "waha_sources",
    "Datasheets.csv": "waha_datasheets",
    "Datasheets_models.csv": "waha_datasheet_models",
    "Datasheets_wargear.csv": "waha_datasheet_wargear",
    "Datasheets_abilities.csv": "waha_datasheet_abilities",
    "Datasheets_keywords.csv": "waha_datasheet_keywords",
    "Datasheets_models_cost.csv": "waha_datasheet_costs",
    "Datasheets_leader.csv": "waha_datasheet_leaders",
    "Stratagems.csv": "waha_stratagems",
    "Enhancements.csv": "waha_enhancements",
    "Abilities.csv": "waha_army_abilities",
    "Detachment_abilities.csv": "waha_detachment_abilities",
    "Detachments.csv": "waha_detachments"
}


class WahapediaSync:
    """Manages downloading, parsing, and storing Wahapedia 11th edition datasets into PostgreSQL."""

    def __init__(self, db: Optional[PostgresDatabase] = None):
        self.db = db or get_db()

    def get_last_remote_update(self) -> Optional[str]:
        """Fetches the last_update timestamp string from Wahapedia."""
        url = f"{BASE_URL}/Last_update.csv"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                text = resp.read().decode("utf-8", errors="ignore").strip()
                lines = text.split("\n")
                if len(lines) > 1:
                    return lines[1].replace("|", "").strip()
                elif len(lines) == 1 and "|" in lines[0]:
                    parts = lines[0].split("|")
                    if len(parts) > 1 and parts[1]:
                        return parts[1].strip()
        except Exception as e:
            logger.warning(f"Failed to check Wahapedia Last_update.csv: {e}")
        return None

    def fetch_csv(self, filename: str) -> List[List[str]]:
        """Downloads and parses a pipe-delimited CSV from Wahapedia."""
        url = f"{BASE_URL}/{filename}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; EloRanking/1.0)"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw_text = resp.read().decode("utf-8-sig", errors="ignore")
            reader = csv.reader(io.StringIO(raw_text), delimiter="|")
            rows = list(reader)
            cleaned_rows = []
            for r in rows:
                if r and r[-1] == "":
                    r = r[:-1]
                if any(r):
                    cleaned_rows.append(r)
            return cleaned_rows

    def sync_all(self, force: bool = False) -> Dict[str, Any]:
        """Downloads all 11th edition CSV tables and bulk-ingests them into PostgreSQL."""
        remote_update = self.get_last_remote_update()
        local_status = self.db.waha_get_sync_status()

        if not force and remote_update and local_status.get("last_update") == remote_update and local_status.get("counts", {}).get("waha_datasheets", 0) > 0:
            logger.info("Wahapedia PostgreSQL data is already up-to-date. Skipping sync.")
            return {
                "success": True,
                "status": "already_up_to_date",
                "last_update": remote_update,
                "counts": local_status["counts"]
            }

        start_time = time.time()
        logger.info(f"Starting Wahapedia 11th Edition PostgreSQL sync (force={force})...")

        results = {}
        from psycopg2 import extras

        with self.db.get_connection() as conn:
            with conn.cursor() as cursor:
                for filename, table_name in TABLE_MAPPING.items():
                    try:
                        rows = self.fetch_csv(filename)
                        if not rows:
                            results[filename] = 0
                            continue

                        header = rows[0]
                        data_rows = rows[1:]

                        # Truncate table in PostgreSQL
                        cursor.execute(f"TRUNCATE TABLE {table_name};")

                        if data_rows:
                            num_cols = len(header)
                            placeholders = ",".join(["%s"] * num_cols)

                            # Normalize data row widths
                            normalized_data = []
                            for r in data_rows:
                                if len(r) < num_cols:
                                    r = r + [""] * (num_cols - len(r))
                                elif len(r) > num_cols:
                                    r = r[:num_cols]
                                normalized_data.append(r)

                            insert_sql = f"INSERT INTO {table_name} VALUES ({placeholders});"
                            extras.execute_batch(cursor, insert_sql, normalized_data, page_size=2000)

                        results[filename] = len(data_rows)
                        logger.info(f"Ingested {len(data_rows)} rows into {table_name}")
                    except Exception as e:
                        logger.error(f"Error syncing {filename} ({table_name}): {e}")
                        results[filename] = f"Error: {e}"

                # Update sync metadata
                if remote_update:
                    cursor.execute("""
                        INSERT INTO waha_sync_metadata (key, value, updated_at) 
                        VALUES ('last_update', %s, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                    """, (remote_update,))

                duration_str = f"{time.time() - start_time:.2f}"
                cursor.execute("""
                    INSERT INTO waha_sync_metadata (key, value, updated_at) 
                    VALUES ('sync_duration_sec', %s, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                """, (duration_str,))

            conn.commit()

        duration = time.time() - start_time
        logger.info(f"Wahapedia 11th Edition PostgreSQL sync completed in {duration:.2f}s!")

        return {
            "success": True,
            "status": "synced",
            "duration_sec": round(duration, 2),
            "remote_last_update": remote_update,
            "results": results
        }


def sync_wahapedia_job(force: bool = False) -> Dict[str, Any]:
    """Convenience wrapper for cron / scheduler / API trigger."""
    syncer = WahapediaSync()
    return syncer.sync_all(force=force)


if __name__ == "__main__":
    import sys
    force = "--force" in sys.argv
    try:
        res = sync_wahapedia_job(force=force)
        print("Sync result:", res)
    except Exception as exc:
        print("Wahapedia sync error:", exc)
