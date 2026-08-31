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

    def _enrich_with_wahapedia(self, roster: Dict[str, Any]) -> Dict[str, Any]:
        """Auto-enriches parsed roster with full datasheets, stats, weapons, abilities, stratagems, enhancements, and detachment rules from PostgreSQL."""
        if not roster or not isinstance(roster, dict):
            return roster

        try:
            from database import get_db
            db = get_db()
        except Exception as e:
            logger.debug(f"Wahapedia DB not available for enrichment: {e}")
            return roster

        faction = roster.get("faction") or ""
        detachment = roster.get("detachment") or ""
        
        # Include any detachment rule names in lookup if available
        rule_hints = [r.get("name") for r in (roster.get("detachment_rules") or []) if r.get("name")]
        if rule_hints:
            lookup_det = f"{detachment} ({', '.join(rule_hints)})"
        else:
            lookup_det = detachment

        # 1. Enrich Army Rules if missing
        if faction and not roster.get("army_rules"):
            try:
                army_rules = db.waha_get_army_rules(faction)
                if army_rules:
                    roster["army_rules"] = army_rules
            except Exception as e:
                logger.debug(f"Error enriching army rules: {e}")

        # 2. Enrich Stratagems if missing
        if lookup_det and not roster.get("stratagems"):
            try:
                strats = db.waha_get_stratagems(lookup_det)
                if strats:
                    roster["stratagems"] = strats
            except Exception as e:
                logger.debug(f"Error enriching stratagems: {e}")

        # 3. Enrich Detachment Enhancements if missing
        available_enhancements = roster.get("available_enhancements") or []
        if lookup_det and not available_enhancements:
            try:
                enhancements = db.waha_get_enhancements(lookup_det)
                if enhancements:
                    roster["available_enhancements"] = enhancements
                    available_enhancements = enhancements
            except Exception as e:
                logger.debug(f"Error enriching enhancements: {e}")

        # 4. Enrich Detachment Rules from Wahapedia
        if lookup_det:
            try:
                det_rules = db.waha_get_detachment_rules(lookup_det)
                if det_rules:
                    roster["detachment_rules"] = det_rules
            except Exception as e:
                logger.debug(f"Error enriching detachment rules: {e}")

        # 4. Enrich each unit & match enhancements
        units = roster.get("units") or []
        for u in units:
            u_name = u.get("name") or ""
            if not u_name:
                continue

            try:
                w_unit = db.waha_find_unit(u_name, faction_name=faction)
                if w_unit:
                    if not u.get("stats") or not u.get("weapons"):
                        u["stats"] = w_unit.get("stats") or u.get("stats")
                    
                    ds_weapons = w_unit.get("weapons") or []
                    u_wargear = u.get("wargear") or []
                    
                    cleaned_wargear = []
                    for wg in u_wargear:
                        c = re.sub(r'^\s*\d+x?\s+(?:with\s+)?', '', str(wg), flags=re.IGNORECASE).strip()
                        c = re.sub(r'\s*\(\+?\d+\s*pts?\)', '', c, flags=re.IGNORECASE).strip()
                        if c and c.lower() not in ('warlord', 'resurrection orb', 'leading', 'attached to') and not c.lower().startswith('char'):
                            cleaned_wargear.append(c)

                    # 1. Filter weapons if unit explicitly specified wargear
                    if cleaned_wargear and ds_weapons:
                        def matches_weapon(w_item, w_names):
                            w_clean = (w_item.get("name") or "").strip().lower()
                            w_base = re.split(r'[\–\-\/]', w_clean)[0].strip()
                            for item in w_names:
                                i_clean = item.strip().lower()
                                i_base = re.split(r'[\–\-\/]', i_clean)[0].strip()
                                if w_clean == i_clean or w_base == i_clean or w_base == i_base:
                                    return True
                                if (i_clean and i_clean in w_clean) or (i_base and i_base in w_base) or (w_clean and w_clean in i_clean):
                                    return True
                            return False

                        matched_weapons = [w for w in ds_weapons if matches_weapon(w, cleaned_wargear)]
                        if matched_weapons:
                            u["weapons"] = matched_weapons
                        elif not u.get("weapons") or len(u.get("weapons", [])) == 0:
                            u["weapons"] = ds_weapons
                    elif not u.get("weapons") or len(u.get("weapons", [])) == 0:
                        u["weapons"] = ds_weapons

                    # 2. Filter abilities (optional wargear abilities vs intrinsic datasheet abilities)
                    ds_abilities = w_unit.get("abilities") or []
                    if cleaned_wargear and ds_abilities:
                        wg_lower_set = {wg.lower() for wg in cleaned_wargear}
                        filtered_abilities = []
                        for ab in ds_abilities:
                            ab_name = (ab.get("name") or "").strip()
                            ab_name_lower = ab_name.lower()
                            ab_type = (ab.get("type") or "").strip().lower()
                            
                            if ab_type == 'wargear':
                                if any(wg in ab_name_lower or ab_name_lower in wg for wg in wg_lower_set):
                                    filtered_abilities.append(ab)
                            else:
                                filtered_abilities.append(ab)
                        u["abilities"] = filtered_abilities or ds_abilities
                    elif not u.get("abilities") or len(u.get("abilities", [])) == 0:
                        u["abilities"] = ds_abilities

                    if not u.get("keywords") or len(u.get("keywords", [])) <= 2:
                        u["keywords"] = w_unit.get("keywords") or u.get("keywords", [])
                    if (not u.get("role") or u.get("role") == "Infantry") and w_unit.get("role"):
                        u["role"] = w_unit["role"]
            except Exception as e:
                logger.debug(f"Error enriching unit {u_name}: {e}")

            # Match unit's enhancement with available_enhancements or database
            u_enh = u.get("enhancement")
            if u_enh:
                enh_name_clean = re.sub(r'\(.*?\)', '', str(u_enh)).strip().lower()
                matched_enh = None
                for enh in available_enhancements:
                    if enh.get("name") and enh.get("name").strip().lower() == enh_name_clean:
                        matched_enh = enh
                        break
                    elif enh.get("name") and (enh_name_clean in enh.get("name").strip().lower() or enh.get("name").strip().lower() in enh_name_clean):
                        matched_enh = enh
                        break

                if not matched_enh and lookup_det:
                    try:
                        matched_enh_list = db.waha_get_enhancements(lookup_det)
                        for enh in matched_enh_list:
                            if enh.get("name") and enh.get("name").strip().lower() in enh_name_clean:
                                matched_enh = enh
                                break
                    except Exception:
                        pass

                if matched_enh:
                    u["enhancement_detail"] = {
                        "name": matched_enh.get("name") or u_enh,
                        "description": matched_enh.get("description") or "",
                        "cost": matched_enh.get("cost") or matched_enh.get("points") or "",
                        "legend": matched_enh.get("legend") or ""
                    }

        return roster

    def parse_file(self, raw_bytes: bytes, filename: str = "") -> Dict[str, Any]:
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

        return self._enrich_with_wahapedia(res or self._create_empty_roster())

    def parse(self, raw_input: str, source_hint: Optional[str] = None) -> Dict[str, Any]:
        if not raw_input or not raw_input.strip():
            return self._create_empty_roster()

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
            if "FACTION KEYWORD:" in content or (content.startswith("++") and "TOTAL ARMY POINTS" in content):
                res = self._parse_newrecruit_text(content)
            elif "++ Army Roster" in content or "+ Epic Hero +" in content or "+ Character +" in content:
                res = self._parse_battlescribe_text(content)
            elif "CHARACTERS" in content or "BATTLELINE" in content or "OTHER DATASHEETS" in content:
                res = self._parse_warhammer_app_text(content)
            else:
                res = self._parse_generic_text(content)

        return self._enrich_with_wahapedia(res or self._create_empty_roster())

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

    def parse_url(self, url: str) -> Dict[str, Any]:
        """Resolves a NewRecruit share link into a complete, rich tactical roster."""
        import urllib.request
        clean_url = url.strip().split()[0]
        list_id_match = re.search(r"/list/([a-zA-Z0-9_\-]+)", clean_url)
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
                        roster["name"] = data.get("name") or roster["name"]
                        total_cost = data.get("totalCost") or 2000
                        roster["points"] = total_cost
                        roster["points_limit"] = total_cost
                        
                        roster["source_url"] = canonical_url

                        army = data.get("army", {})
                        faction = roster["faction"]
                        detachment = "Core Detachment"
                        warlord = None
                        units = []

                        # Traverse root options to find faction & categories
                        def find_army_roster_node(node):
                            nonlocal faction
                            name = node.get("name", "")
                            if " - " in name:
                                faction = name.split(" - ")[-1].strip()
                            for opt in node.get("options", []):
                                if opt.get("name") == "Army Roster":
                                    return opt
                                res = find_army_roster_node(opt)
                                if res:
                                    return res
                            return None

                        roster_node = find_army_roster_node(army) or army
                        roster["faction"] = faction

                        categories = roster_node.get("options", [])
                        for cat in categories:
                            cat_name = cat.get("name", "")
                            if cat_name in ["Configuration", "Show/Hide Options", "Detachment Rules"]:
                                for opt in cat.get("options", []):
                                    if opt.get("name") == "Detachment":
                                        for sub in opt.get("options", []):
                                            for sub_sub in sub.get("options", []):
                                                detachment = sub_sub.get("name", detachment)
                                continue

                            # Parse unit entries in this category
                            for unit_node in cat.get("options", []):
                                u_name = unit_node.get("customName") or unit_node.get("name", "Unit")
                                u_amount = unit_node.get("amount", 1)
                                u_warlord = False
                                u_enhancement = None
                                wargear = []

                                def parse_unit_sub(sub_node):
                                    nonlocal u_warlord, u_enhancement
                                    s_name = sub_node.get("name", "")
                                    if s_name == "Warlord" or "Warlord" in s_name:
                                        u_warlord = True
                                    elif s_name in ["Enhancements", "Enhancement"]:
                                        for enh in sub_node.get("options", []):
                                            if enh.get("name"):
                                                u_enhancement = enh.get("name")
                                    elif s_name in ["Wargear", "Weapons", "Wargear options", "Ranged Weapons", "Melee Weapons"]:
                                        for wg in sub_node.get("options", []):
                                            parse_unit_sub(wg)
                                    else:
                                        if sub_node.get("options"):
                                            for c in sub_node.get("options", []):
                                                parse_unit_sub(c)
                                        elif s_name and s_name not in ["Unit", "Model", "Option"]:
                                            wargear.append(s_name)

                                for sub in unit_node.get("options", []):
                                    parse_unit_sub(sub)

                                if u_warlord and not warlord:
                                    warlord = u_name

                                m_val = '10"' if ("Mounted" in cat_name or "Vehicle" in cat_name) else '6"'
                                t_val = 10 if ("Vehicle" in cat_name or "Monster" in cat_name) else 4
                                w_val = 12 if "Vehicle" in cat_name else (5 if "Character" in cat_name else 2)
                                sv_val = "2+" if ("Vehicle" in cat_name or "Character" in cat_name) else "3+"

                                units.append({
                                    "id": f"u_{len(units)+1}",
                                    "name": u_name,
                                    "role": cat_name,
                                    "is_warlord": u_warlord,
                                    "enhancement": u_enhancement,
                                    "model_count": max(1, u_amount),
                                    "wargear": list(dict.fromkeys(wargear))[:6],
                                    "stats": {
                                        "M": m_val,
                                        "T": t_val,
                                        "SV": sv_val,
                                        "INV": "4+" if (u_warlord or "Character" in cat_name) else "-",
                                        "W": w_val,
                                        "LD": "6+",
                                        "OC": 2 if "Battleline" in cat_name else 1
                                    },
                                    "keywords": [faction, cat_name, u_name],
                                    "points": 0
                                })

                        roster["detachment"] = detachment
                        roster["warlord"] = warlord
                        roster["units"] = units
                        return roster
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
        for enh_line in re.finditer(r"ENHANCEMENT:\s*([^(\n\r\+]+)(?:\s*\((?:on\s*)?(?:Char\d+:\s*)?([^\)]+)\))?", text, re.IGNORECASE):
            enh_name = enh_line.group(1).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
            target_unit = (enh_line.group(2) or "").replace('\u00a0', ' ').replace('&nbsp;', ' ').strip().lower()
            if enh_name:
                header_enh_map[target_unit] = enh_name

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
                current_unit["enhancement"] = enh_m.group(1).replace('\u00a0', ' ').strip()
                if enh_m.group(2):
                    try:
                        current_unit["enhancement_pts"] = int(enh_m.group(2))
                    except Exception:
                        pass
                continue

            u_m = unit_regex.match(line)
            if u_m:
                char_tag = u_m.group(1)
                count = int(u_m.group(2) or 1)
                raw_uname = u_m.group(3).replace('\u00a0', ' ').replace('&nbsp;', ' ').strip()
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
            elif current_unit and (line.startswith(('•', '-', '*', '·')) or ':' in line):
                # Sub-model or bullet wargear line (e.g. • 1x Sergeant: Power Weapon, Bolt Pistol)
                sub_content = line.lstrip('•-*· ').strip()
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
        """Intelligently parses any plain text, tournament, app, or note roster."""
        lines = [line.strip() for line in text.splitlines()]
        non_empty_lines = [l for l in lines if l]
        if not non_empty_lines:
            return self._create_empty_roster()

        known_factions = [
            "Space Marines", "Adeptus Astartes", "Blood Angels", "Dark Angels", "Black Templars",
            "Space Wolves", "Deathwatch", "Grey Knights", "Adepta Sororitas", "Adeptus Custodes",
            "Adeptus Mechanicus", "Astra Militarum", "Imperial Knights", "Chaos Space Marines",
            "Death Guard", "Thousand Sons", "World Eaters", "Chaos Knights", "Chaos Daemons",
            "Tyranids", "Genestealer Cults", "Necrons", "Orks", "T'au Empire", "Aeldari",
            "Drukhari", "Leagues of Votann", "Imperial Agents"
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

        category_pattern = re.compile(r"^[\+\#\=]*\s*(CHARACTERS?|EPIC HEROES?|BATTLELINE|INFANTRY|MOUNTED|VEHICLES?|MONSTERS?|DEDICATED TRANSPORTS?|OTHER DATASHEETS?|ALLIED UNITS?)\s*[\+\#\=]*$", re.IGNORECASE)

        for line in lines:
            if not line:
                continue

            # Check Category Header
            m_cat = category_pattern.match(line)
            if m_cat:
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
            if line.startswith(("++", "==", "--")) or line.lower().startswith(("faction keyword:", "detachment:", "total army points:", "battle size:")):
                continue

            # Skip roster title line if matched
            if (roster_name and roster_name.lower() in line.lower()) or (any(kf.lower() in line.lower() for kf in known_factions) and any(kw in line.lower() for kw in ["task force", "detachment", "court", "spearhead", "host", "cadre", "phalanx", "fleet", "brotherhood", "crusade", "army roster", "legion", "cult", "coven", "swarm", "strike force"])):
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
