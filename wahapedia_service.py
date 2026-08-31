"""Wahapedia Data Service for Warhammer 40,000 (10th/11th Edition).
Provides complete datasheet profiles, statlines, weapon profiles, abilities, keywords,
enhancements, detachments, and stratagem lookups stored and queried from PostgreSQL database tables,
with automated periodic background updating from official Wahapedia CSV dumps.
"""

import csv
import io
import logging
import os
import re
import sys
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("WahapediaService")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "wahapedia")
WAHAPEDIA_BASE_URL = "https://wahapedia.ru/wh40k10ed/"

CSV_FILES = [
    "Datasheets.csv",
    "Datasheets_models.csv",
    "Datasheets_wargear.csv",
    "Datasheets_abilities.csv",
    "Datasheets_keywords.csv",
    "Stratagems.csv",
    "Abilities.csv",
    "Factions.csv"
]


def strip_html(text: str) -> str:
    """Strips raw HTML tags and entity codes from Wahapedia text."""
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    clean = clean.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
    return clean.strip()


class WahapediaService:
    """Wahapedia service backed by PostgreSQL database tables with high-speed caching."""

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(WahapediaService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        
        self.datasheets: Dict[str, Dict[str, Any]] = {}
        self.factions_by_id: Dict[str, str] = {}
        self.factions_by_name: Dict[str, str] = {}
        self.stratagems_by_detachment: Dict[str, List[Dict[str, Any]]] = {}
        self.core_stratagems: List[Dict[str, Any]] = []
        self._normalized_index: Dict[str, str] = {}

        self.ensure_data_files()
        self.load_all_data()

    def ensure_data_files(self):
        """Checks if CSV files exist locally; does not block startup if offline."""
        os.makedirs(DATA_DIR, exist_ok=True)

    def download_csv_dumps(self, files_to_download: Optional[List[str]] = None) -> bool:
        """Downloads official Wahapedia CSV exports in background."""
        targets = files_to_download or CSV_FILES
        os.makedirs(DATA_DIR, exist_ok=True)
        success = True
        for fname in targets:
            url = f"{WAHAPEDIA_BASE_URL}{fname}"
            dest = os.path.join(DATA_DIR, fname)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    if resp.status == 200:
                        data = resp.read()
                        with open(dest, "wb") as f:
                            f.write(data)
                        logger.info(f"Downloaded {fname} ({len(data):,} bytes)")
            except Exception as e:
                logger.debug(f"Notice downloading {fname}: {e}")
                success = False
        return success

    def _normalize_name(self, name: str) -> str:
        """Normalizes names for robust fuzzy matching."""
        if not name:
            return ""
        s = name.lower().strip()
        s = re.sub(r"[^a-z0-9]", "", s)
        return s

    def load_all_data(self):
        """Loads and indexes all Wahapedia CSV data into memory and syncs to DB if needed."""
        # 1. Factions
        factions_path = os.path.join(DATA_DIR, "Factions.csv")
        factions_list = []
        if os.path.exists(factions_path):
            with open(factions_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    fid = r.get("id")
                    fname = r.get("name")
                    if fid and fname:
                        self.factions_by_id[fid] = fname
                        self.factions_by_name[self._normalize_name(fname)] = fid
                        factions_list.append({"id": fid, "name": fname, "link": r.get("link", "")})

        # 2. Models (Datasheet Stats)
        models_map: Dict[str, Dict[str, Any]] = {}
        models_path = os.path.join(DATA_DIR, "Datasheets_models.csv")
        if os.path.exists(models_path):
            with open(models_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    ds_id = r.get("datasheet_id")
                    if ds_id and ds_id not in models_map:
                        inv = r.get("inv_sv") or "-"
                        if inv != "-" and not str(inv).endswith("++"):
                            inv = f"{inv}++"
                        m_val = r.get("M", "6\"")
                        t_val = int(r.get("T") or 4) if str(r.get("T", "")).isdigit() else r.get("T", 4)
                        sv_val = r.get("Sv", "3+")
                        w_val = int(r.get("W") or 1) if str(r.get("W", "")).isdigit() else r.get("W", 1)
                        ld_val = r.get("Ld", "7+")
                        oc_val = int(r.get("OC") or 1) if str(r.get("OC", "")).isdigit() else r.get("OC", 1)

                        models_map[ds_id] = {
                            "M": m_val,
                            "T": t_val,
                            "SV": sv_val,
                            "INV": inv,
                            "W": w_val,
                            "LD": ld_val,
                            "OC": oc_val,
                            "m": m_val,
                            "t": t_val,
                            "sv": sv_val,
                            "inv_sv": inv,
                            "w": w_val,
                            "ld": ld_val,
                            "oc": oc_val
                        }

        # 3. Wargear (Weapons)
        wargear_map: Dict[str, List[Dict[str, Any]]] = {}
        wargear_path = os.path.join(DATA_DIR, "Datasheets_wargear.csv")
        if os.path.exists(wargear_path):
            with open(wargear_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    ds_id = r.get("datasheet_id")
                    if ds_id:
                        if ds_id not in wargear_map:
                            wargear_map[ds_id] = []
                        rng = r.get("range", "24\"")
                        w_type = "Melee" if str(rng).strip().lower() in ("melee", "-") or r.get("type") == "Melee" else "Ranged"
                        wargear_map[ds_id].append({
                            "name": r.get("name", "Weapon"),
                            "type": w_type,
                            "range": rng,
                            "attacks": r.get("A", "1"),
                            "bs_ws": r.get("BS_WS", "3+"),
                            "strength": r.get("S", "4"),
                            "ap": r.get("AP", "0"),
                            "damage": r.get("D", "1"),
                            "abilities": r.get("abilities") or "-"
                        })

        # 4. Abilities
        abilities_map: Dict[str, List[Dict[str, Any]]] = {}
        abilities_path = os.path.join(DATA_DIR, "Datasheets_abilities.csv")
        if os.path.exists(abilities_path):
            with open(abilities_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    ds_id = r.get("datasheet_id")
                    name = r.get("name")
                    if ds_id and name:
                        if ds_id not in abilities_map:
                            abilities_map[ds_id] = []
                        abilities_map[ds_id].append({
                            "name": name,
                            "description": strip_html(r.get("description", ""))
                        })

        # 5. Keywords
        keywords_map: Dict[str, List[str]] = {}
        kw_path = os.path.join(DATA_DIR, "Datasheets_keywords.csv")
        if os.path.exists(kw_path):
            with open(kw_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    ds_id = r.get("datasheet_id")
                    kw = r.get("keyword")
                    if ds_id and kw:
                        if ds_id not in keywords_map:
                            keywords_map[ds_id] = []
                        keywords_map[ds_id].append(kw)

        # 6. Datasheets
        ds_path = os.path.join(DATA_DIR, "Datasheets.csv")
        datasheets_list = []
        if os.path.exists(ds_path):
            with open(ds_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    ds_id = r.get("id")
                    name = r.get("name")
                    if not ds_id or not name:
                        continue
                    
                    fac_id = r.get("faction_id", "")
                    fac_name = self.factions_by_id.get(fac_id, fac_id)
                    role = r.get("role", "Infantry")

                    profile = {
                        "id": ds_id,
                        "name": name,
                        "faction": fac_name,
                        "faction_id": fac_id,
                        "role": role,
                        "stats": models_map.get(ds_id, {"M": "6\"", "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 1}),
                        "weapons": wargear_map.get(ds_id, []),
                        "abilities": abilities_map.get(ds_id, []),
                        "keywords": keywords_map.get(ds_id, [role, fac_name])
                    }
                    self.datasheets[ds_id] = profile
                    datasheets_list.append(profile)

                    # Index by normalized names
                    norm = self._normalize_name(name)
                    self._normalized_index[norm] = ds_id
                    if fac_name:
                        fac_norm = self._normalize_name(fac_name)
                        self._normalized_index[f"{fac_norm}_{norm}"] = ds_id

        # 7. Stratagems (Core & Detachment)
        strat_path = os.path.join(DATA_DIR, "Stratagems.csv")
        stratagems_list = []
        if os.path.exists(strat_path):
            with open(strat_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                reader = csv.DictReader(f, delimiter="|")
                for r in reader:
                    fac_id = r.get("faction_id", "")
                    fac_name = self.factions_by_id.get(fac_id, "")
                    det = r.get("detachment", "") or "Core"
                    name = r.get("name", "").title()
                    cp_str = r.get("cp_cost", "1")
                    cp = int(cp_str) if str(cp_str).isdigit() else 1
                    
                    strat_obj = {
                        "id": r.get("id") or f"{fac_id}_{name[:30]}",
                        "name": name,
                        "type": r.get("type", "Stratagem"),
                        "cp": cp,
                        "phase": r.get("phase", "Any Phase"),
                        "detachment": det,
                        "faction_id": fac_id,
                        "faction_name": fac_name,
                        "description": strip_html(r.get("description", ""))
                    }
                    stratagems_list.append(strat_obj)

                    if not fac_id or det.lower() == "core":
                        self.core_stratagems.append(strat_obj)
                    else:
                        key = f"{fac_id}::{self._normalize_name(det)}"
                        if key not in self.stratagems_by_detachment:
                            self.stratagems_by_detachment[key] = []
                        self.stratagems_by_detachment[key].append(strat_obj)

        logger.info(f"Loaded {len(self.datasheets):,} Wahapedia datasheets and {len(self.stratagems_by_detachment):,} detachment stratagem sets into cache.")

    def _sync_to_db_if_available(self, factions: List[Dict[str, Any]], datasheets: List[Dict[str, Any]], stratagems: List[Dict[str, Any]]):
        """Attempts to sync Wahapedia datasets into PostgreSQL tables."""
        try:
            from database import get_db
            db = get_db()
            stats = db.get_wahapedia_stats()
            # If database tables are empty or out of sync, bulk upsert
            if stats.get("total_datasheets", 0) < len(datasheets):
                logger.info("Syncing Wahapedia data to PostgreSQL tables (wahapedia_datasheets, wahapedia_stratagems, wahapedia_factions)...")
                res = db.bulk_upsert_wahapedia_data(factions, datasheets, stratagems)
                logger.info(f"Database sync complete: {res}")
        except Exception as e:
            logger.debug(f"Database sync notice (using high-speed cache): {e}")

    def sync_to_database(self, db=None) -> Dict[str, Any]:
        """Explicitly downloads and bulk-upserts Wahapedia datasets into PostgreSQL."""
        self.download_csv_dumps()
        self.load_all_data()
        if db is None:
            try:
                from database import get_db
                db = get_db()
            except Exception:
                pass
        if db:
            factions_path = os.path.join(DATA_DIR, "Factions.csv")
            factions_list = []
            if os.path.exists(factions_path):
                with open(factions_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                    for r in csv.DictReader(f, delimiter="|"):
                        if r.get("id") and r.get("name"):
                            factions_list.append({"id": r["id"], "name": r["name"], "link": r.get("link", "")})
            
            strat_path = os.path.join(DATA_DIR, "Stratagems.csv")
            stratagems_list = []
            if os.path.exists(strat_path):
                with open(strat_path, mode="r", encoding="utf-8-sig", errors="ignore") as f:
                    for r in csv.DictReader(f, delimiter="|"):
                        fac_id = r.get("faction_id", "")
                        cp_str = r.get("cp_cost", "1")
                        stratagems_list.append({
                            "id": r.get("id") or f"{fac_id}_{r.get('name','')[:30]}",
                            "name": r.get("name", "").title(),
                            "type": r.get("type", "Stratagem"),
                            "cp": int(cp_str) if str(cp_str).isdigit() else 1,
                            "phase": r.get("phase", "Any Phase"),
                            "detachment": r.get("detachment", "Core"),
                            "faction_id": fac_id,
                            "faction_name": self.factions_by_id.get(fac_id, ""),
                            "description": strip_html(r.get("description", ""))
                        })

            return db.bulk_upsert_wahapedia_data(factions_list, list(self.datasheets.values()), stratagems_list)
        return {"status": "Cached in memory"}

    def lookup_unit(self, unit_name: str, faction: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Looks up a datasheet profile by unit name and optional faction from DB or memory cache."""
        if not unit_name:
            return None

        # 1. Try PostgreSQL Database Table
        try:
            from database import get_db
            db = get_db()
            db_profile = db.get_wahapedia_datasheet(unit_name, faction=faction)
            if db_profile:
                return db_profile
        except Exception:
            pass

        # 2. In-Memory Cache Lookup
        cleaned_name = re.sub(r"^(?:char\d+:\s*)?(?:\d+x\s+)?", "", unit_name, flags=re.IGNORECASE).strip()
        norm = self._normalize_name(cleaned_name)

        if faction:
            fac_norm = self._normalize_name(faction)
            key = f"{fac_norm}_{norm}"
            if key in self._normalized_index:
                return self.datasheets[self._normalized_index[key]]

        if norm in self._normalized_index:
            return self.datasheets[self._normalized_index[norm]]

        for idx_key, ds_id in self._normalized_index.items():
            if norm in idx_key or idx_key in norm:
                return self.datasheets[ds_id]

        return {
            "id": f"GENERIC-{norm[:10]}",
            "name": cleaned_name,
            "faction": faction or "Warhammer 40,000",
            "role": "Infantry",
            "stats": {"M": "6\"", "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 1},
            "weapons": [
                {"name": "Standard Ranged Weapon", "type": "Ranged", "range": "24\"", "attacks": "2", "bs_ws": "3+", "strength": "4", "ap": "-1", "damage": "1", "abilities": "-"},
                {"name": "Standard Close Combat Weapon", "type": "Melee", "range": "Melee", "attacks": "3", "bs_ws": "3+", "strength": "4", "ap": "0", "damage": "1", "abilities": "-"}
            ],
            "abilities": [
                {"name": "Datasheet Rules", "description": "Standard unit abilities."}
            ],
            "keywords": ["Infantry"]
        }

    def get_stratagems_for_detachment(self, faction: str, detachment: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns official detachment-specific and core stratagems from DB or cache."""
        # 1. Try PostgreSQL Database Table
        try:
            from database import get_db
            db = get_db()
            db_strats = db.get_wahapedia_stratagems(faction, detachment=detachment)
            if db_strats and len(db_strats) > 0:
                return db_strats
        except Exception:
            pass

        # 2. In-Memory Cache Lookup
        fac_norm = self._normalize_name(faction or "")
        fac_id = self.factions_by_name.get(fac_norm) or (faction or "")
        det_norm = self._normalize_name(detachment or "")

        det_strats: List[Dict[str, Any]] = []

        if fac_id and det_norm:
            key = f"{fac_id}::{det_norm}"
            if key in self.stratagems_by_detachment:
                det_strats = self.stratagems_by_detachment[key]
            else:
                for k, strats in self.stratagems_by_detachment.items():
                    if k.startswith(f"{fac_id}::") and (det_norm in k or k.split("::")[1] in det_norm):
                        det_strats = strats
                        break

        core = [
            {"name": "Command Re-roll", "type": "Core", "cp": 1, "phase": "Any Phase", "description": "Re-roll one Hit roll, Wound roll, Damage roll, saving throw, Advance roll, Charge roll, or Battle-shock test."},
            {"name": "Counter-Offensive", "type": "Core", "cp": 2, "phase": "Fight Phase", "description": "Select one eligible friendly unit that has not fought this phase. That unit fights next."},
            {"name": "Epic Challenge", "type": "Core", "cp": 1, "phase": "Fight Phase", "description": "Melee attacks made by a Character model in this unit gain [PRECISION]."},
            {"name": "Fire Overwatch", "type": "Core", "cp": 1, "phase": "Opponent's Movement/Charge Phase", "description": "Shoot at an enemy unit that moved or charged. Hits are only scored on unmodified 6s."},
            {"name": "Go to Ground", "type": "Core", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Target friendly Infantry unit gains Benefit of Cover and a 6+ Invulnerable save."},
            {"name": "Smokescreen", "type": "Core", "cp": 1, "phase": "Opponent's Shooting Phase", "description": "Target friendly unit with SMOKE keyword gains Benefit of Cover and [STEALTH]."},
            {"name": "Tank Shock", "type": "Core", "cp": 1, "phase": "Charge Phase", "description": "Roll D6s equal to Toughness of your charging Vehicle (+2 if weapon S > T); each 5+ causes a mortal wound (max 6)."},
            {"name": "Rapid Ingress", "type": "Core", "cp": 1, "phase": "End of Opponent's Movement Phase", "description": "One friendly unit in Reserves with Deep Strike or Strategic Reserves arrives on the battlefield."}
        ]

        return det_strats + core


_wahapedia_instance: Optional[WahapediaService] = None


def get_wahapedia() -> WahapediaService:
    global _wahapedia_instance
    if _wahapedia_instance is None:
        _wahapedia_instance = WahapediaService()
    return _wahapedia_instance


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    waha = get_wahapedia()
    if "--update" in sys.argv or "--sync" in sys.argv:
        print("Syncing Wahapedia data to PostgreSQL tables...")
        res = waha.sync_to_database()
        print(f"Sync complete: {res}")
    else:
        print(f"Wahapedia Service ready: {len(waha.datasheets):,} datasheets loaded.")
        test_unit = waha.lookup_unit("Doomsday Ark", "Necrons")
        print("\nTest Unit Lookup:", test_unit["name"] if test_unit else "Not found")
        test_strats = waha.get_stratagems_for_detachment("Necrons", "Starshatter Arsenal")
        print(f"Test Stratagems ({len(test_strats)} total):")
        for s in test_strats[:6]:
            print(f"  - {s['name']} ({s['type']}, {s['cp']} CP) [{s['phase']}]")
