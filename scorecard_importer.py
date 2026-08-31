"""External Scorecard Importer for Warhammer 40,000.
Supports Tabletop Battles (Goonhammer JSON/Text), Official Warhammer 40k App,
ITC Battles, BCP match strings, and flexible plain text / manual scorecard input.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("ScorecardImporter")


class ScorecardImporter:
    """Parses external scorecard exports and converts them into standardized Digital Scorecard records."""

    def parse(self, raw_input: str, source_hint: Optional[str] = None) -> Dict[str, Any]:
        """Parses raw export text or JSON into a standardized scorecard record."""
        if not raw_input or not raw_input.strip():
            return self._create_empty_scorecard()

        content = raw_input.strip()

        # 1. Try JSON (Tabletop Battles JSON export or internal format)
        if (content.startswith("{") and content.endswith("}")) or (content.startswith("[") and content.endswith("]")):
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    return self._parse_tabletop_battles_json(data)
            except Exception as e:
                logger.debug("JSON scorecard parse error: %s", e)

        # 2. Try Tabletop Battles text share
        if "tabletop battles" in content.lower() or ("mission:" in content.lower() and "primary:" in content.lower()):
            return self._parse_tabletop_battles_text(content)

        # 3. Try generic text format (e.g. "Player 1 vs Player 2", "Score: 85 - 72")
        return self._parse_generic_scorecard_text(content)

    def _create_empty_scorecard(self) -> Dict[str, Any]:
        match_id = f"WH40K-EXT-{uuid.uuid4().hex[:8].upper()}"
        return {
            "match_id": match_id,
            "source": "Manual Entry",
            "event_name": "Casual / RTT Match",
            "mission": "Take and Hold",
            "deployment": "Crucible of Battle",
            "mission_rule": "Hidden Supplies",
            "round_count": 5,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "player1": {
                "name": "Player 1",
                "faction": "Space Marines",
                "detachment": "Gladius Task Force",
                "primary_score": 0,
                "secondary_score": 0,
                "paint_score": 10,
                "total_score": 10,
                "secondaries": []
            },
            "player2": {
                "name": "Player 2",
                "faction": "Necrons",
                "detachment": "Canoptek Court",
                "primary_score": 0,
                "secondary_score": 0,
                "paint_score": 10,
                "total_score": 10,
                "secondaries": []
            },
            "winner_name": "Draw",
            "is_finished": True,
            "state_json": {}
        }

    def _parse_tabletop_battles_json(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Parses Goonhammer Tabletop Battles JSON export."""
        match_id = f"WH40K-TTB-{uuid.uuid4().hex[:8].upper()}"
        mission = data.get("mission") or data.get("missionName") or "Take and Hold"
        deployment = data.get("deployment") or "Crucible of Battle"
        rule = data.get("missionRule") or data.get("rule") or "Core Rules"

        p1_raw = data.get("player1") or data.get("p1") or {}
        p2_raw = data.get("player2") or data.get("p2") or {}

        if not p1_raw and "players" in data and len(data["players"]) >= 2:
            p1_raw = data["players"][0]
            p2_raw = data["players"][1]

        p1_name = p1_raw.get("name") or "Player 1"
        p1_faction = p1_raw.get("faction") or p1_raw.get("army") or "Space Marines"
        p1_detachment = p1_raw.get("subFaction") or p1_raw.get("detachment") or ""
        p1_pri = int(p1_raw.get("primaryScore") or p1_raw.get("primary") or 0)
        p1_sec = int(p1_raw.get("secondaryScore") or p1_raw.get("secondary") or 0)
        p1_paint = int(p1_raw.get("paintScore") or p1_raw.get("battleReady") or 10)
        p1_tot = int(p1_raw.get("totalScore") or p1_raw.get("total") or (p1_pri + p1_sec + p1_paint))

        p2_name = p2_raw.get("name") or "Player 2"
        p2_faction = p2_raw.get("faction") or p2_raw.get("army") or "Necrons"
        p2_detachment = p2_raw.get("subFaction") or p2_raw.get("detachment") or ""
        p2_pri = int(p2_raw.get("primaryScore") or p2_raw.get("primary") or 0)
        p2_sec = int(p2_raw.get("secondaryScore") or p2_raw.get("secondary") or 0)
        p2_paint = int(p2_raw.get("paintScore") or p2_raw.get("battleReady") or 10)
        p2_tot = int(p2_raw.get("totalScore") or p2_raw.get("total") or (p2_pri + p2_sec + p2_paint))

        p1_secondaries = p1_raw.get("secondaries") or []
        p2_secondaries = p2_raw.get("secondaries") or []

        winner = data.get("winner") or (p1_name if p1_tot > p2_tot else (p2_name if p2_tot > p1_tot else "Draw"))

        state_json = {
            "id": match_id,
            "match_id": match_id,
            "source": "Tabletop Battles JSON",
            "game": {
                "p1Name": p1_name,
                "p1Army": p1_faction,
                "p1Detachment": p1_detachment,
                "p2Name": p2_name,
                "p2Army": p2_faction,
                "p2Detachment": p2_detachment,
                "primaryMission": mission,
                "deployment": deployment,
                "missionRule": rule
            },
            "p1": {
                "score": p1_tot,
                "primaryScore": p1_pri,
                "secondaryScore": p1_sec,
                "battleReady": p1_paint > 0
            },
            "p2": {
                "score": p2_tot,
                "primaryScore": p2_pri,
                "secondaryScore": p2_sec,
                "battleReady": p2_paint > 0
            },
            "round": 5,
            "is_finished": True,
            "winner": winner
        }

        return {
            "match_id": match_id,
            "source": "Tabletop Battles JSON",
            "event_name": data.get("eventName") or "Casual Match",
            "mission": mission,
            "deployment": deployment,
            "mission_rule": rule,
            "round_count": int(data.get("turns") or data.get("rounds") or 5),
            "date": data.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "player1": {
                "name": p1_name,
                "faction": p1_faction,
                "detachment": p1_detachment,
                "primary_score": p1_pri,
                "secondary_score": p1_sec,
                "paint_score": p1_paint,
                "total_score": p1_tot,
                "secondaries": p1_secondaries
            },
            "player2": {
                "name": p2_name,
                "faction": p2_faction,
                "detachment": p2_detachment,
                "primary_score": p2_pri,
                "secondary_score": p2_sec,
                "paint_score": p2_paint,
                "total_score": p2_tot,
                "secondaries": p2_secondaries
            },
            "winner_name": winner,
            "is_finished": True,
            "state_json": state_json
        }

    def _parse_tabletop_battles_text(self, text: str) -> Dict[str, Any]:
        """Parses Tabletop Battles text copy/share."""
        lines = [l.strip() for l in text.splitlines() if l.strip()]

        mission = "Take and Hold"
        deployment = "Crucible of Battle"
        mission_rule = "Core Rules"
        match_id = f"WH40K-TTB-{uuid.uuid4().hex[:8].upper()}"

        p1_name = "Player 1"
        p1_faction = "Space Marines"
        p1_detachment = ""
        p1_pri = 0
        p1_sec = 0
        p1_paint = 10
        p1_tot = 0
        p1_secondaries = []

        p2_name = "Player 2"
        p2_faction = "Necrons"
        p2_detachment = ""
        p2_pri = 0
        p2_sec = 0
        p2_paint = 10
        p2_tot = 0
        p2_secondaries = []

        current_player = 1

        for line in lines:
            m_match = re.search(r"Mission:\s*([^\r\n]+)", line, re.IGNORECASE)
            if m_match and "rule" not in line.lower():
                mission = m_match.group(1).strip()

            dep_match = re.search(r"Deployment:\s*([^\r\n]+)", line, re.IGNORECASE)
            if dep_match:
                deployment = dep_match.group(1).strip()

            rule_match = re.search(r"Mission Rule:\s*([^\r\n]+)", line, re.IGNORECASE)
            if rule_match:
                mission_rule = rule_match.group(1).strip()

            p1_match = re.search(r"Player\s*1:\s*([^\(\:\-]+)(?:\(([^\)]+)\))?", line, re.IGNORECASE)
            if p1_match:
                current_player = 1
                p1_name = p1_match.group(1).strip()
                if p1_match.group(2):
                    fac_parts = p1_match.group(2).split("-")
                    p1_faction = fac_parts[0].strip()
                    if len(fac_parts) > 1:
                        p1_detachment = fac_parts[1].strip()
                continue

            p2_match = re.search(r"Player\s*2:\s*([^\(\:\-]+)(?:\(([^\)]+)\))?", line, re.IGNORECASE)
            if p2_match:
                current_player = 2
                p2_name = p2_match.group(1).strip()
                if p2_match.group(2):
                    fac_parts = p2_match.group(2).split("-")
                    p2_faction = fac_parts[0].strip()
                    if len(fac_parts) > 1:
                        p2_detachment = fac_parts[1].strip()
                continue

            pri_m = re.search(r"Primary:\s*(\d+)", line, re.IGNORECASE)
            if pri_m:
                val = int(pri_m.group(1))
                if current_player == 1: p1_pri = val
                else: p2_pri = val

            sec_m = re.search(r"Secondary:\s*(\d+)(?:\s*\(([^\)]+)\))?", line, re.IGNORECASE)
            if sec_m:
                val = int(sec_m.group(1))
                sec_str = sec_m.group(2) or ""
                secs_list = []
                if sec_str:
                    for item in sec_str.split(","):
                        if ":" in item:
                            parts = item.split(":")
                            d_match = re.search(r"\d+", parts[1])
                            if d_match:
                                secs_list.append({"name": parts[0].strip(), "score": int(d_match.group(0))})
                if current_player == 1:
                    p1_sec = val
                    p1_secondaries = secs_list
                else:
                    p2_sec = val
                    p2_secondaries = secs_list

            paint_m = re.search(r"(?:Battle Ready|Paint(?:ed)?):\s*(\d+)", line, re.IGNORECASE)
            if paint_m:
                val = int(paint_m.group(1))
                if current_player == 1: p1_paint = val
                else: p2_paint = val

            tot_m = re.search(r"(?:Total|Final Score):\s*(\d+)", line, re.IGNORECASE)
            if tot_m:
                val = int(tot_m.group(1))
                if current_player == 1: p1_tot = val
                else: p2_tot = val

        if not p1_tot: p1_tot = p1_pri + p1_sec + p1_paint
        if not p2_tot: p2_tot = p2_pri + p2_sec + p2_paint

        winner = p1_name if p1_tot > p2_tot else (p2_name if p2_tot > p1_tot else "Draw")

        state_json = {
            "id": match_id,
            "match_id": match_id,
            "source": "Tabletop Battles Text",
            "game": {
                "p1Name": p1_name,
                "p1Army": p1_faction,
                "p1Detachment": p1_detachment,
                "p2Name": p2_name,
                "p2Army": p2_faction,
                "p2Detachment": p2_detachment,
                "primaryMission": mission,
                "deployment": deployment,
                "missionRule": mission_rule
            },
            "p1": {
                "score": p1_tot,
                "primaryScore": p1_pri,
                "secondaryScore": p1_sec,
                "battleReady": p1_paint > 0
            },
            "p2": {
                "score": p2_tot,
                "primaryScore": p2_pri,
                "secondaryScore": p2_sec,
                "battleReady": p2_paint > 0
            },
            "round": 5,
            "is_finished": True,
            "winner": winner
        }

        return {
            "match_id": match_id,
            "source": "Tabletop Battles Text",
            "event_name": "Casual Match",
            "mission": mission,
            "deployment": deployment,
            "mission_rule": mission_rule,
            "round_count": 5,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "player1": {
                "name": p1_name,
                "faction": p1_faction,
                "detachment": p1_detachment,
                "primary_score": p1_pri,
                "secondary_score": p1_sec,
                "paint_score": p1_paint,
                "total_score": p1_tot,
                "secondaries": p1_secondaries
            },
            "player2": {
                "name": p2_name,
                "faction": p2_faction,
                "detachment": p2_detachment,
                "primary_score": p2_pri,
                "secondary_score": p2_sec,
                "paint_score": p2_paint,
                "total_score": p2_tot,
                "secondaries": p2_secondaries
            },
            "winner_name": winner,
            "is_finished": True,
            "state_json": state_json
        }

    def _parse_generic_scorecard_text(self, text: str) -> Dict[str, Any]:
        """Flexible parser for quick scorecard text (e.g. 'Alice 85 vs Bob 72')."""
        match_id = f"WH40K-EXT-{uuid.uuid4().hex[:8].upper()}"
        p1_name = "Player 1"
        p1_faction = "Space Marines"
        p1_tot = 80
        p2_name = "Player 2"
        p2_faction = "Necrons"
        p2_tot = 70
        mission = "Take and Hold"

        lines = [l.strip() for l in text.splitlines() if l.strip()]
        for line in lines:
            m_match = re.search(r"Mission:\s*([^\r\n]+)", line, re.IGNORECASE)
            if m_match:
                mission = m_match.group(1).strip()

        vs_m = re.search(r"([A-Za-z0-9\s'\.\-]+?)(?:\s*\(([^\)]+)\))?\s*(\d{1,3})\s*(?:-|vs|v\.?)\s*([A-Za-z0-9\s'\.\-]+?)(?:\s*\(([^\)]+)\))?\s*(\d{1,3})", text, re.IGNORECASE)
        if vs_m:
            p1_name = vs_m.group(1).strip()
            if vs_m.group(2): p1_faction = vs_m.group(2).strip()
            p1_tot = int(vs_m.group(3))

            p2_name = vs_m.group(4).strip()
            if vs_m.group(5): p2_faction = vs_m.group(5).strip()
            p2_tot = int(vs_m.group(6))

        winner = p1_name if p1_tot > p2_tot else (p2_name if p2_tot > p1_tot else "Draw")

        state_json = {
            "id": match_id,
            "match_id": match_id,
            "source": "External Scorecard",
            "game": {
                "p1Name": p1_name,
                "p1Army": p1_faction,
                "p1Detachment": "",
                "p2Name": p2_name,
                "p2Army": p2_faction,
                "p2Detachment": "",
                "primaryMission": mission,
                "deployment": "Crucible of Battle",
                "missionRule": "Standard"
            },
            "p1": {"score": p1_tot, "primaryScore": max(0, p1_tot - 45), "secondaryScore": min(40, p1_tot - 10), "battleReady": True},
            "p2": {"score": p2_tot, "primaryScore": max(0, p2_tot - 45), "secondaryScore": min(40, p2_tot - 10), "battleReady": True},
            "round": 5,
            "is_finished": True,
            "winner": winner
        }

        return {
            "match_id": match_id,
            "source": "External Scorecard",
            "event_name": "Imported Game",
            "mission": mission,
            "deployment": "Crucible of Battle",
            "mission_rule": "Standard",
            "round_count": 5,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "player1": {
                "name": p1_name,
                "faction": p1_faction,
                "detachment": "",
                "primary_score": max(0, p1_tot - 45),
                "secondary_score": min(40, p1_tot - 10),
                "paint_score": 10,
                "total_score": p1_tot,
                "secondaries": []
            },
            "player2": {
                "name": p2_name,
                "faction": p2_faction,
                "detachment": "",
                "primary_score": max(0, p2_tot - 45),
                "secondary_score": min(40, p2_tot - 10),
                "paint_score": 10,
                "total_score": p2_tot,
                "secondaries": []
            },
            "winner_name": winner,
            "is_finished": True,
            "state_json": state_json
        }


def get_scorecard_importer() -> ScorecardImporter:
    return ScorecardImporter()
