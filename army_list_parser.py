"""
Clean, Lightweight Army List Parser for Warhammer 40k.
Supports:
- NewRecruit share links (https://www.newrecruit.eu/app/list/{id})
- NewRecruit text exports
- BattleScribe text exports
- Warhammer 40,000 App text exports
- BCP & WTC text exports
"""

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ArmyListParser")


class ArmyListParser:
    """Parses army list links, JSON, and text exports into structured match rosters."""

    def parse(self, raw_input: str, source_hint: Optional[str] = None) -> Dict[str, Any]:
        if not raw_input or not raw_input.strip():
            return self._create_empty_roster()

        content = raw_input.strip()

        # 1. URL Detection (e.g. https://www.newrecruit.eu/app/list/28iCj)
        if content.startswith(("http://", "https://")) or "newrecruit.eu" in content:
            return self.parse_url(content)

        # 2. JSON Detection
        if content.startswith("{") and content.endswith("}"):
            try:
                data = json.loads(content)
                return self._parse_json_roster(data)
            except Exception as e:
                logger.debug("JSON parse fallback: %s", e)

        # 3. Text Format Detection
        if "FACTION KEYWORD:" in content or "newrecruit" in content.lower() or (content.startswith("++") and "TOTAL ARMY POINTS" in content):
            return self._parse_newrecruit_text(content)
        elif "++ Army Roster" in content or "+ Epic Hero +" in content or "+ Character +" in content:
            return self._parse_battlescribe_text(content)
        elif "CHARACTERS" in content or "BATTLELINE" in content or "OTHER DATASHEETS" in content:
            return self._parse_warhammer_app_text(content)
        else:
            return self._parse_generic_text(content)

    def parse_url(self, url: str) -> Dict[str, Any]:
        """Resolves a NewRecruit share link into a clean linked roster."""
        clean_url = url.strip().split()[0]
        list_id_match = re.search(r"/list/([a-zA-Z0-9_\-]+)", clean_url)
        list_id = list_id_match.group(1) if list_id_match else uuid.uuid4().hex[:8]
        canonical_url = f"https://www.newrecruit.eu/app/list/{list_id}" if list_id_match else clean_url

        roster = self._create_empty_roster()
        roster["id"] = f"nr_{list_id}"
        roster["name"] = f"NewRecruit Roster (#{list_id})"
        roster["source_url"] = canonical_url
        roster["source_format"] = "NewRecruit Link"
        return roster

    def _create_empty_roster(self) -> Dict[str, Any]:
        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": "Unnamed Army List",
            "faction": "Warhammer 40,000",
            "detachment": "Core Detachment",
            "points": 0,
            "points_limit": 2000,
            "warlord": "",
            "source_format": "Custom",
            "source_url": None,
            "units": [],
            "enhancements": [],
            "stratagems": [],
            "raw_text": "",
        }

    def _parse_json_roster(self, data: Dict[str, Any]) -> Dict[str, Any]:
        name = data.get("name") or data.get("rosterName") or "Imported Army List"
        faction = data.get("faction") or data.get("catalogueName") or "Warhammer 40,000"
        detachment = data.get("detachment") or "Core Detachment"
        points = int(data.get("points") or data.get("costs", {}).get("pts") or 2000)
        warlord = data.get("warlord") or ""

        units_raw = data.get("units") or data.get("selections") or []
        parsed_units = []

        for idx, u in enumerate(units_raw):
            uname = u.get("name") or "Unit"
            pts = int(u.get("points") or u.get("cost") or 0)
            role = u.get("role") or u.get("type") or "Infantry"
            is_wl = bool(u.get("is_warlord") or u.get("warlord"))
            enh = u.get("enhancement") or u.get("enhancements")
            models_cnt = int(u.get("models") or u.get("model_count") or 1)

            if is_wl and not warlord:
                warlord = uname

            unit_obj = {
                "id": f"u_{idx+1}_{uuid.uuid4().hex[:6]}",
                "name": uname,
                "role": role,
                "model_count": models_cnt,
                "points": pts,
                "is_warlord": is_wl,
                "enhancement": enh,
                "wargear": u.get("wargear") or [],
                "weapons": u.get("weapons") or [],
                "abilities": u.get("abilities") or [],
                "keywords": u.get("keywords") or [role, faction],
            }
            parsed_units.append(unit_obj)

        return {
            "id": data.get("id") or f"list_{uuid.uuid4().hex[:10]}",
            "name": name,
            "faction": faction,
            "detachment": detachment,
            "points": points,
            "points_limit": int(data.get("points_limit") or 2000),
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "JSON Roster",
            "source_url": data.get("source_url"),
            "units": parsed_units,
            "enhancements": [u["enhancement"] for u in parsed_units if u.get("enhancement")],
            "stratagems": data.get("stratagems") or [],
            "raw_text": json.dumps(data),
        }

    def _parse_newrecruit_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        faction = "Warhammer 40,000"
        detachment = "Core Detachment"
        points = 2000
        warlord = ""

        fac_match = re.search(r"FACTION KEYWORD:\s*(?:Xenos|Imperium|Chaos)?\s*-?\s*([^\n\r\+]+)", text, re.IGNORECASE)
        if fac_match:
            faction = fac_match.group(1).strip()

        det_match = re.search(r"DETACHMENT:\s*([^\n\r\+]+)", text, re.IGNORECASE)
        if det_match:
            detachment = det_match.group(1).strip()

        pts_match = re.search(r"TOTAL ARMY POINTS:\s*(\d+)", text, re.IGNORECASE)
        if pts_match:
            try:
                points = int(pts_match.group(1))
            except Exception:
                pass

        wl_match = re.search(r"WARLORD:\s*(?:Char\d+:\s*)?([^\n\r\+]+)", text, re.IGNORECASE)
        if wl_match:
            warlord = wl_match.group(1).strip()

        parsed_units = []
        current_unit = None
        unit_regex = re.compile(
            r"^(?:(Char\d+):\s*)?(?:(\d+)x\s+)?([^\(\:]+?)\s*\((?:(\d+)\s*pts?|(\d+)\s*points?)\)(?:\s*:\s*(.*))?",
            re.IGNORECASE,
        )
        enh_regex = re.compile(r"^Enhancements?:\s*(.+?)(?:\s*\(\s*\+?(\d+)\s*pts?\))?$", re.IGNORECASE)

        for line in lines:
            if line.startswith("+") or "Created with newrecruit" in line.lower() or "TOTAL ARMY POINTS" in line:
                continue

            enh_m = enh_regex.match(line)
            if enh_m and current_unit:
                current_unit["enhancement"] = enh_m.group(1).strip()
                continue

            u_m = unit_regex.match(line)
            if u_m:
                char_tag = u_m.group(1)
                count = int(u_m.group(2) or 1)
                raw_uname = u_m.group(3).strip()
                pts = int(u_m.group(4) or u_m.group(5) or 0)
                wargear_str = u_m.group(6) or ""

                if raw_uname.lower().startswith(("warlord", "enhancement", "total", "secondary", "number of units")):
                    continue

                is_wl = bool(char_tag and "warlord" in wargear_str.lower()) or (
                    raw_uname.lower() in warlord.lower() if warlord else False
                )
                if is_wl and not warlord:
                    warlord = raw_uname

                wargear_list = [w.strip() for w in wargear_str.split(",") if w.strip()] if wargear_str else []

                current_unit = {
                    "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                    "name": raw_uname,
                    "role": "Character" if char_tag else "Infantry",
                    "model_count": count,
                    "points": pts,
                    "is_warlord": is_wl,
                    "enhancement": None,
                    "wargear": wargear_list,
                    "keywords": ["Character" if char_tag else "Infantry", faction],
                }
                parsed_units.append(current_unit)

        calculated_pts = sum(u["points"] for u in parsed_units)
        if calculated_pts > 0:
            points = calculated_pts

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": f"{faction} ({detachment})",
            "faction": faction,
            "detachment": detachment,
            "points": points,
            "points_limit": 2000,
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "NewRecruit",
            "source_url": None,
            "units": parsed_units,
            "enhancements": [u["enhancement"] for u in parsed_units if u.get("enhancement")],
            "stratagems": [],
            "raw_text": text,
        }

    def _parse_battlescribe_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        faction = "Warhammer 40,000"
        detachment = "Core Detachment"
        points = 2000
        warlord = ""

        f_match = re.search(r"\+\+\s*Army Roster\s*\(([^\)]+)\)\s*\[(\d+)\s*pts\]\s*\+\+", text, re.IGNORECASE)
        if f_match:
            faction = f_match.group(1).strip()
            try:
                points = int(f_match.group(2))
            except Exception:
                pass

        det_match = re.search(r"Detachment:\s*([^\n\r]+)", text, re.IGNORECASE)
        if det_match:
            detachment = det_match.group(1).strip()

        parsed_units = []
        current_role = "Infantry"
        unit_pattern = re.compile(r"^([^\(\[]+?)(?:\s*\[(\d+)\s*pts\]|\s*\((?:(\d+)\s*pts|(\d+)\s*points)\))", re.IGNORECASE)

        for line in lines:
            if line.startswith("+"):
                if "Character" in line or "Epic Hero" in line:
                    current_role = "Character"
                elif "Battleline" in line:
                    current_role = "Battleline"
                elif "Dedicated Transport" in line:
                    current_role = "Transport"
                elif "Vehicle" in line or "Monster" in line:
                    current_role = "Vehicle"
                continue

            m = unit_pattern.match(line)
            if m:
                uname = m.group(1).strip()
                if uname.lower() in ("configuration", "battle size", "detachment"):
                    continue
                pts = int(m.group(2) or m.group(3) or m.group(4) or 0)
                is_wl = "warlord" in line.lower()
                if is_wl and not warlord:
                    warlord = uname

                parsed_units.append(
                    {
                        "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                        "name": uname,
                        "role": current_role,
                        "model_count": 1,
                        "points": pts,
                        "is_warlord": is_wl,
                        "enhancement": None,
                        "wargear": [],
                        "keywords": [current_role, faction],
                    }
                )

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": f"{faction} - {detachment}",
            "faction": faction,
            "detachment": detachment,
            "points": sum(u["points"] for u in parsed_units) or points,
            "points_limit": 2000,
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "BattleScribe",
            "source_url": None,
            "units": parsed_units,
            "enhancements": [],
            "stratagems": [],
            "raw_text": text,
        }

    def _parse_warhammer_app_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        name = "Warhammer App List"
        faction = "Warhammer 40,000"
        detachment = "Core Detachment"
        points = 2000
        warlord = ""

        if lines:
            name = lines[0].replace("’", "'")

        for line in lines[:5]:
            if "(" in line and "pts" in line:
                m = re.search(r"([^\(]+)\s*\((?:(\d+)\s*pts|(\d+)\s*points)\)", line, re.IGNORECASE)
                if m:
                    faction = m.group(1).strip()
                    points = int(m.group(2) or m.group(3) or 2000)
            elif "detachment" in line.lower():
                detachment = line.replace("Detachment", "").replace(":", "").strip()

        parsed_units = []
        current_role = "Infantry"
        header_roles = {
            "CHARACTERS": "Character",
            "BATTLELINE": "Battleline",
            "DEDICATED TRANSPORTS": "Transport",
            "OTHER DATASHEETS": "Infantry",
            "ALLIED UNITS": "Allied",
        }

        unit_line_pattern = re.compile(r"^([^\(\[]+?)\s*\((?:(\d+)\s*pts|(\d+)\s*points)\)", re.IGNORECASE)

        for line in lines:
            upper = line.upper().strip()
            if upper in header_roles:
                current_role = header_roles[upper]
                continue

            m = unit_line_pattern.match(line)
            if m:
                uname = m.group(1).strip()
                pts = int(m.group(2) or m.group(3) or 0)
                is_wl = "warlord" in line.lower()
                if is_wl and not warlord:
                    warlord = uname

                parsed_units.append(
                    {
                        "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                        "name": uname,
                        "role": current_role,
                        "model_count": 1,
                        "points": pts,
                        "is_warlord": is_wl,
                        "enhancement": None,
                        "wargear": [],
                        "keywords": [current_role, faction],
                    }
                )

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": name,
            "faction": faction,
            "detachment": detachment,
            "points": sum(u["points"] for u in parsed_units) or points,
            "points_limit": 2000,
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "Warhammer 40k App",
            "source_url": None,
            "units": parsed_units,
            "enhancements": [],
            "stratagems": [],
            "raw_text": text,
        }

    def _parse_generic_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        parsed_units = []
        unit_regex = re.compile(r"^(?:(\d+)x\s+)?([^\(\:]+?)(?:\s*[\(\[](\d+)\s*pts?[\)\]])?$", re.IGNORECASE)

        for idx, line in enumerate(lines):
            if line.startswith(("+", "#", "//")) or len(line) < 3:
                continue
            m = unit_regex.match(line)
            if m:
                cnt = int(m.group(1) or 1)
                uname = m.group(2).strip()
                pts = int(m.group(3) or 0)
                parsed_units.append(
                    {
                        "id": f"u_{idx+1}_{uuid.uuid4().hex[:6]}",
                        "name": uname,
                        "role": "Infantry",
                        "model_count": cnt,
                        "points": pts,
                        "is_warlord": False,
                        "enhancement": None,
                        "wargear": [],
                        "keywords": ["Infantry"],
                    }
                )

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": "Custom Army List",
            "faction": "Warhammer 40,000",
            "detachment": "Core Detachment",
            "points": sum(u["points"] for u in parsed_units) or 2000,
            "points_limit": 2000,
            "warlord": parsed_units[0]["name"] if parsed_units else "",
            "source_format": "Generic Text",
            "source_url": None,
            "units": parsed_units,
            "enhancements": [],
            "stratagems": [],
            "raw_text": text,
        }


_parser_instance: Optional[ArmyListParser] = None


def get_parser() -> ArmyListParser:
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = ArmyListParser()
    return _parser_instance
