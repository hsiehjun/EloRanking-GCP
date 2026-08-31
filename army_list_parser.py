import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple
from wahapedia_service import get_wahapedia

logger = logging.getLogger('ArmyListParser')

class ArmyListParser:
    def __init__(self):
        self.waha = get_wahapedia()

    def parse(self, raw_input: str, source_hint: Optional[str] = None) -> Dict[str, Any]:
        if not raw_input or not raw_input.strip():
            return self._create_empty_roster()

        content = raw_input.strip()

        # 1. URL Detection (e.g. https://www.newrecruit.eu/app/list/28iCj)
        if content.startswith(('http://', 'https://')) or 'newrecruit.eu' in content:
            return self.parse_url(content)

        if content.startswith('{') and content.endswith('}'):
            try:
                data = json.loads(content)
                return self._parse_json_roster(data)
            except Exception as e:
                logger.debug('JSON parse fallback: %s', e)

        # Detect format
        if 'FACTION KEYWORD:' in content or 'newrecruit' in content.lower() or content.startswith('++') and 'TOTAL ARMY POINTS' in content:
            return self._parse_newrecruit_text(content)
        elif '++ Army Roster' in content or '+ Epic Hero +' in content or '+ Character +' in content:
            return self._parse_battlescribe_text(content)
        elif 'CHARACTERS' in content or 'BATTLELINE' in content or 'OTHER DATASHEETS' in content:
            return self._parse_warhammer_app_text(content)
        else:
            return self._parse_generic_text(content)

    def parse_url(self, url: str) -> Dict[str, Any]:
        """Resolves a NewRecruit or public roster URL into an enriched roster."""
        clean_url = url.strip().split()[0]
        list_id_match = re.search(r'/list/([a-zA-Z0-9_\-]+)', clean_url)
        list_id = list_id_match.group(1) if list_id_match else uuid.uuid4().hex[:8]
        canonical_url = f"https://www.newrecruit.eu/app/list/{list_id}" if list_id_match else clean_url

        # Attempt to fetch list if available
        roster = self._create_empty_roster()
        roster['id'] = f'nr_{list_id}'
        roster['name'] = f'NewRecruit Roster (#{list_id})'
        roster['source_url'] = canonical_url
        roster['source_format'] = 'NewRecruit Link'

        return roster

    def _create_empty_roster(self) -> Dict[str, Any]:
        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': 'Unnamed Army List',
            'faction': 'Unknown Faction',
            'detachment': 'Core Detachment',
            'points': 0,
            'points_limit': 2000,
            'warlord': '',
            'source_format': 'Custom',
            'source_url': None,
            'units': [],
            'enhancements': [],
            'stratagems': self.waha.get_stratagems_for_detachment('Unknown'),
            'raw_text': ''
        }

    def _parse_json_roster(self, data: Dict[str, Any]) -> Dict[str, Any]:
        name = data.get('name') or data.get('rosterName') or 'Imported Army List'
        faction = data.get('faction') or data.get('catalogueName') or 'Warhammer 40,000'
        detachment = data.get('detachment') or 'Core'
        points = int(data.get('points') or data.get('costs', {}).get('pts') or 2000)
        warlord = data.get('warlord') or ''

        units_raw = data.get('units') or data.get('selections') or []
        parsed_units = []

        for idx, u in enumerate(units_raw):
            uname = u.get('name') or 'Unit'
            pts = int(u.get('points') or u.get('cost') or 0)
            role = u.get('role') or u.get('type') or 'Infantry'
            is_wl = bool(u.get('is_warlord') or u.get('warlord'))
            enh = u.get('enhancement') or u.get('enhancements')
            models_cnt = int(u.get('models') or u.get('model_count') or 1)

            if is_wl and not warlord:
                warlord = uname

            waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}

            unit_obj = {
                'id': f'u_{idx+1}_{uuid.uuid4().hex[:6]}',
                'name': uname,
                'role': role or waha_ds.get('role', 'Infantry'),
                'model_count': models_cnt,
                'points': pts,
                'is_warlord': is_wl,
                'enhancement': enh,
                'stats': u.get('stats') or waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                'weapons': u.get('weapons') or waha_ds.get('weapons', []),
                'abilities': u.get('abilities') or waha_ds.get('abilities', []),
                'keywords': u.get('keywords') or waha_ds.get('keywords', ['Infantry'])
            }
            parsed_units.append(unit_obj)

        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': data.get('id') or f'list_{uuid.uuid4().hex[:10]}',
            'name': name,
            'faction': faction,
            'detachment': detachment,
            'points': points,
            'points_limit': int(data.get('points_limit') or 2000),
            'warlord': warlord,
            'source_format': 'NewRecruit JSON',
            'units': parsed_units,
            'enhancements': data.get('enhancements', []),
            'stratagems': stratagems,
            'raw_text': json.dumps(data, indent=2)
        }

    def _parse_newrecruit_text(self, text: str) -> Dict[str, Any]:
        """Parses NewRecruit / WTC / BCP standardized text army export format."""
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        faction = 'Necrons'
        detachment = 'Core Detachment'
        points = 2000
        warlord = ''

        # 1. Extract metadata from header block
        fac_match = re.search(r'FACTION KEYWORD:\s*(?:(?:Xenos|Imperium|Chaos)\s*[-–—]\s*)?([^\n\r\+]+)', text, re.IGNORECASE)
        if fac_match:
            faction = fac_match.group(1).strip()

        det_match = re.search(r'DETACHMENT:\s*([^\n\r\+]+)', text, re.IGNORECASE)
        if det_match:
            detachment = det_match.group(1).strip()

        pts_match = re.search(r'TOTAL ARMY POINTS:\s*(\d+)', text, re.IGNORECASE)
        if pts_match:
            try:
                points = int(pts_match.group(1))
            except:
                pass

        wl_match = re.search(r'WARLORD:\s*(?:Char\d+:\s*)?([^\n\r\+]+)', text, re.IGNORECASE)
        if wl_match:
            warlord = wl_match.group(1).strip()

        # 2. Parse Unit lines
        parsed_units = []
        current_unit = None
        unit_regex = re.compile(r'^(?:(Char\d+):\s*)?(?:(\d+)x\s+)?([^\(\:]+?)\s*\((?:(\d+)\s*pts?|(\d+)\s*points?)\)(?:\s*:\s*(.*))?', re.IGNORECASE)
        enh_regex = re.compile(r'^Enhancements?:\s*(.+?)(?:\s*\(\s*\+?(\d+)\s*pts?\))?$', re.IGNORECASE)

        for line in lines:
            if line.startswith('+') or 'Created with newrecruit' in line.lower() or 'TOTAL ARMY POINTS' in line:
                continue

            # Check if line is an Enhancement
            enh_m = enh_regex.match(line)
            if enh_m and current_unit:
                enh_name = enh_m.group(1).strip()
                current_unit['enhancement'] = enh_name
                continue

            # Match unit line
            u_m = unit_regex.match(line)
            if u_m:
                char_tag = u_m.group(1)
                count = int(u_m.group(2) or 1)
                raw_uname = u_m.group(3).strip()
                pts = int(u_m.group(4) or u_m.group(5) or 0)
                wargear_str = u_m.group(6) or ''

                if raw_uname.lower().startswith(('warlord', 'enhancement', 'total', 'secondary', 'number of units')):
                    continue

                is_wl = bool(char_tag and 'warlord' in wargear_str.lower()) or (raw_uname.lower() in warlord.lower() if warlord else False)
                if is_wl and not warlord:
                    warlord = raw_uname

                waha_ds = self.waha.lookup_unit(raw_uname, faction=faction) or {}

                # Enrich weapons if custom wargear present
                unit_weapons = list(waha_ds.get('weapons', []))

                current_unit = {
                    'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                    'name': raw_uname,
                    'role': 'Character' if char_tag else waha_ds.get('role', 'Infantry'),
                    'model_count': count,
                    'points': pts,
                    'is_warlord': is_wl,
                    'enhancement': None,
                    'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                    'weapons': unit_weapons,
                    'abilities': waha_ds.get('abilities', []),
                    'keywords': waha_ds.get('keywords', ['Infantry', faction])
                }
                parsed_units.append(current_unit)

        calculated_pts = sum(u['points'] for u in parsed_units)
        if calculated_pts > 0:
            points = calculated_pts

        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': f'{faction} ({detachment})',
            'faction': faction,
            'detachment': detachment,
            'points': points,
            'points_limit': 2000,
            'warlord': warlord or (parsed_units[0]['name'] if parsed_units else ''),
            'source_format': 'NewRecruit',
            'units': parsed_units,
            'enhancements': [u['enhancement'] for u in parsed_units if u['enhancement']],
            'stratagems': stratagems,
            'raw_text': text
        }

    def _parse_warhammer_app_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        name = 'Warhammer App List'
        faction = 'Space Marines'
        detachment = 'Gladius Task Force'
        points = 2000
        warlord = ''

        if lines:
            header_line = lines[0]
            pts_match = re.search(r'\((\d+)\s*Points?\)', text, re.IGNORECASE)
            if pts_match:
                points = int(pts_match.group(1))

            # Detect Faction on early lines
            for l in lines[:5]:
                if any(f in l.upper() for f in ['NECRON', 'SPACE MARINE', 'ORK', 'CUSTODES', 'TYRANID', 'TAU', 'CHAOS', 'AELDARI', 'SORORITAS', 'VOTANN']):
                    faction = l.split('-')[0].strip()
                    break

            # Detect Detachment
            for l in lines[:5]:
                if any(d in l.upper() for d in ['TASK FORCE', 'COURT', 'DYNASTY', 'LEGION', 'ARSENAL', 'HORDE', 'HOST', 'FLEET', 'STORM', 'PHALANX']):
                    detachment = l.split('(')[0].strip()
                    break

        current_role = 'Infantry'
        parsed_units = []
        current_unit = None

        role_keywords = {'CHARACTERS': 'Character', 'BATTLELINE': 'Battleline', 'DEDICATED TRANSPORTS': 'Dedicated Transport', 'OTHER DATASHEETS': 'Other', 'ALLIED UNITS': 'Allied'}

        for idx, line in enumerate(lines):
            upper = line.upper()
            if upper in role_keywords:
                current_role = role_keywords[upper]
                continue

            if idx < 4 and ("STRIKE FORCE" in upper or "INCURSION" in upper or "COMBAT PATROL" in upper):
                continue

            # Check if line is an Enhancement sub-item for current unit
            enh_match = re.search(r'Enhancements?:\s*([^\(\)]+)(?:\s*\(\s*(\d+)\s*pts?\))?', line, re.IGNORECASE)
            if enh_match and current_unit:
                enh_name = enh_match.group(1).strip()
                enh_pts = int(enh_match.group(2) or 0)
                current_unit['enhancement'] = enh_name
                current_unit['points'] += enh_pts
                continue

            unit_pts_match = re.match(r'^(?:[•\*\-]\s*)?(?:Char\d+:\s*)?(?:(\d+)x\s+)?([^\(\:]+)\s*\((?:(\d+)\s*pts?|(\d+)\s*points?)\)', line, re.IGNORECASE)
            if unit_pts_match:
                count = int(unit_pts_match.group(1) or 1)
                uname = unit_pts_match.group(2).strip()
                if uname.lower().startswith(('enhancement', 'warlord', 'points', 'total')):
                    continue
                pts = int(unit_pts_match.group(3) or unit_pts_match.group(4) or 0)
                
                waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}
                
                current_unit = {
                    'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                    'name': uname,
                    'role': current_role or waha_ds.get('role', 'Infantry'),
                    'model_count': count,
                    'points': pts,
                    'is_warlord': False,
                    'enhancement': None,
                    'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                    'weapons': waha_ds.get('weapons', []),
                    'abilities': waha_ds.get('abilities', []),
                    'keywords': waha_ds.get('keywords', ['Infantry', faction])
                }
                parsed_units.append(current_unit)
                continue

            if current_unit:
                if 'warlord' in line.lower():
                    current_unit['is_warlord'] = True
                    warlord = current_unit['name']

        total_calculated_points = sum(u['points'] for u in parsed_units)
        if total_calculated_points > 0:
            points = total_calculated_points

        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': f'{faction} ({detachment})',
            'faction': faction,
            'detachment': detachment,
            'points': points,
            'points_limit': 2000,
            'warlord': warlord or (parsed_units[0]['name'] if parsed_units else ''),
            'source_format': 'Warhammer 40k App',
            'units': parsed_units,
            'enhancements': [u['enhancement'] for u in parsed_units if u['enhancement']],
            'stratagems': stratagems,
            'raw_text': text
        }

    def _parse_battlescribe_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        name = 'Battlescribe Roster'
        faction = 'Necrons'
        detachment = 'Canoptek Court'
        points = 2000
        warlord = ''

        fac_match = re.search(r'Army Roster\s*\(([^\)]+)\)\s*\[([\d\,]+)pts\]', text, re.IGNORECASE)
        if fac_match:
            raw_fac = fac_match.group(1)
            faction = raw_fac.split('-')[-1].strip() if '-' in raw_fac else raw_fac.strip()
            pts_str = fac_match.group(2).replace(',', '')
            try: points = int(pts_str)
            except: pass

        det_match = re.search(r'Detachment Choice:\s*([^,\n]+)', text, re.IGNORECASE)
        if det_match:
            detachment = det_match.group(1).strip()

        parsed_units = []
        current_role = 'Infantry'

        for line in lines:
            if line.startswith('+ ') and line.endswith(' +'):
                current_role = line.replace('+', '').strip()
                continue

            u_match = re.match(r'^(?:Char\d+:\s*)?(?:(\d+)x\s+)?([^:\[\]]+)\s*\[([\d\,]+)pts\](?::\s*(.*))?', line)
            if u_match:
                count = int(u_match.group(1) or 1)
                uname = u_match.group(2).strip()
                pts = int(u_match.group(3).replace(',', ''))
                wargear_str = u_match.group(4) or ''
                is_wl = 'warlord' in line.lower() or 'warlord' in wargear_str.lower()
                if is_wl:
                    warlord = uname

                waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}

                unit_obj = {
                    'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                    'name': uname,
                    'role': current_role or waha_ds.get('role', 'Infantry'),
                    'model_count': count,
                    'points': pts,
                    'is_warlord': is_wl,
                    'enhancement': None,
                    'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                    'weapons': waha_ds.get('weapons', []),
                    'abilities': waha_ds.get('abilities', []),
                    'keywords': waha_ds.get('keywords', ['Infantry', faction])
                }
                parsed_units.append(unit_obj)

        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': f'{faction} Roster',
            'faction': faction,
            'detachment': detachment,
            'points': points,
            'points_limit': 2000,
            'warlord': warlord or (parsed_units[0]['name'] if parsed_units else ''),
            'source_format': 'Battlescribe',
            'units': parsed_units,
            'enhancements': [],
            'stratagems': stratagems,
            'raw_text': text
        }

    def _parse_generic_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        faction = 'Necrons' if any('necron' in l.lower() for l in lines) else 'Warhammer 40,000'
        detachment = 'Standard Detachment'
        parsed_units = []
        warlord = ''

        unit_regex = re.compile(r'^(?:Char\d+:\s*)?(?:(\d+)x\s+)?([A-Za-z0-9\s\-\.\'\’]+?)\s*(?:[\(\[\:]\s*)?(\d{2,3})\s*(?:pts|points)[\)\]]?', re.IGNORECASE)

        for line in lines:
            m = unit_regex.match(line)
            if m:
                count = int(m.group(1) or 1)
                uname = m.group(2).strip()
                pts = int(m.group(3))
                if len(uname) > 2 and not uname.lower().startswith(('total', 'points', 'detachment', 'secondary')):
                    is_wl = 'warlord' in line.lower()
                    if is_wl: warlord = uname

                    waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}

                    parsed_units.append({
                        'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                        'name': uname,
                        'role': waha_ds.get('role', 'Infantry'),
                        'model_count': count,
                        'points': pts,
                        'is_warlord': is_wl,
                        'enhancement': None,
                        'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                        'weapons': waha_ds.get('weapons', []),
                        'abilities': waha_ds.get('abilities', []),
                        'keywords': waha_ds.get('keywords', ['Infantry', faction])
                    })

        total_pts = sum(u['points'] for u in parsed_units) or 2000
        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': f'{faction} Army List',
            'faction': faction,
            'detachment': detachment,
            'points': total_pts,
            'points_limit': 2000,
            'warlord': warlord,
            'source_format': 'Plain Text',
            'units': parsed_units,
            'enhancements': [],
            'stratagems': stratagems,
            'raw_text': text
        }

def get_parser() -> ArmyListParser:
    return ArmyListParser()

