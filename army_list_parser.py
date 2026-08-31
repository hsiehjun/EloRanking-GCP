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

        if content.startswith('{') and content.endswith('}'):
            try:
                data = json.loads(content)
                return self._parse_json_roster(data)
            except Exception as e:
                logger.debug('JSON parse fallback: %s', e)

        if '++ Army Roster' in content or '+ Epic Hero +' in content or '+ Character +' in content:
            return self._parse_battlescribe_text(content)
        elif 'CHARACTERS' in content or 'BATTLELINE' in content or 'OTHER DATASHEETS' in content:
            return self._parse_warhammer_app_text(content)
        elif 'newrecruit' in content.lower():
            return self._parse_newrecruit_text(content)
        else:
            return self._parse_generic_text(content)

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

    def _parse_warhammer_app_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        name = 'Warhammer App List'
        faction = 'Space Marines'
        detachment = 'Gladius Task Force'
        points = 2000
        warlord = ''

        if lines:
            header_line = lines[0]
            pts_match = re.search(r'\((\d+)\s*Points?\)', header_line, re.IGNORECASE)
            if pts_match:
                points = int(pts_match.group(1))
            parts = header_line.split('-')
            if len(parts) >= 2:
                faction = parts[0].strip()
                det_part = parts[1].split('(')[0].strip()
                if det_part:
                    detachment = det_part

        current_role = 'Infantry'
        parsed_units = []
        current_unit = None

        role_keywords = {'CHARACTERS': 'Character', 'BATTLELINE': 'Battleline', 'DEDICATED TRANSPORTS': 'Dedicated Transport', 'OTHER DATASHEETS': 'Other', 'ALLIED UNITS': 'Allied'}

        for idx, line in enumerate(lines):
            upper = line.upper()
            if upper in role_keywords:
                current_role = role_keywords[upper]
                continue

            # Skip header lines e.g. "Space Marines - Strike Force - Gladius (2000 pts)"
            if idx == 0 or "STRIKE FORCE" in upper or "INCURSION" in upper or "COMBAT PATROL" in upper or "DETACHMENT" in upper:
                if "GLADIUS" in upper: detachment = "Gladius Task Force"
                elif "CANOPTEK" in upper: detachment = "Canoptek Court"
                elif "WAR HORDE" in upper: detachment = "War Horde"
                elif "CHAMPIONS OF RUSS" in upper: detachment = "Champions of Russ"
                elif "RIGHTEOUS CRUSADE" in upper: detachment = "Righteous Crusade"
                elif "SHADOW DISCIPLES" in upper: detachment = "Shadow Disciples"
                elif "INVASION FLEET" in upper: detachment = "Invasion Fleet"
                continue

            # Check if line is an Enhancement sub-item for current unit
            enh_match = re.search(r'Enhancements?:\s*([^\(\)]+)(?:\s*\(\s*(\d+)\s*pts?\))?', line, re.IGNORECASE)
            if enh_match and current_unit:
                current_unit['enhancement'] = enh_match.group(1).strip()
                continue

            unit_pts_match = re.match(r'^(?:[•\*\-]\s*)?([^\(\)]+)\s*\((?:(\d+)\s*pts?|(\d+)\s*points?)\)', line, re.IGNORECASE)
            if unit_pts_match:
                uname = unit_pts_match.group(1).strip()
                if uname.lower().startswith(('enhancement', 'warlord', 'points', 'total')):
                    continue
                pts = int(unit_pts_match.group(2) or unit_pts_match.group(3) or 0)
                
                waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}
                
                current_unit = {
                    'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                    'name': uname,
                    'role': current_role or waha_ds.get('role', 'Infantry'),
                    'model_count': 1,
                    'points': pts,
                    'is_warlord': False,
                    'enhancement': None,
                    'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                    'weapons': waha_ds.get('weapons', []),
                    'abilities': waha_ds.get('abilities', []),
                    'keywords': waha_ds.get('keywords', ['Infantry'])
                }
                parsed_units.append(current_unit)
                continue

            if current_unit:
                if 'warlord' in line.lower():
                    current_unit['is_warlord'] = True
                    warlord = current_unit['name']
                models_match = re.search(r'(\d+)x\s+[^\:]+\:', line)
                if models_match:
                    current_unit['model_count'] += (int(models_match.group(1)) - 1)

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
            'warlord': warlord,
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

            u_match = re.match(r'^([^:\[\]]+)\s*\[([\d\,]+)pts\](?::\s*(.*))?', line)
            if u_match:
                uname = u_match.group(1).strip()
                pts = int(u_match.group(2).replace(',', ''))
                wargear_str = u_match.group(3) or ''
                is_wl = 'warlord' in line.lower() or 'warlord' in wargear_str.lower()
                if is_wl:
                    warlord = uname

                waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}

                unit_obj = {
                    'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                    'name': uname,
                    'role': current_role or waha_ds.get('role', 'Infantry'),
                    'model_count': 1,
                    'points': pts,
                    'is_warlord': is_wl,
                    'enhancement': None,
                    'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                    'weapons': waha_ds.get('weapons', []),
                    'abilities': waha_ds.get('abilities', []),
                    'keywords': waha_ds.get('keywords', ['Infantry'])
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
            'warlord': warlord,
            'source_format': 'Battlescribe',
            'units': parsed_units,
            'enhancements': [],
            'stratagems': stratagems,
            'raw_text': text
        }

    def _parse_newrecruit_text(self, text: str) -> Dict[str, Any]:
        return self._parse_warhammer_app_text(text)

    def _parse_generic_text(self, text: str) -> Dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        faction = 'Warhammer 40,000'
        detachment = 'Standard Detachment'
        parsed_units = []
        warlord = ''

        for line in lines:
            m = re.search(r"([A-Za-z0-9\s\-\.\'\’]+?)\s*(?:[\(\[\:]\s*)?(\d{2,3})\s*(?:pts|points)[\)\]]?", line, re.IGNORECASE)
            if m:
                uname = m.group(1).strip()
                pts = int(m.group(2))
                if len(uname) > 2 and not uname.lower().startswith(('total', 'points', 'detachment')):
                    is_wl = 'warlord' in line.lower()
                    if is_wl: warlord = uname

                    waha_ds = self.waha.lookup_unit(uname, faction=faction) or {}

                    parsed_units.append({
                        'id': f'u_{len(parsed_units)+1}_{uuid.uuid4().hex[:6]}',
                        'name': uname,
                        'role': waha_ds.get('role', 'Infantry'),
                        'model_count': 1,
                        'points': pts,
                        'is_warlord': is_wl,
                        'enhancement': None,
                        'stats': waha_ds.get('stats', {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}),
                        'weapons': waha_ds.get('weapons', []),
                        'abilities': waha_ds.get('abilities', []),
                        'keywords': waha_ds.get('keywords', ['Infantry'])
                    })

        total_pts = sum(u['points'] for u in parsed_units) or 2000
        stratagems = self.waha.get_stratagems_for_detachment(faction, detachment)

        return {
            'id': f'list_{uuid.uuid4().hex[:10]}',
            'name': 'Imported Army List',
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
