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
from typing import Any, Dict, List, Optional, Tuple, Set, Union

logger = logging.getLogger("ArmyListParser")


class ArmyListParser:
    """Parses army list links, JSON, and text exports into structured match rosters."""

    def parse_file(self, raw_bytes: bytes, filename: str = "", enrich: bool = False) -> Dict[str, Any]:
        """Parses an uploaded file (.rosz, .ros, .json, .txt) into a structured match roster."""
        if not raw_bytes:
            return self._create_empty_roster()

        res = None
        fname = filename.lower()
        # 1. Zipped BattleScribe file (.rosz)
        if fname.endswith(".rosz") or raw_bytes.startswith(b"PK\x03\x04"):
            import zipfile, io
            try:
                with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                    for name in z.namelist():
                        if name.lower().endswith((".ros", ".xml")):
                            xml_str = z.read(name).decode("utf-8", errors="ignore")
                            res = self._parse_battlescribe_xml(xml_str)
                            break
            except Exception as e:
                logger.warning(f"Failed to unzip .rosz file: {e}")

        # 2. BattleScribe XML file (.ros / .xml)
        if not res and (fname.endswith((".ros", ".xml")) or raw_bytes.startswith(b"<?xml") or b"<roster" in raw_bytes[:300]):
            try:
                xml_str = raw_bytes.decode("utf-8", errors="ignore")
                res = self._parse_battlescribe_xml(xml_str)
            except Exception as e:
                logger.warning(f"Failed to parse XML file: {e}")

        # 3. JSON file (.json)
        if not res and (fname.endswith(".json") or raw_bytes.startswith(b"{")):
            try:
                json_str = raw_bytes.decode("utf-8", errors="ignore")
                data = json.loads(json_str)
                res = self._parse_json_roster(data)
            except Exception as e:
                logger.warning(f"Failed to parse JSON file: {e}")

        # 4. Text fallback
        if not res:
            try:
                text_str = raw_bytes.decode("utf-8", errors="ignore")
                res = self.parse(text_str)
            except Exception:
                res = self._create_empty_roster()

        return self._finalize_roster_compatibility(res or self._create_empty_roster())

    def _finalize_roster_compatibility(self, roster: Dict[str, Any]) -> Dict[str, Any]:
        """Annotates whether a parsed roster can be compiled/opened in NewRecruit Play Mode."""
        if not isinstance(roster, dict):
            return self._create_empty_roster()
        units = roster.get("units") or []
        has_nr_row = bool(isinstance(roster.get("nr_row"), dict) and roster["nr_row"].get("list_key"))
        src_fmt = str(roster.get("source_format") or "").strip()
        raw_txt = str(roster.get("raw_text") or "").strip()
        is_nr_export = bool(
            has_nr_row
            or src_fmt in ("NewRecruit", "NewRecruit Sync", "NewRecruit Studio", "NewRecruit Link")
            or "FACTION KEYWORD:" in raw_txt.upper()
            or "DETACHMENT POINTS" in raw_txt.upper()
            or "FORCE DISPOSITIONS:" in raw_txt.upper()
            or "ATTACHED UNIT" in raw_txt.upper()
            or "NEWRECRUIT" in raw_txt.upper()
        )
        has_valid_units = bool(
            len(units) > 0
            and (
                is_nr_export
                or src_fmt in ("Warhammer 40k App", "BattleScribe", "BattleScribe XML (.ros / .rosz)", "JSON Roster")
                or any(int(u.get("points") or 0) > 0 for u in units if isinstance(u, dict))
                or str(roster.get("faction") or "") not in ("", "Warhammer 40,000")
            )
        )
        roster["is_newrecruit_compatible"] = bool(has_nr_row or has_valid_units)
        roster["created_by_newrecruit"] = bool(is_nr_export and (has_nr_row or len(units) > 0))
        return roster

    def parse(self, raw_input: str, source_hint: Optional[str] = None, enrich: bool = False) -> Dict[str, Any]:
        if not raw_input or not raw_input.strip():
            return self._finalize_roster_compatibility(self._create_empty_roster())

        content = raw_input.strip()
        res = None

        # 1. JSON Detection (if content starts and ends with brackets, or parses cleanly as JSON)
        if (content.startswith("{") and content.endswith("}")) or (content.startswith("[") and content.endswith("]")):
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    res = self._parse_json_roster(data)
            except Exception as e:
                logger.debug("JSON parse error: %s", e)

        # 2. XML Detection (.ros / BattleScribe)
        if not res and (content.startswith("<?xml") or content.startswith("<roster") or "<roster" in content[:300]):
            res = self._parse_battlescribe_xml(content)

        # 3. URL Detection (e.g. https://www.newrecruit.eu/app/list/28iCj) - ONLY for actual short single-line URLs
        if not res and ("newrecruit.eu/app/list/" in content or "newrecruit.eu/app/tournament/" in content or content.startswith(("http://", "https://"))) and len(content) < 500 and "\n" not in content.strip():
            res = self.parse_url(content)

        # 4. JSON inside text fallback (e.g. pasted with surrounding whitespace or markdown codeblocks)
        if not res and "{" in content and "}" in content:
            try:
                start_idx = content.find("{")
                end_idx = content.rfind("}") + 1
                sub_json = content[start_idx:end_idx]
                data = json.loads(sub_json)
                if isinstance(data, dict) and ("roster" in data or "forces" in data or "units" in data):
                    res = self._parse_json_roster(data)
            except Exception:
                pass

        # 5. Text Format Detection
        if not res:
            content_up = content.upper()
            if "FACTION KEYWORD:" in content_up or (content.startswith("++") and "TOTAL ARMY POINTS" in content_up):
                res = self._parse_newrecruit_text(content)
            elif "++ ARMY ROSTER" in content_up or "+ EPIC HERO +" in content_up or "+ CHARACTER +" in content_up:
                res = self._parse_battlescribe_text(content)
            elif (
                "CHARACTERS" in content
                or "BATTLELINE" in content
                or "OTHER DATASHEETS" in content
                or "ATTACHED UNITS" in content_up
                or "ATTACHED UNIT 1" in content_up
                or "DETACHMENT POINTS)" in content_up
                or "FORCE DISPOSITIONS:" in content_up
                or "EXPORTED WITH APP VERSION" in content_up
            ):
                res = self._parse_warhammer_app_text(content)
            else:
                res = self._parse_generic_text(content)

        return self._finalize_roster_compatibility(res or self._create_empty_roster())

    def _parse_battlescribe_xml(self, xml_content: str) -> Dict[str, Any]:
        """Parses BattleScribe .ros / .rosz XML content into a rich tactical roster."""
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(xml_content)
        except Exception as e:
            logger.warning(f"XML parse error: {e}")
            return self._create_empty_roster()

        # Strip XML namespaces for effortless tag traversal
        for elem in root.iter():
            if '}' in elem.tag:
                elem.tag = elem.tag.split('}', 1)[1]

        name = root.attrib.get('name', 'BattleScribe Roster')
        pts = 2000
        cost_pts = root.find('.//costs/cost[@name="pts"]')
        if cost_pts is not None:
            try: pts = int(float(cost_pts.attrib.get('value', 2000)))
            except: pass

        force = root.find('.//force')
        faction = force.attrib.get('catalogueName', 'Warhammer 40,000') if force is not None else 'Warhammer 40,000'
        detachment = 'Core Detachment'
        army_rules = []
        detachment_rules = []
        warlord = ''
        units = []

        if force is not None:
            for r_node in force.findall('./rules/rule'):
                r_name = r_node.attrib.get('name')
                desc_node = r_node.find('./description')
                r_desc = desc_node.text if desc_node is not None else ''
                if r_name and not any(ar['name'] == r_name for ar in army_rules):
                    army_rules.append({'name': r_name, 'description': r_desc})

        for sel in root.findall('.//force/selections/selection'):
            uname = sel.attrib.get('name', 'Unit')
            cat_elem = sel.find('.//categories/category[@primary="true"]')
            role = cat_elem.attrib.get('name', 'Infantry') if cat_elem is not None else 'Infantry'

            if role == 'Configuration' or uname.lower() in ('configuration', 'battle size', 'detachment'):
                for sub in sel.findall('.//selection'):
                    if 'detachment' in sub.attrib.get('name', '').lower() or sub.attrib.get('type') == 'upgrade':
                        detachment = sub.attrib.get('name')
                        for dr_node in sub.findall('.//rules/rule'):
                            dr_name = dr_node.attrib.get('name')
                            d_desc_node = dr_node.find('./description')
                            dr_desc = d_desc_node.text if d_desc_node is not None else ''
                            if dr_name and not any(d['name'] == dr_name for d in detachment_rules):
                                detachment_rules.append({'name': dr_name, 'description': dr_desc})
                continue

            pts_elem = sel.find('.//costs/cost[@name="pts"]')
            unit_pts = int(float(pts_elem.attrib.get('value', 0))) if pts_elem is not None else 0
            
            is_wl = False
            enhancement = None
            wargear = []
            weapons = []
            abilities = []
            unit_rules = []
            stats = {}

            # Helper to parse profiles from XML
            for prof in sel.findall('.//profile'):
                p_name = prof.attrib.get('name', '')
                p_type = prof.attrib.get('typeName', '')
                chars = {c.attrib.get('name'): (c.text or '') for c in prof.findall('.//characteristic')}

                if (p_type == 'Unit' or ('M' in chars and 'T' in chars and 'Sv' in chars)) and not stats:
                    stats = {
                        'M': chars.get('M', '6"'),
                        'T': chars.get('T', '4'),
                        'SV': chars.get('Sv', chars.get('SV', '3+')),
                        'INV': chars.get('InSv', chars.get('INV', '-')),
                        'W': int(chars.get('W', 2)) if chars.get('W', '').isdigit() else chars.get('W', '2'),
                        'LD': chars.get('LD', chars.get('Ld', '6+')),
                        'OC': chars.get('OC', '1')
                    }
                elif p_type in ('Ranged Weapons', 'Melee Weapons', 'Weapon') or ('Range' in chars and ('A' in chars or 'S' in chars or 'BS' in chars or 'WS' in chars)):
                    clean_wname = p_name.replace('➤', '').strip()
                    if not any(w['name'] == clean_wname for w in weapons):
                        rng = chars.get('Range', 'Melee')
                        w_type = 'Ranged' if p_type == 'Ranged Weapons' or rng != 'Melee' else 'Melee'
                        skill_val = chars.get('BS' if w_type == 'Ranged' else 'WS', chars.get('BS', chars.get('WS', '3+')))
                        weapons.append({
                            'name': clean_wname,
                            'type': w_type,
                            'range': rng,
                            'Range': rng,
                            'A': chars.get('A', '1'),
                            'skill': skill_val,
                            'BS': chars.get('BS', skill_val),
                            'WS': chars.get('WS', skill_val),
                            'S': chars.get('S', '4'),
                            'AP': chars.get('AP', '0'),
                            'D': chars.get('D', '1'),
                            'keywords': [k.strip() for k in chars.get('Keywords', '').split(',') if k.strip()]
                        })
                elif p_type in ('Abilities', 'Ability', 'Primarch of the First Legion') or ('Description' in chars or 'Effect' in chars or 'Rules' in chars):
                    desc = chars.get('Description', chars.get('Effect', chars.get('Rules', '')))
                    if p_name and not any(a['name'] == p_name for a in abilities):
                        abilities.append({'name': p_name, 'description': desc, 'type': p_type})

            for r_node in sel.findall('.//rules/rule'):
                ru_name = r_node.attrib.get('name')
                desc_node = r_node.find('./description')
                ru_desc = desc_node.text if desc_node is not None else ''
                if ru_name and not any(ru['name'] == ru_name for ru in unit_rules):
                    unit_rules.append({'name': ru_name, 'description': ru_desc})

            for sub in sel.findall('.//selection'):
                sname = sub.attrib.get('name', '')
                if 'warlord' in sname.lower():
                    is_wl = True
                elif 'enhancement' in sname.lower() or (sub.attrib.get('type') == 'upgrade' and any(k in sname.lower() for k in ['veil', 'enhancement', 'relic', 'artefact'])):
                    enhancement = sname
                else:
                    if sname and sname != uname and sname not in ['Unit', 'Model']:
                        wargear.append(sname)

            if is_wl and not warlord:
                warlord = uname

            if not stats:
                w_val = 12 if ('Vehicle' in role or 'Monster' in role) else (6 if ('Character' in role or is_wl) else 2)
                sv_val = '2+' if ('Character' in role or 'Vehicle' in role) else '3+'
                t_val = 10 if ('Vehicle' in role or 'Monster' in role) else 4
                m_val = '10"' if ('Mounted' in role or 'Vehicle' in role) else '6"'
                stats = {
                    'M': m_val,
                    'T': t_val,
                    'SV': sv_val,
                    'INV': '4+' if (is_wl or 'Character' in role) else '-',
                    'W': w_val,
                    'LD': '6+',
                    'OC': 2 if 'Battleline' in role else 1
                }

            w_int = 2
            try: w_int = int(stats.get('W', 2))
            except: pass

            units.append({
                'id': f'u_{len(units)+1}_{uuid.uuid4().hex[:6]}',
                'name': uname,
                'points': unit_pts,
                'role': role,
                'is_warlord': is_wl,
                'enhancement': enhancement,
                'model_count': int(sel.attrib.get('number', 1)),
                'wargear': list(dict.fromkeys(wargear))[:8],
                'weapons': weapons,
                'abilities': abilities,
                'rules': unit_rules,
                'stats': stats,
                'max_wounds': w_int,
                'current_wounds': w_int,
                'keywords': [role, faction]
            })

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': name,
            'faction': faction,
            'detachment': detachment,
            'points': sum(u['points'] for u in units) or pts,
            'points_limit': pts,
            'warlord': warlord or (units[0]['name'] if units else ''),
            'source_format': 'BattleScribe XML (.ros / .rosz)',
            'source_url': None,
            'army_rules': army_rules,
            'detachment_rules': detachment_rules,
            'units': units,
            'enhancements': [u['enhancement'] for u in units if u.get('enhancement')],
            'stratagems': [],
            'raw_text': xml_content[:500]
        }

    def parse_newrecruit_dict(
        self,
        data: Dict[str, Any],
        default_id: Optional[str] = None,
        source_url: Optional[str] = None,
        enrich: bool = False,
    ) -> Dict[str, Any]:
        """Parses a NewRecruit list object (from IndexedDB nr.lists, get_list_bulk, or open_share_link) into an OmniTactica roster."""
        if not isinstance(data, dict):
            return self._create_empty_roster()

        list_key = str(data.get("list_key") or data.get("share_id") or data.get("_id") or "").strip()
        roster_id = data.get("id") or (f"nr_{list_key}" if list_key else (default_id or f"nr_{uuid.uuid4().hex[:8]}"))
        if not str(roster_id).startswith(("nr_", "list_")):
            roster_id = f"nr_{roster_id}"

        roster = self._create_empty_roster()
        roster["id"] = roster_id
        if list_key:
            roster["list_key"] = list_key
        roster["name"] = (data.get("name") or roster["name"]).strip()
        total_cost = data.get("totalCost")
        if total_cost is None and isinstance(data.get("totalCosts"), dict):
            total_cost = data["totalCosts"].get("pts")
        try:
            total_cost = int(float(total_cost)) if total_cost is not None else 0
        except Exception:
            total_cost = 0

        army = data.get("army") if isinstance(data.get("army"), dict) else {}
        points_limit = 0
        if data.get("_omnitactica_points_limit"):
            try:
                points_limit = int(float(data["_omnitactica_points_limit"]))
            except Exception:
                points_limit = 0
        if not points_limit and isinstance(army.get("maxCosts"), list):
            for mc in army["maxCosts"]:
                if isinstance(mc, dict) and mc.get("value"):
                    try:
                        points_limit = int(float(mc["value"]))
                        break
                    except Exception:
                        pass
        if not points_limit:
            points_limit = 2000 if total_cost <= 2000 else 3000

        roster["points"] = total_cost if total_cost > 0 else points_limit
        roster["points_limit"] = points_limit
        roster["source_url"] = source_url or data.get("source_url") or (f"https://www.newrecruit.eu/app/Lists/{list_key}" if list_key else None)
        roster["source_format"] = data.get("source_format") or "NewRecruit Sync"
        roster["date_mod"] = str(data.get("date_mod") or "")
        roster["id_system"] = data.get("id_system")
        roster["id_book"] = data.get("id_book")
        roster["bsid_system"] = data.get("bsid_system")
        roster["bsid_book"] = data.get("bsid_book")

        try:
            from newrecruit_integration import detect_nr_game_system_and_edition
            gs, edition = detect_nr_game_system_and_edition(data)
            roster["game_system"] = gs
            roster["system_edition"] = edition
        except Exception:
            sys_name_hint = str(data.get("_omnitactica_system_name") or data.get("system_name") or "").lower()
            if "sigmar" in sys_name_hint or "aos" in sys_name_hint:
                roster["game_system"] = "aos"
                roster["system_edition"] = "AoS 4.0"
            else:
                roster["game_system"] = str(data.get("game_system") or "40k").strip().lower()
                roster["system_edition"] = "11th Ed"

        is_aos = roster.get("game_system") == "aos"

        # Keep clean copy of NewRecruit row for bidirectional IndexedDB hydration
        nr_row_keys = (
            "_id", "list_key", "name", "id_system", "id_book", "bsid_system", "bsid_book",
            "totalCost", "totalCosts", "booksDate", "books_revision", "nrversion",
            "date_mod", "version", "synced", "metadata", "army",
            "locked", "favorite", "id_folder", "id_tournament", "description", "notes", "points_limit", "valid",
            "_synthetic_text", "_compiled_by_nr",
            "_omnitactica_book_name", "_omnitactica_system_name", "_omnitactica_detachment", "_omnitactica_points_limit"
        )
        nr_row = {k: data[k] for k in nr_row_keys if k in data}
        if nr_row.get("list_key") or nr_row.get("army"):
            roster["nr_row"] = nr_row

        faction = data.get("faction") or data.get("_omnitactica_book_name") or data.get("book_name") or ""
        if not faction and (data.get("id_book") or data.get("bsid_book")):
            try:
                from newrecruit_integration import NR_40K_FACTION_BOOKS, NR_AOS_FACTION_BOOKS
                target_book_id = data.get("id_book")
                target_bsid = str(data.get("bsid_book") or "")
                books_to_search = (
                    list(NR_AOS_FACTION_BOOKS.values()) + list(NR_40K_FACTION_BOOKS.values())
                    if is_aos
                    else list(NR_40K_FACTION_BOOKS.values()) + list(NR_AOS_FACTION_BOOKS.values())
                )
                for bid, bsid, bname in books_to_search:
                    if (target_book_id and str(bid) == str(target_book_id)) or (target_bsid and bsid == target_bsid):
                        faction = bname
                        break
            except Exception:
                pass
        if not faction:
            faction = "Stormcast Eternals" if is_aos else roster["faction"]
        if is_aos and faction == "Space Marines":
            faction = "Stormcast Eternals"
        if " - " in faction:
            faction = faction.split(" - ")[-1].strip()
        roster["faction"] = faction

        default_detachment = "Battle Formation" if is_aos else "Core Detachment"
        detachment = str(data.get("_omnitactica_detachment") or data.get("detachment") or default_detachment).strip()
        warlord = data.get("warlord") or None
        units: List[Dict[str, Any]] = []

        if army:
            army_root_name = str(army.get("name") or "").strip()
            if " - " in army_root_name:
                faction = army_root_name.split(" - ")[-1].strip()
            elif army_root_name and army_root_name not in (
                "Army Roster", "New Roster", "Roster", "Force",
                "Warhammer 40,000", "Warhammer 40,000 11th Edition",
                "Age of Sigmar 4.0", "Warhammer Age of Sigmar",
            ):
                faction = army_root_name

            def find_army_roster_node(node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                nonlocal faction
                name = str(node.get("name") or "").strip()
                if " - " in name:
                    faction = name.split(" - ")[-1].strip()
                for opt in node.get("options") or []:
                    if not isinstance(opt, dict):
                        continue
                    opt_n = str(opt.get("name") or "").strip()
                    if " - " in opt_n:
                        faction = opt_n.split(" - ")[-1].strip()
                    if opt_n in ("Army Roster", "Force", "Primary Detachment"):
                        return opt
                    res = find_army_roster_node(opt)
                    if res:
                        return res
                return None

            roster_node = find_army_roster_node(army) or army
            roster["faction"] = faction

            def parse_config_node(cfg_node: Dict[str, Any]):
                nonlocal detachment
                if not isinstance(cfg_node, dict):
                    return
                c_name = str(cfg_node.get("name") or "").strip()
                c_low = c_name.lower()
                if (
                    c_name in ("Detachment", "Detachment Choice", "Battle Formation", "Battle Formations", "Subfaction", "Allegiance")
                    or "detachment" in c_low
                    or "battle formation" in c_low
                    or c_low in ("subfaction", "allegiance", "greatfray", "glade", "host", "lodge", "temple", "court", "tribe")
                ):
                    for sub in cfg_node.get("options") or []:
                        if not isinstance(sub, dict):
                            continue
                        if sub.get("options"):
                            for sub_sub in sub.get("options") or []:
                                if isinstance(sub_sub, dict) and sub_sub.get("name"):
                                    detachment = str(sub_sub.get("name")).strip()
                        elif sub.get("name") and str(sub.get("name")).strip() not in ("Detachment", "Detachment Choice", "Battle Formation", "Battle Formations"):
                            detachment = str(sub.get("name")).strip()
                elif c_name == "Battle Size" or "battle size" in c_low:
                    for sub in cfg_node.get("options") or []:
                        if not isinstance(sub, dict):
                            continue
                        candidates = [sub] + [s for s in (sub.get("options") or []) if isinstance(s, dict)]
                        for cand in candidates:
                            cname = str(cand.get("name") or "")
                            m_lim = re.search(r"(\d{3,4})\s*Point", cname, re.IGNORECASE)
                            if m_lim:
                                try:
                                    roster["points_limit"] = int(m_lim.group(1))
                                except Exception:
                                    pass
                elif c_name in ("Configuration", "Army Composition", "Show/Hide Options", "Detachment Rules", "Force Disposition"):
                    for sub in cfg_node.get("options") or []:
                        if isinstance(sub, dict):
                            parse_config_node(sub)

            known_category_wrappers = {
                "character", "characters", "epic hero", "epic heroes", "battleline",
                "infantry", "mounted", "monster", "monsters", "vehicle", "vehicles",
                "dedicated transport", "dedicated transports", "transport", "allied units",
                "fortifications", "other datasheets", "regiment", "auxiliary",
                "auxillary units", "auxiliary units", "general's regiment", "regiments of renown",
                "hero", "heroes", "cavalry", "beast", "beasts", "war machine", "war machines",
                "faction terrain", "endless spell", "endless spells", "invocations", "manifestations",
                "leader", "leaders", "behemoth", "artillery", "other", "units",
            }
            ignored_config_names = {
                "configuration", "army composition", "battle size", "detachment", "detachment choice",
                "battle formation", "battle formations", "spell lore", "prayer lore", "manifestation lore",
                "show/hide options", "force disposition", "regiment options",
            }

            def parse_single_unit_node(unit_node: Dict[str, Any], role_hint: str = "Infantry"):
                nonlocal warlord
                if not isinstance(unit_node, dict):
                    return
                u_name = str(unit_node.get("customName") or unit_node.get("name") or "Unit").strip()
                u_low = u_name.lower()
                if not u_name or u_low in ignored_config_names or u_low.startswith(("spell lore", "prayer lore", "manifestation lore", "battle formation")):
                    return
                u_amount = unit_node.get("amount", 1)
                try:
                    u_amount = int(u_amount)
                except Exception:
                    u_amount = 1
                u_warlord = False
                u_enhancement = None
                wargear: List[str] = []
                model_count_sum = 0

                def parse_unit_sub(sub_node: Dict[str, Any]):
                    nonlocal u_warlord, u_enhancement, model_count_sum
                    if not isinstance(sub_node, dict):
                        return
                    s_name = str(sub_node.get("name") or "").strip()
                    s_low = s_name.lower()
                    s_amt = sub_node.get("amount", 1)
                    try:
                        s_amt = int(s_amt)
                    except Exception:
                        s_amt = 1

                    if s_name in ("Warlord", "General", "Warmaster") or "warlord" in s_low:
                        u_warlord = True
                    elif (
                        s_name in ("Enhancements", "Enhancement", "Heroic Traits", "Heroic Trait", "Artefacts of Power", "Artefact of Power", "Command Traits", "Artefacts")
                        or "enhancement" in s_low
                        or "heroic trait" in s_low
                        or "artefact" in s_low
                    ):
                        if sub_node.get("options"):
                            for enh in sub_node.get("options") or []:
                                if isinstance(enh, dict) and enh.get("name"):
                                    u_enhancement = str(enh.get("name")).strip()
                        elif s_low not in ("enhancements", "enhancement", "heroic traits", "heroic trait", "artefacts of power", "artefact of power"):
                            u_enhancement = re.sub(r"^(Enhancements?|Heroic Traits?|Artefacts?(?: of Power)?):\s*", "", s_name, flags=re.I).strip()
                    elif s_name in ("Wargear", "Weapons", "Wargear options", "Ranged Weapons", "Melee Weapons"):
                        for wg in sub_node.get("options") or []:
                            parse_unit_sub(wg)
                    elif s_low in ("regiment options", "reinforced"):
                        if s_low == "reinforced":
                            wargear.append("Reinforced")
                    else:
                        if sub_node.get("options"):
                            if s_amt > 1:
                                model_count_sum += s_amt
                            for c in sub_node.get("options") or []:
                                parse_unit_sub(c)
                        elif s_name and s_name not in ("Unit", "Model", "Option"):
                            wg_label = f"{s_amt}x {s_name}" if s_amt > 1 else s_name
                            wargear.append(wg_label)

                for sub in unit_node.get("options") or []:
                    parse_unit_sub(sub)

                if u_warlord and not warlord and u_low not in known_category_wrappers:
                    warlord = u_name

                final_models = max(1, u_amount if u_amount > 1 else (model_count_sum if model_count_sum > 1 else 1))
                clean_role_hint = role_hint
                if clean_role_hint and (clean_role_hint.lower().startswith("regiment") or "regiment" in clean_role_hint.lower() or "auxil" in clean_role_hint.lower()):
                    clean_role_hint = "Hero" if (u_warlord or u_enhancement) else "Infantry"
                role_label = clean_role_hint or (("Hero" if is_aos else "Character") if (u_warlord or u_enhancement) else "Infantry")

                m_val = '10"' if ("Mounted" in role_label or "Cavalry" in role_label or "Vehicle" in role_label) else '6"'
                t_val = 10 if ("Vehicle" in role_label or "Monster" in role_label or "War Machine" in role_label) else 4
                w_val = 12 if ("Vehicle" in role_label or "Monster" in role_label) else (5 if ("Character" in role_label or "Hero" in role_label or "Epic Hero" in role_label) else 2)
                sv_val = "2+" if ("Vehicle" in role_label or "Character" in role_label or "Hero" in role_label or "Epic Hero" in role_label) else "3+"

                u_pts = 0
                if unit_node.get("points") is not None or unit_node.get("totalCost") is not None:
                    try:
                        u_pts = int(float(unit_node.get("points") or unit_node.get("totalCost") or 0))
                    except Exception:
                        u_pts = 0

                units.append({
                    "id": unit_node.get("id") or unit_node.get("uid") or unit_node.get("option_id") or f"u_{len(units)+1}",
                    "name": u_name,
                    "role": role_label,
                    "is_warlord": u_warlord,
                    "enhancement": u_enhancement,
                    "model_count": final_models,
                    "wargear": list(dict.fromkeys(wargear))[:8],
                    "stats": {
                        "M": m_val,
                        "T": t_val,
                        "SV": sv_val,
                        "INV": "4+" if (u_warlord or "Character" in role_label or "Hero" in role_label or "Epic Hero" in role_label) else "-",
                        "W": w_val,
                        "LD": "6+",
                        "OC": 2 if "Battleline" in role_label else 1
                    },
                    "keywords": [faction, role_label, u_name],
                    "points": u_pts
                })

            def walk_roster_categories(nodes: List[Any], current_role: str = "Infantry"):
                for cat in nodes or []:
                    if not isinstance(cat, dict):
                        continue
                    cat_name = str(cat.get("name") or "").strip()
                    cat_low = cat_name.lower()
                    if (
                        cat_low in ignored_config_names
                        or "detachment" in cat_low
                        or "battle formation" in cat_low
                        or "battle size" in cat_low
                        or cat_low.startswith(("spell lore", "prayer lore", "manifestation lore"))
                    ):
                        parse_config_node(cat)
                        continue

                    is_cat_wrapper = (
                        str(cat.get("id") or "").startswith("cat-")
                        or cat_low in known_category_wrappers
                        or cat_low.startswith("regiment")
                        or "regiment" in cat_low
                        or "auxil" in cat_low
                        or bool(cat.get("catalogue_id"))
                    )
                    if is_cat_wrapper:
                        next_role = current_role
                        if cat_name and not (cat_low.startswith("regiment") or "regiment" in cat_low or "auxil" in cat_low or cat_low == "units"):
                            next_role = cat_name
                        walk_roster_categories(cat.get("options") or [], next_role)
                    else:
                        parse_single_unit_node(cat, current_role)

            walk_roster_categories(roster_node.get("options") or [], "Hero" if is_aos else "Infantry")

        # Merge live enriched unit metadata if provided by NewRecruit Studio Bridge ($debugOption / currentList.army)
        enriched_units = data.get("_omnitactica_enriched_units")
        if isinstance(enriched_units, list) and enriched_units:
            if not units:
                for idx, eu in enumerate(enriched_units):
                    if not isinstance(eu, dict):
                        continue
                    u_name = str(eu.get("name") or "Unit").strip()
                    u_wl = bool(eu.get("is_warlord"))
                    if u_wl and not warlord and u_name.lower() not in ("character", "characters", "hero", "heroes", "unit"):
                        warlord = u_name
                    units.append({
                        "id": eu.get("id") or f"u_{idx+1}",
                        "name": u_name,
                        "role": eu.get("role") or ("Hero" if is_aos else "Infantry"),
                        "is_warlord": u_wl,
                        "enhancement": eu.get("enhancement"),
                        "model_count": int(eu.get("model_count") or 1),
                        "wargear": eu.get("wargear") or [],
                        "stats": eu.get("stats") or {"M": '6"', "T": 4, "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": 1},
                        "weapons": eu.get("weapons") or [],
                        "abilities": eu.get("abilities") or [],
                        "keywords": eu.get("keywords") or [faction, u_name],
                        "points": int(eu.get("points") or 0),
                    })
            else:
                used_indices = set()
                for u in units:
                    u_low = u["name"].lower()
                    matched_eu = None
                    for idx, eu in enumerate(enriched_units):
                        if idx in used_indices or not isinstance(eu, dict):
                            continue
                        if str(eu.get("name") or "").strip().lower() == u_low:
                            matched_eu = eu
                            used_indices.add(idx)
                            break
                    if matched_eu:
                        if matched_eu.get("role"):
                            u["role"] = matched_eu["role"]
                        if matched_eu.get("points") is not None:
                            try:
                                u["points"] = int(float(matched_eu["points"]))
                            except Exception:
                                pass
                        if matched_eu.get("model_count"):
                            try:
                                u["model_count"] = int(matched_eu["model_count"])
                            except Exception:
                                pass
                        if matched_eu.get("stats"):
                            u["stats"] = matched_eu["stats"]
                        if matched_eu.get("weapons"):
                            u["weapons"] = matched_eu["weapons"]
                        if matched_eu.get("abilities"):
                            u["abilities"] = matched_eu["abilities"]

        if warlord and str(warlord).strip().lower() in ("character", "characters", "infantry", "battleline", "vehicle", "monster", "unit"):
            warlord = None
        roster["detachment"] = detachment
        roster["warlord"] = warlord or (units[0]["name"] if units else "")
        roster["units"] = units
        roster["enhancements"] = [u["enhancement"] for u in units if u.get("enhancement")]

        sum_unit_pts = sum(int(u.get("points") or 0) for u in units)
        if total_cost > 0:
            roster["points"] = total_cost
        elif sum_unit_pts > 0:
            roster["points"] = sum_unit_pts
        else:
            roster["points"] = roster["points_limit"] or 2000

        existing_raw = str(data.get("raw_text") or "").strip()
        if existing_raw:
            roster["raw_text"] = existing_raw
        else:
            raw_lines = [
                "+++++++++++++++++++++++++++++++++++++++++++++++",
                f"+ ARMY NAME: {roster['name']}",
                f"+ FACTION KEYWORD: {roster.get('faction') or 'Space Marines'}",
                f"+ DETACHMENT: {detachment}",
                f"+ TOTAL ARMY POINTS: {roster['points']}pts",
            ]
            if roster.get("warlord"):
                raw_lines.append(f"+ WARLORD: {roster['warlord']}")
            raw_lines.append("+++++++++++++++++++++++++++++++++++++++++++++++")
            raw_lines.append("")
            for u in units:
                u_name = str(u.get("name") or "Unit").strip()
                u_pts = int(u.get("points") or 0)
                u_models = int(u.get("model_count") or 1)
                prefix = f"{u_models}x " if u_models > 1 and not re.match(r"^\d+x\s+", u_name, re.I) else ""
                pts_str = f" ({u_pts} pts)" if u_pts > 0 else ""
                raw_lines.append(f"{prefix}{u_name}{pts_str}")
                if u.get("is_warlord"):
                    raw_lines.append("• Warlord")
                if u.get("enhancement"):
                    raw_lines.append(f"• Enhancement: {u['enhancement']}")
                for wg in (u.get("wargear") or []):
                    wg_s = str(wg).strip()
                    if wg_s and wg_s.lower() not in ("warlord",):
                        raw_lines.append(f"• {wg_s}")
                raw_lines.append("")
            roster["raw_text"] = "\n".join(raw_lines).strip()

        return self._finalize_roster_compatibility(roster)

    def parse_url(self, url: str) -> Dict[str, Any]:
        """Resolves a NewRecruit share link into a complete, rich tactical roster."""
        import urllib.request
        clean_url = url.strip().split()[0]
        list_id_match = re.search(r"/list/([a-zA-Z0-9_\-]+)", clean_url) or re.search(r"/Lists/([a-zA-Z0-9_\-]+)", clean_url)
        list_id = list_id_match.group(1) if list_id_match else uuid.uuid4().hex[:8]
        canonical_url = f"https://www.newrecruit.eu/app/list/{list_id}" if list_id_match else clean_url

        roster = self._create_empty_roster()
        roster["id"] = f"nr_{list_id}"
        roster["name"] = f"NewRecruit Roster (#{list_id})"
        roster["source_url"] = canonical_url
        roster["source_format"] = "NewRecruit Link"

        # 1. Fetch complete data via NewRecruit open_share_link RPC
        try:
            rpc_url = "https://www.newrecruit.eu/api/rpc"
            payload = json.dumps({"method": "open_share_link", "params": [list_id]}).encode("utf-8")
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Origin": "https://www.newrecruit.eu",
                "Referer": f"https://www.newrecruit.eu/app/list/{list_id}"
            }
            req = urllib.request.Request(rpc_url, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=12.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, dict) and data.get("army"):
                        return self.parse_newrecruit_dict(
                            data,
                            default_id=f"nr_{list_id}",
                            source_url=canonical_url,
                            enrich=False,
                        )
        except Exception as e:
            logger.debug("NewRecruit RPC fetch notice: %s", e)

        # 2. Fast HTML metadata fallback if RPC is unavailable
        try:
            req = urllib.request.Request(
                canonical_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                if resp.status == 200:
                    html = resp.read().decode("utf-8", errors="ignore")
                    title_m = re.search(r"<title>([^<]+)</title>", html)
                    desc_m = re.search(r'<meta property="og:description" content="([^"]+)"', html)
                    
                    title = title_m.group(1).strip() if title_m else ""
                    desc = desc_m.group(1).strip() if desc_m else ""

                    if title and title != "New Recruit":
                        pts_m = re.search(r"\((\d+)\s*pts?\)", title)
                        pts = int(pts_m.group(1)) if pts_m else 2000
                        clean_name = re.sub(r"\s*\(\d+\s*pts?\)", "", title).strip()
                        roster["name"] = clean_name or roster["name"]
                        roster["points"] = pts
                        roster["points_limit"] = pts

                    if desc:
                        fac_m = re.search(r"^(?:Xenos|Imperium|Chaos)?\s*-?\s*([^\n\r\|]+)", desc)
                        if fac_m:
                            fac_name = fac_m.group(1).strip()
                            if fac_name and fac_name != "Warhammer 40,000":
                                roster["faction"] = fac_name
        except Exception as e:
            logger.debug("Fast NewRecruit metadata fetch notice: %s", e)

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
        if isinstance(data, dict) and (isinstance(data.get("army"), dict) or data.get("list_key")):
            return self.parse_newrecruit_dict(data, enrich=False)

        roster_obj = data.get("roster", data)
        roster_name = roster_obj.get("name") or data.get("name") or data.get("rosterName") or "Army Roster"
        roster_name = roster_name.strip()
        
        # Check if it has BattleScribe / NewRecruit forces structure
        if "forces" in roster_obj:
            total_pts = 2000
            for c in roster_obj.get("costs", []):
                if c.get("name") == "pts":
                    try: total_pts = int(float(c.get("value", 2000)))
                    except: pass
                    
            forces = roster_obj.get("forces", [])
            faction = "Warhammer 40,000"
            army_rules = []
            detachment = "Core Detachment"
            detachment_rules = []
            units = []
            warlord = ""
            
            for force in forces:
                if force.get("catalogueName"):
                    faction = force.get("catalogueName")
                    
                for r in force.get("rules", []):
                    rname = r.get("name")
                    rdesc = r.get("description")
                    if rname and not any(ar["name"] == rname for ar in army_rules):
                        army_rules.append({"name": rname, "description": rdesc})
                        
                for sel in force.get("selections", []):
                    s_name = sel.get("name", "")
                    primary_cat = next((c.get("name") for c in sel.get("categories", []) if c.get("primary")), "Infantry")
                    
                    if primary_cat == "Configuration" or s_name in ["Battle Size", "Detachment", "Force Disposition", "Show/Hide Options"]:
                        for sub in sel.get("selections", []):
                            sub_name = sub.get("name", "")
                            if s_name == "Detachment" or "Detachment" in sub.get("group", ""):
                                detachment = sub_name
                                for dr in sub.get("rules", []):
                                    if not any(d["name"] == dr.get("name") for d in detachment_rules):
                                        detachment_rules.append({"name": dr.get("name"), "description": dr.get("description")})
                        continue
                        
                    unit_pts = 0
                    for c in sel.get("costs", []):
                        if c.get("name") == "pts":
                            try: unit_pts = int(float(c.get("value", 0)))
                            except: pass
                            
                    model_count = int(sel.get("number", 1))
                    is_warlord = False
                    enhancement = None
                    abilities = []
                    rules = []
                    weapons = []
                    stats = {}
                    
                    for r in sel.get("rules", []):
                        if not any(ru["name"] == r.get("name") for ru in rules):
                            rules.append({"name": r.get("name"), "description": r.get("description")})
                        
                    def process_profiles(profiles_list):
                        nonlocal stats
                        for prof in profiles_list:
                            p_type = prof.get("typeName", "")
                            p_name = prof.get("name", "")
                            chars = {}
                            for c in prof.get("characteristics", []):
                                c_name = c.get("name", "")
                                c_val = ""
                                if isinstance(c, dict):
                                    for k in ["$text", "value", "text", "content", "$"]:
                                        if k in c and c[k] is not None:
                                            c_val = str(c[k])
                                            break
                                elif isinstance(c, (str, int, float)):
                                    c_val = str(c)
                                if c_name:
                                    chars[c_name] = c_val
                            
                            if (p_type == "Unit" or ("M" in chars and "T" in chars and "Sv" in chars)) and not stats:
                                stats = {
                                    "M": chars.get("M", "6\""),
                                    "T": chars.get("T", "4"),
                                    "SV": chars.get("Sv", chars.get("SV", "3+")),
                                    "INV": chars.get("InSv", chars.get("INV", "-")),
                                    "W": int(chars.get("W", 2)) if chars.get("W", "").isdigit() else chars.get("W", "2"),
                                    "LD": chars.get("LD", chars.get("Ld", "6+")),
                                    "OC": chars.get("OC", "1")
                                }
                            elif p_type in ["Ranged Weapons", "Melee Weapons", "Weapon"] or ("Range" in chars and ("A" in chars or "S" in chars or "BS" in chars or "WS" in chars)):
                                clean_wname = p_name.replace("➤", "").strip()
                                if not any(w["name"] == clean_wname for w in weapons):
                                    rng = chars.get("Range", "Melee")
                                    w_type = "Ranged" if p_type == "Ranged Weapons" or rng != "Melee" else "Melee"
                                    skill_val = chars.get("BS" if w_type == "Ranged" else "WS", chars.get("BS", chars.get("WS", "3+")))
                                    weapons.append({
                                        "name": clean_wname,
                                        "type": w_type,
                                        "range": rng,
                                        "Range": rng,
                                        "A": chars.get("A", "1"),
                                        "skill": skill_val,
                                        "BS": chars.get("BS", skill_val),
                                        "WS": chars.get("WS", skill_val),
                                        "S": chars.get("S", "4"),
                                        "AP": chars.get("AP", "0"),
                                        "D": chars.get("D", "1"),
                                        "keywords": [k.strip() for k in chars.get("Keywords", "").split(",") if k.strip()]
                                    })
                            elif p_type in ["Abilities", "Primarch of the First Legion", "Ability"] or ("Description" in chars or "Effect" in chars or "Rules" in chars):
                                desc = chars.get("Description", chars.get("Effect", chars.get("Rules", "")))
                                if p_name and not any(a["name"] == p_name for a in abilities):
                                    abilities.append({"name": p_name, "description": desc, "type": p_type})
                                    
                    process_profiles(sel.get("profiles", []))
                    
                    unit_keywords = [c.get("name") for c in sel.get("categories", []) if c.get("name") and not c.get("name").startswith("Configuration") and c.get("name") != "Unit"]
                    
                    def traverse_sub_selections(sub_list):
                        nonlocal is_warlord, enhancement, model_count
                        for sub in sub_list:
                            sub_name = sub.get("name", "")
                            if "warlord" in sub_name.lower() or any("warlord" in c.get("name", "").lower() for c in sub.get("categories", [])):
                                is_warlord = True
                            if "enhancement" in sub_name.lower() or any("enhancement" in c.get("name", "").lower() for c in sub.get("categories", [])):
                                enhancement = sub_name
                            
                            for c in sub.get("categories", []):
                                c_n = c.get("name")
                                if c_n and c_n not in unit_keywords and not c_n.startswith("Configuration"):
                                    unit_keywords.append(c_n)
                                    
                            process_profiles(sub.get("profiles", []))
                            for r in sub.get("rules", []):
                                if not any(ru["name"] == r.get("name") for ru in rules):
                                    rules.append({"name": r.get("name"), "description": r.get("description")})
                                    
                            traverse_sub_selections(sub.get("selections", []))
                            
                    traverse_sub_selections(sel.get("selections", []))
                    
                    if is_warlord and not warlord:
                        warlord = s_name
                        
                    if not stats:
                        stats = {"M": "6\"", "T": "4", "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": "1"}
                        
                    w_int = 2
                    try: w_int = int(stats.get("W", 2))
                    except: pass
                    
                    units.append({
                        "id": sel.get("id", f"u_{len(units)+1}"),
                        "name": s_name,
                        "role": primary_cat,
                        "points": unit_pts,
                        "model_count": model_count,
                        "is_warlord": is_warlord,
                        "enhancement": enhancement,
                        "stats": stats,
                        "max_wounds": w_int,
                        "current_wounds": w_int,
                        "weapons": weapons,
                        "abilities": abilities,
                        "rules": rules,
                        "wargear": [w["name"] for w in weapons],
                        "keywords": unit_keywords
                    })
                    
            return {
                "id": data.get("id") or f"list_{uuid.uuid4().hex[:10]}",
                "name": roster_name,
                "faction": faction,
                "detachment": detachment,
                "points": sum(u["points"] for u in units) or total_pts,
                "points_limit": total_pts,
                "warlord": warlord or (units[0]["name"] if units else ""),
                "source_format": "JSON Roster",
                "source_url": data.get("source_url"),
                "army_rules": army_rules,
                "detachment_rules": detachment_rules,
                "units": units,
                "enhancements": [u["enhancement"] for u in units if u.get("enhancement")],
                "stratagems": data.get("stratagems") or [],
                "raw_text": json.dumps(data)
            }

        # Fallback flat schema
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
                "stats": u.get("stats") or {"M": "6\"", "T": "4", "SV": "3+", "INV": "-", "W": 2, "LD": "6+", "OC": "1"},
                "wargear": u.get("wargear") or [],
                "weapons": u.get("weapons") or [],
                "abilities": u.get("abilities") or [],
                "rules": u.get("rules") or [],
                "keywords": u.get("keywords") or [role, faction],
            }
            parsed_units.append(unit_obj)

        return {
            "id": data.get("id") or f"list_{uuid.uuid4().hex[:10]}",
            "name": roster_name,
            "faction": faction,
            "detachment": detachment,
            "points": points,
            "points_limit": int(data.get("points_limit") or 2000),
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "JSON Roster",
            "source_url": data.get("source_url"),
            "army_rules": data.get("army_rules") or [],
            "detachment_rules": data.get("detachment_rules") or [],
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
        det_rule_inline = ""

        fac_match = re.search(r"FACTION KEYWORD:\s*(?:Xenos|Imperium|Chaos)?\s*-?\s*([^\n\r\+]+)", text, re.IGNORECASE)
        if fac_match:
            faction = fac_match.group(1).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()

        det_match = re.search(r"DETACHMENT:\s*([^\n\r\+]+)", text, re.IGNORECASE)
        if det_match:
            raw_det = det_match.group(1).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
            paren_m = re.search(r'\((.*?)\)', raw_det)
            if paren_m:
                det_rule_inline = paren_m.group(1).strip()
            detachment = re.sub(r'\(.*?\)', '', raw_det).strip() or raw_det

        pts_match = re.search(r"TOTAL ARMY POINTS:\s*(\d+)", text, re.IGNORECASE)
        if pts_match:
            try:
                points = int(pts_match.group(1))
            except Exception:
                pass

        wl_match = re.search(r"WARLORD:\s*(?:Char\d+:\s*)?([^\n\r\+]+)", text, re.IGNORECASE)
        if wl_match:
            warlord = wl_match.group(1).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()

        header_enh_map = {}
        for enh_line in re.finditer(r"(?:ENHANCEMENT:|\&)\s*([^(\n\r\+]+)(?:\s*\((?:on\s*)?(?:[A-Za-z]+\d+:\s*)?([^\)]+)\))?", text, re.IGNORECASE):
            enh_name = enh_line.group(1).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
            target_unit = (enh_line.group(2) or "").replace('\u00a0', ' ').replace('&nbsp;', ' ').strip().lower()
            if enh_name:
                header_enh_map[target_unit] = enh_name

        parsed_units = []
        current_unit = None
        unit_regex = re.compile(
            r"^(?:([A-Za-z]+\d+):\s*)?(?:(\d+)x\s+)?([^\(\:]+?)\s*\((?:(\d+)\s*pts?|(\d+)\s*points?)\)(?:\s*:\s*(.*))?",
            re.IGNORECASE,
        )
        enh_regex = re.compile(r"^Enhancements?:\s*(.+?)(?:\s*\(\s*\+?(\d+)\s*pts?\))?$", re.IGNORECASE)

        for line in lines:
            if line.startswith("+") or "created with newrecruit" in line.lower() or "total army points" in line.lower() or line.startswith("&"):
                continue

            enh_m = enh_regex.match(line)
            if enh_m and current_unit:
                current_unit["enhancement"] = enh_m.group(1).replace('\u00a0', ' ').strip()
                if enh_m.group(2):
                    try:
                        current_unit["enhancement_pts"] = int(enh_m.group(2))
                    except Exception:
                        pass
                continue

            u_m = unit_regex.match(line)
            if u_m:
                role_tag = u_m.group(1) or ""
                count = int(u_m.group(2) or 1)
                raw_uname = u_m.group(3).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
                pts = int(u_m.group(4) or u_m.group(5) or 0)
                wargear_str = u_m.group(6) or ""

                if raw_uname.lower().startswith(("warlord", "enhancement", "total", "secondary", "number of units", "force disposition")):
                    continue

                is_wl = bool(role_tag.lower().startswith("char") and "warlord" in wargear_str.lower()) or (
                    raw_uname.lower() in warlord.lower() if warlord else False
                )
                if is_wl and not warlord:
                    warlord = raw_uname

                wargear_list = [w.strip() for w in wargear_str.split(",") if w.strip()] if wargear_str else []

                current_unit = {
                    "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                    "name": raw_uname,
                    "role": "Character" if role_tag.lower().startswith("char") else "Infantry",
                    "model_count": count,
                    "points": pts,
                    "is_warlord": is_wl,
                    "enhancement": None,
                    "wargear": wargear_list,
                    "keywords": ["Character" if role_tag.lower().startswith("char") else "Infantry", faction],
                }
                parsed_units.append(current_unit)
            elif current_unit:
                # Any sub-model, equipment, bullet, or indented line under the current unit
                sub_content = line.lstrip('•-*· ').strip()
                if sub_content.lower().startswith(('leading ', 'attached to ')):
                    current_unit['attached_to'] = sub_content
                    continue
                if ':' in sub_content:
                    items_str = sub_content.split(':', 1)[1].strip()
                else:
                    items_str = sub_content
                for item in items_str.split(','):
                    item_clean = item.strip()
                    if item_clean and item_clean not in current_unit["wargear"]:
                        current_unit["wargear"].append(item_clean)

        # Match enhancements from header if not parsed in unit body
        for u in parsed_units:
            if not u.get("enhancement"):
                u_name_low = u["name"].lower()
                for t_name, enh_val in header_enh_map.items():
                    if t_name and (t_name in u_name_low or u_name_low in t_name):
                        u["enhancement"] = enh_val
                        break
                if not u.get("enhancement") and "" in header_enh_map and u.get("is_warlord"):
                    u["enhancement"] = header_enh_map[""]

        calculated_pts = sum(u["points"] for u in parsed_units)
        if calculated_pts > 0:
            points = calculated_pts

        detachment_rules = []
        if det_rule_inline:
            detachment_rules.append({"name": det_rule_inline, "description": f"Detachment Rule for {detachment}"})

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
            "detachment_rules": detachment_rules,
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
        """Parses official Warhammer 40k App text exports."""
        lines = [line.rstrip() for line in text.splitlines()]
        non_empty_lines = [(i, l.strip()) for i, l in enumerate(lines) if l.strip()]
        if not non_empty_lines:
            return self._create_empty_roster()

        header_roles = {
            "CHARACTERS": "Character",
            "BATTLELINE": "Battleline",
            "DEDICATED TRANSPORTS": "Transport",
            "OTHER DATASHEETS": "Infantry",
            "ALLIED UNITS": "Allied",
            "FORTIFICATIONS": "Fortification",
            "ATTACHED UNITS": "Character",
            "UNATTACHED UNITS": "Infantry",
        }

        first_cat_idx = len(lines)
        for i, l in non_empty_lines:
            upper = l.upper()
            if upper in header_roles or re.match(r"^ATTACHED\s+UNIT(S)?(\s+\d+)?$", upper):
                first_cat_idx = i
                break

        header_lines = [l for i, l in non_empty_lines if i < first_cat_idx]
        body_lines = [lines[i] for i, l in non_empty_lines if i >= first_cat_idx]

        roster_name = "Warhammer 40k App List"
        faction = "Warhammer 40,000"
        detachment = "Core Detachment"
        points = 2000

        known_factions = [
            "Space Marines", "Adeptus Astartes", "Blood Angels", "Dark Angels", "Black Templars",
            "Space Wolves", "Deathwatch", "Grey Knights", "Adepta Sororitas", "Adeptus Custodes",
            "Adeptus Mechanicus", "Astra Militarum", "Imperial Knights", "Chaos Space Marines",
            "Death Guard", "Thousand Sons", "World Eaters", "Chaos Knights", "Chaos Daemons",
            "Tyranids", "Genestealer Cults", "Necrons", "Orks", "T'au Empire", "Aeldari",
            "Drukhari", "Leagues of Votann", "Imperial Agents", "Emperor's Children"
        ]

        battle_sizes = ["strike force", "incursion", "combat patrol", "onslaught", "boarding patrol", "reconnaissance", "priority assets", "crusade"]

        if header_lines:
            first_line = header_lines[0]
            m_pts = re.search(r"^(.+?)\s*\((?:(\d+)\s*pts|(\d+)\s*points)\)", first_line, re.IGNORECASE)
            if m_pts:
                roster_name = m_pts.group(1).replace("’", "'").strip()
                points = int(m_pts.group(2) or m_pts.group(3) or 2000)

            # 1. Match Faction
            for hl in header_lines[1:]:
                hl_clean = hl.strip()
                hl_lower = hl_clean.lower()
                for kf in known_factions:
                    if kf.lower() in hl_lower:
                        faction = kf
                        break

            # 2. Match Detachment (prioritize lines with explicit Detachment / Detachment Points)
            found_explicit_det = False
            for hl in header_lines[1:]:
                hl_clean = hl.strip()
                if re.search(r"\bDetachment(?:\s+Points)?\b", hl_clean, re.IGNORECASE):
                    det_clean = re.sub(r"\(\s*\d+\s*Detachment\s*Points\s*\)", "", hl_clean, flags=re.IGNORECASE).strip()
                    det_clean = re.sub(r"\(.*?\)", "", det_clean).strip()
                    if det_clean:
                        detachment = det_clean
                        found_explicit_det = True
                        break

            if not found_explicit_det:
                for hl in header_lines[1:]:
                    hl_clean = hl.strip()
                    hl_lower = hl_clean.lower()
                    if any(bs in hl_lower for bs in battle_sizes):
                        continue
                    if any(kf.lower() in hl_lower for kf in known_factions):
                        continue
                    det_clean = re.sub(r"\(.*?\)", "", hl_clean).strip()
                    if det_clean and not any(bs in det_clean.lower() for bs in battle_sizes):
                        detachment = det_clean
                        break

        parsed_units = []
        current_unit = None
        current_role = "Infantry"
        warlord = ""

        def is_model_line(model_name: str, unit_name: str) -> bool:
            m_low = model_name.lower().strip()
            u_low = unit_name.lower().strip()
            if m_low in u_low or u_low.startswith(m_low) or m_low.rstrip('s') == u_low.rstrip('s'):
                return True
            if any(m_low.endswith(k) for k in ['sergeant', 'master', 'champion', 'captain', 'lieutenant', 'knight master', 'leader', 'justiciar']):
                return True
            return False

        unit_line_re = re.compile(r"^([^\(\[]+?)\s*\((?:(\d+)\s*pts|(\d+)\s*points)\)", re.IGNORECASE)
        enh_re = re.compile(r"^[•\-\*\s]*Enhancements?:\s*(.+?)(?:\s*\((?:Upgrade|\+?(\d+)\s*(?:pts?|points?))\))?$", re.IGNORECASE)

        for line in body_lines:
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("Exported with App Version"):
                continue

            upper = trimmed.upper()
            if upper in header_roles:
                current_role = header_roles[upper]
                current_unit = None
                continue

            # Subgroup separators inside attached units
            if re.match(r"^ATTACHED\s+UNIT\s+\d+$", upper) or re.match(r"^UNATTACHED\s+UNIT\s+\d+$", upper):
                current_unit = None
                continue

            is_indented = line.startswith(" ") or line.startswith("\t")
            u_m = unit_line_re.match(trimmed)
            if u_m and not is_indented and not trimmed.startswith("•") and not trimmed.startswith("-"):
                u_name = u_m.group(1).replace("’", "'").strip()
                u_pts = int(u_m.group(2) or u_m.group(3) or 0)
                current_unit = {
                    "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                    "name": u_name,
                    "role": current_role,
                    "model_count": 1,
                    "points": u_pts,
                    "is_warlord": False,
                    "enhancement": None,
                    "wargear": [],
                    "keywords": [current_role, faction]
                }
                parsed_units.append(current_unit)
                continue

            if current_unit:
                # Handle '• Attached as: Leader (Character)' or '• Attached as: Bodyguard'
                if "attached as:" in trimmed.lower() or "attached to:" in trimmed.lower():
                    if "character" in trimmed.lower() or "leader" in trimmed.lower():
                        current_unit["role"] = "Character"
                    elif "bodyguard" in trimmed.lower():
                        current_unit["role"] = "Infantry"
                    continue

                enh_m = enh_re.match(trimmed)
                if enh_m:
                    enh_name = enh_m.group(1).replace("’", "'").strip()
                    enh_clean = re.sub(r"\(.*?\)", "", enh_name).strip()
                    current_unit["enhancement"] = enh_clean
                    if enh_m.group(2):
                        try:
                            current_unit["enhancement_pts"] = int(enh_m.group(2))
                        except Exception:
                            pass
                    continue

                if "warlord" in trimmed.lower() and len(trimmed) < 20:
                    current_unit["is_warlord"] = True
                    if not warlord:
                        warlord = current_unit["name"]
                    continue

                count_m = re.match(r"^[•\-\*\s]*(\d+)x\s+([A-Za-z0-9\s\'\-’]+)$", trimmed, re.IGNORECASE)
                if count_m:
                    c_num = int(count_m.group(1))
                    c_name = count_m.group(2).replace("’", "'").strip()
                    if is_model_line(c_name, current_unit["name"]):
                        current_unit["model_count"] = c_num
                        continue
                    else:
                        if c_name not in current_unit["wargear"]:
                            current_unit["wargear"].append(c_name)
                        continue

                clean_sub = re.sub(r"^[•\-\*\s]+", "", trimmed).strip()
                item_clean = re.sub(r"^\d+x?\s+", "", clean_sub).replace("’", "'").strip()
                if item_clean and item_clean not in current_unit["wargear"]:
                    current_unit["wargear"].append(item_clean)

        base_sum = sum(u["points"] for u in parsed_units)
        enh_sum = sum(int(u.get("enhancement_pts") or 0) for u in parsed_units)
        total_calc = (base_sum + enh_sum) if enh_sum > 0 else base_sum
        text_up = text.upper()
        is_nr_gw_export = any(
            marker in text_up
            for marker in ("DETACHMENT POINTS)", "FORCE DISPOSITIONS:", "ATTACHED UNIT ", "ATTACHED AS:")
        )

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": roster_name,
            "faction": faction,
            "detachment": detachment,
            "points": total_calc or points,
            "points_limit": points or 2000,
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "NewRecruit" if is_nr_gw_export else "Warhammer 40k App",
            "source_url": None,
            "units": parsed_units,
            "enhancements": [u["enhancement"] for u in parsed_units if u.get("enhancement")],
            "stratagems": [],
            "raw_text": text,
        }

    def _parse_generic_text(self, text: str) -> Dict[str, Any]:
        """Intelligently parses any plain text, tournament, app, or note roster."""
        raw_lines = [line.rstrip() for line in text.splitlines()]
        lines = [line.strip() for line in raw_lines]
        non_empty_lines = [l for l in lines if l]
        if not non_empty_lines:
            return self._create_empty_roster()

        known_factions = [
            "Space Marines", "Adeptus Astartes", "Blood Angels", "Dark Angels", "Black Templars",
            "Space Wolves", "Deathwatch", "Grey Knights", "Adepta Sororitas", "Adeptus Custodes",
            "Adeptus Mechanicus", "Astra Militarum", "Imperial Knights", "Chaos Space Marines",
            "Death Guard", "Thousand Sons", "World Eaters", "Chaos Knights", "Chaos Daemons",
            "Tyranids", "Genestealer Cults", "Necrons", "Orks", "T'au Empire", "Aeldari",
            "Drukhari", "Leagues of Votann", "Imperial Agents", "Emperor's Children"
        ]

        faction = "Warhammer 40,000"
        detachment = "Core Detachment"
        total_points = 0
        warlord = ""
        roster_name = ""

        # 1. Header Analysis across first 8 lines
        for line in non_empty_lines[:8]:
            for kf in known_factions:
                if kf.lower() in line.lower():
                    faction = kf
                    break

            m_det = re.search(r"(?:Detachment|DETACHMENT):\s*([^\n\r\|\+]+)", line, re.IGNORECASE)
            if m_det:
                detachment = m_det.group(1).strip()
            elif " - " in line and any(kw in line.lower() for kw in ["task force", "detachment", "court", "spearhead", "host", "cadre", "phalanx", "fleet", "brotherhood", "crusade", "legion", "cult", "coven", "strike force", "swarm", "conclave", "horde", "clan", "cabal"]):
                parts = line.split(" - ")
                if len(parts) >= 2:
                    det_candidate = re.sub(r"[\(\[].*?[\)\]]", "", parts[-1]).strip()
                    if det_candidate:
                        detachment = det_candidate

            m_pts = re.search(r"(?:TOTAL ARMY POINTS|Points|Total)?\s*[:\(\[]\s*(\d{3,4})\s*(?:pts|points)?\s*[\)\]]?", line, re.IGNORECASE)
            if m_pts and not total_points:
                try:
                    pts_val = int(m_pts.group(1))
                    if 400 <= pts_val <= 4000:
                        total_points = pts_val
                except Exception:
                    pass

            if line.startswith("++") and "Army Roster" in line:
                m_rname = re.search(r"\+\+\s*(.*?)\s*\(", line)
                if m_rname and m_rname.group(1).strip() != "Army Roster":
                    roster_name = m_rname.group(1).strip()

        if not roster_name and non_empty_lines:
            first = non_empty_lines[0]
            if not first.startswith(("+", "-", "Char", "1", "2", "3", "4", "5", "6", "7", "8", "9")) and len(first) < 60:
                roster_name = re.sub(r"\s*[\(\[].*?[\)\]]", "", first).strip()

        # 2. Units parsing
        parsed_units = []
        current_role = "Infantry"
        current_unit = None
        enhancements_list = []
        saw_category_header = False

        category_pattern = re.compile(r"^[\+\#\=]*\s*(CHARACTERS?|EPIC HEROES?|BATTLELINE|INFANTRY|MOUNTED|VEHICLES?|MONSTERS?|DEDICATED TRANSPORTS?|OTHER DATASHEETS?|ALLIED UNITS?)\s*[\+\#\=]*$", re.IGNORECASE)

        for raw_line in raw_lines:
            line = raw_line.strip()
            if not line:
                continue

            # Check Category Header
            m_cat = category_pattern.match(line)
            if m_cat:
                saw_category_header = True
                c_upper = m_cat.group(1).upper()
                if "CHAR" in c_upper or "EPIC" in c_upper:
                    current_role = "Character"
                elif "BATTLELINE" in c_upper:
                    current_role = "Battleline"
                elif "MOUNTED" in c_upper:
                    current_role = "Mounted"
                elif "VEHICLE" in c_upper or "MONSTER" in c_upper:
                    current_role = "Vehicle"
                elif "TRANSPORT" in c_upper:
                    current_role = "Transport"
                else:
                    current_role = "Infantry"
                continue

            # Skip section dividers & metadata headers
            if line.startswith(("++", "==", "--")) or line.lower().startswith(("faction keyword:", "detachment:", "total army points:", "battle size:", "force dispositions:")):
                continue

            # Skip roster title line if matched
            if (roster_name and line.lower() == roster_name.lower()) or (any(kf.lower() in line.lower() for kf in known_factions) and any(kw in line.lower() for kw in ["task force", "detachment", "court", "spearhead", "host", "cadre", "phalanx", "fleet", "brotherhood", "crusade", "army roster", "legion", "cult", "coven", "swarm", "strike force"])):
                continue

            # Check if line is an Enhancement subline
            if current_unit and ("enhancement:" in line.lower() or line.lower().startswith(("enhancement:", "enhancements:", "+ enhancement", "• enhancement", "- enhancement"))):
                enh_m = re.search(r"enhancements?:\s*([^\(\[\:\n\r]+)", line, re.IGNORECASE)
                if enh_m:
                    enh_name = enh_m.group(1).strip()
                    current_unit["enhancement"] = enh_name
                    if enh_name not in enhancements_list:
                        enhancements_list.append(enh_name)
                    continue

            if current_unit and line.lower().strip() in ("warlord", "• warlord", "- warlord", "+ warlord"):
                current_unit["is_warlord"] = True
                if not warlord:
                    warlord = current_unit["name"]
                continue

            is_bullet_or_indented = raw_line.startswith((" ", "\t")) or line.startswith(("•", "◦", "‣", "*", "-"))

            # Process unit line
            line_clean = re.sub(r"^(?:(?:Char\d+|Unit\d+)\s*:\s*)", "", line).strip()
            line_clean = re.sub(r"^[\-\*•\+]\s*", "", line_clean).strip()

            # Check count
            count = 1
            m_cnt = re.match(r"^(\d+)\s*x\s+(.*)", line_clean, re.IGNORECASE)
            if m_cnt:
                count = int(m_cnt.group(1))
                line_clean = m_cnt.group(2).strip()

            # Extract points: (80 pts) or [80pts] or (80 points)
            m_pts = re.search(r"[\(\[]\s*(\d{2,4})\s*(?:pts|points)?\s*[\)\]]", line_clean, re.IGNORECASE)

            # If this is a bulleted or indented sub-line WITHOUT points under an active unit, attach as wargear
            if is_bullet_or_indented and not m_pts and current_unit is not None:
                wg_item = re.sub(r"^\d+x?\s+", "", line_clean).strip()
                if wg_item and wg_item.lower() not in ("warlord",) and wg_item not in current_unit["wargear"]:
                    current_unit["wargear"].append(wg_item)
                continue

            # Do not turn arbitrary plain-text sentences without points/counts/headers into fake units
            if not m_pts and not m_cnt and not saw_category_header:
                continue

            pts = 0
            wargear_part = ""
            if m_pts:
                pts = int(m_pts.group(1))
                before_pts = line_clean[:m_pts.start()].strip()
                after_pts = line_clean[m_pts.end():].strip()
                raw_name = before_pts
                if after_pts.startswith(":"):
                    wargear_part = after_pts[1:].strip()
                elif after_pts:
                    wargear_part = after_pts.strip()
            else:
                if ":" in line_clean:
                    parts = line_clean.split(":", 1)
                    raw_name = parts[0].strip()
                    wargear_part = parts[1].strip()
                else:
                    raw_name = line_clean

            if not raw_name or len(raw_name) < 2 or raw_name.lower() in ("configuration", "battle size", "roster", "total"):
                continue

            is_wl = "warlord" in line.lower()
            enh = None
            if "enhancement" in line.lower():
                em = re.search(r"enhancements?:\s*([^\(\[\,\:\n\r]+)", line, re.IGNORECASE)
                if em:
                    enh = em.group(1).strip()
                    if enh not in enhancements_list:
                        enhancements_list.append(enh)

            wargear = []
            if wargear_part:
                for p in wargear_part.split(","):
                    p_clean = p.strip()
                    if p_clean and not any(k in p_clean.lower() for k in ["warlord", "enhancement"]):
                        wargear.append(p_clean)

            if is_wl and not warlord:
                warlord = raw_name

            role = current_role
            if "character" in raw_name.lower() or "captain" in raw_name.lower() or "lieutenant" in raw_name.lower() or "lord" in raw_name.lower() or "techpriest" in raw_name.lower() or is_wl or enh:
                role = "Character"
            elif "intercessor" in raw_name.lower() or "battleline" in raw_name.lower() or "tactical squad" in raw_name.lower() or "boyz" in raw_name.lower() or "warriors" in raw_name.lower():
                role = "Battleline"
            elif "dreadnought" in raw_name.lower() or "tank" in raw_name.lower() or "repulsor" in raw_name.lower() or "land raider" in raw_name.lower():
                role = "Vehicle"

            current_unit = {
                "id": f"u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}",
                "name": raw_name,
                "role": role,
                "model_count": count,
                "points": pts,
                "is_warlord": is_wl,
                "enhancement": enh,
                "wargear": wargear,
                "keywords": [role, faction]
            }
            parsed_units.append(current_unit)

        calc_pts = sum(u["points"] for u in parsed_units)
        final_pts = calc_pts if calc_pts > 0 else (total_points or 2000)

        return {
            "id": f"list_{uuid.uuid4().hex[:10]}",
            "name": roster_name or f"{faction} - {detachment}",
            "faction": faction,
            "detachment": detachment,
            "points": final_pts,
            "points_limit": 2000,
            "warlord": warlord or (parsed_units[0]["name"] if parsed_units else ""),
            "source_format": "Intelligent Text Paste",
            "source_url": None,
            "units": parsed_units,
            "enhancements": enhancements_list,
            "stratagems": [],
            "raw_text": text
        }


_parser_instance: Optional[ArmyListParser] = None


def get_parser() -> ArmyListParser:
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = ArmyListParser()
    return _parser_instance
