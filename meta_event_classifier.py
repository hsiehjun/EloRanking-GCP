"""Event classification and filter normalization for Meta Intel across all game systems.

Provides deterministic, platform-aware extraction for:
- Online vs. In-Person (`is_online`)
- Tournament vs. Multi-Week League (`is_league`)
- Event Structure (`singles`, `teams`, `doubles`, `ffa_pod`)
- Game Format (`format_tag` + human-readable label)
- Country, State/Province, and Macro-Region (`country_code`, `state_code`, `region_code`)
- Canonical `MetaFilterSpec` parsing and cache-key generation.
"""

from dataclasses import dataclass
from datetime import datetime
import json
import re
from typing import Any, Dict, Optional, Tuple


# ---------------------------------------------------------------------------
# Country, US/CA State, and Macro-Region Normalization
# ---------------------------------------------------------------------------

US_STATE_CODES = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
})

US_STATE_NAME_TO_CODE: Dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC", "puerto rico": "PR",
}

US_STATE_NAMES: Dict[str, str] = {
    code: ("District of Columbia" if code == "DC" else name.title())
    for name, code in US_STATE_NAME_TO_CODE.items()
}

CA_PROVINCE_TO_CODE: Dict[str, str] = {
    "ab": "AB", "alberta": "AB",
    "bc": "BC", "british columbia": "BC",
    "mb": "MB", "manitoba": "MB",
    "nb": "NB", "new brunswick": "NB",
    "nl": "NL", "newfoundland": "NL", "newfoundland and labrador": "NL",
    "ns": "NS", "nova scotia": "NS",
    "nt": "NT", "northwest territories": "NT",
    "nu": "NU", "nunavut": "NU",
    "on": "ON", "ontario": "ON",
    "pe": "PE", "pei": "PE", "prince edward island": "PE",
    "qc": "QC", "quebec": "QC", "québec": "QC",
    "sk": "SK", "saskatchewan": "SK",
    "yt": "YT", "yukon": "YT",
}

UK_NATIONS = frozenset({
    "england", "scotland", "wales", "northern ireland",
})

COUNTRY_ALIAS_TO_ISO2: Dict[str, str] = {
    "us": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US",
    "united states": "US", "united states of america": "US",
    "ca": "CA", "can": "CA", "canada": "CA",
    "mx": "MX", "mex": "MX", "mexico": "MX", "méxico": "MX",
    "gb": "GB", "uk": "GB", "u.k.": "GB", "great britain": "GB",
    "united kingdom": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "northern ireland": "GB",
    "ie": "IE", "irl": "IE", "ireland": "IE", "republic of ireland": "IE",
    "au": "AU", "aus": "AU", "australia": "AU",
    "nz": "NZ", "nzl": "NZ", "new zealand": "NZ",
    "de": "DE", "deu": "DE", "germany": "DE", "deutschland": "DE",
    "fr": "FR", "fra": "FR", "france": "FR",
    "es": "ES", "esp": "ES", "spain": "ES", "españa": "ES",
    "it": "IT", "ita": "IT", "italy": "IT", "italia": "IT",
    "pl": "PL", "pol": "PL", "poland": "PL", "polska": "PL",
    "nl": "NL", "nld": "NL", "netherlands": "NL", "the netherlands": "NL", "holland": "NL",
    "be": "BE", "bel": "BE", "belgium": "BE",
    "se": "SE", "swe": "SE", "sweden": "SE", "sverige": "SE",
    "no": "NO", "nor": "NO", "norway": "NO", "norge": "NO",
    "dk": "DK", "dnk": "DK", "denmark": "DK", "danmark": "DK",
    "fi": "FI", "fin": "FI", "finland": "FI", "suomi": "FI",
    "at": "AT", "aut": "AT", "austria": "AT", "österreich": "AT",
    "ch": "CH", "che": "CH", "switzerland": "CH", "schweiz": "CH",
    "pt": "PT", "prt": "PT", "portugal": "PT",
    "cz": "CZ", "cze": "CZ", "czech republic": "CZ", "czechia": "CZ",
    "sk": "SK", "svk": "SK", "slovakia": "SK",
    "hu": "HU", "hun": "HU", "hungary": "HU",
    "ro": "RO", "rou": "RO", "romania": "RO",
    "bg": "BG", "bgr": "BG", "bulgaria": "BG",
    "gr": "GR", "grc": "GR", "greece": "GR",
    "hr": "HR", "hrv": "HR", "croatia": "HR",
    "si": "SI", "svn": "SI", "slovenia": "SI",
    "ee": "EE", "est": "EE", "estonia": "EE",
    "lv": "LV", "lva": "LV", "latvia": "LV",
    "lt": "LT", "ltu": "LT", "lithuania": "LT",
    "lu": "LU", "lux": "LU", "luxembourg": "LU",
    "is": "IS", "isl": "IS", "iceland": "IS",
    "ua": "UA", "ukr": "UA", "ukraine": "UA",
    "rs": "RS", "srb": "RS", "serbia": "RS",
    "ru": "RU", "rus": "RU", "russia": "RU",
    "jp": "JP", "jpn": "JP", "japan": "JP",
    "kr": "KR", "kor": "KR", "south korea": "KR", "korea": "KR",
    "cn": "CN", "chn": "CN", "china": "CN",
    "tw": "TW", "twn": "TW", "taiwan": "TW",
    "hk": "HK", "hkg": "HK", "hong kong": "HK",
    "sg": "SG", "sgp": "SG", "singapore": "SG",
    "my": "MY", "mys": "MY", "malaysia": "MY",
    "ph": "PH", "phl": "PH", "philippines": "PH",
    "th": "TH", "tha": "TH", "thailand": "TH",
    "id": "ID", "idn": "ID", "indonesia": "ID",
    "vn": "VN", "vnm": "VN", "vietnam": "VN",
    "in": "IN", "ind": "IN", "india": "IN",
    "br": "BR", "bra": "BR", "brazil": "BR", "brasil": "BR",
    "ar": "AR", "arg": "AR", "argentina": "AR",
    "cl": "CL", "chl": "CL", "chile": "CL",
    "co": "CO", "col": "CO", "colombia": "CO",
    "pe": "PE", "per": "PE", "peru": "PE",
    "cr": "CR", "cri": "CR", "costa rica": "CR",
    "uy": "UY", "ury": "UY", "uruguay": "UY",
    "za": "ZA", "zaf": "ZA", "south africa": "ZA",
    "il": "IL", "isr": "IL", "israel": "IL",
    "ae": "AE", "are": "AE", "united arab emirates": "AE", "uae": "AE",
    "tr": "TR", "tur": "TR", "turkey": "TR", "türkiye": "TR",
}

COUNTRY_DISPLAY_NAMES: Dict[str, str] = {
    "US": "United States",
    "GB": "United Kingdom",
    "CA": "Canada",
    "AU": "Australia",
    "DE": "Germany",
    "FR": "France",
    "ES": "Spain",
    "PL": "Poland",
    "IT": "Italy",
    "SE": "Sweden",
    "NL": "Netherlands",
    "DK": "Denmark",
    "NO": "Norway",
    "FI": "Finland",
    "BE": "Belgium",
    "NZ": "New Zealand",
    "IE": "Ireland",
    "AT": "Austria",
    "CH": "Switzerland",
    "PT": "Portugal",
    "CZ": "Czechia",
    "JP": "Japan",
    "SG": "Singapore",
    "KR": "South Korea",
    "CN": "China",
    "HK": "Hong Kong",
    "TW": "Taiwan",
    "PH": "Philippines",
    "MY": "Malaysia",
    "TH": "Thailand",
    "MX": "Mexico",
    "BR": "Brazil",
    "AR": "Argentina",
    "CL": "Chile",
    "CO": "Colombia",
    "ZA": "South Africa",
    "HU": "Hungary",
    "RO": "Romania",
    "GR": "Greece",
    "UA": "Ukraine",
}

REGION_DISPLAY_NAMES: Dict[str, str] = {
    "NA": "North America",
    "UK_IE": "UK & Ireland",
    "EU": "Continental Europe",
    "OCE": "Oceania",
    "ASIA": "Asia",
    "LATAM": "Latin America",
    "OTHER": "Rest of World",
}

ISO2_TO_REGION: Dict[str, str] = {
    "US": "NA", "CA": "NA",
    "GB": "UK_IE", "IE": "UK_IE",
    "AU": "OCE", "NZ": "OCE",
    "DE": "EU", "FR": "EU", "ES": "EU", "IT": "EU", "PL": "EU", "NL": "EU",
    "BE": "EU", "SE": "EU", "NO": "EU", "DK": "EU", "FI": "EU", "AT": "EU",
    "CH": "EU", "PT": "EU", "CZ": "EU", "SK": "EU", "HU": "EU", "RO": "EU",
    "BG": "EU", "GR": "EU", "HR": "EU", "SI": "EU", "EE": "EU", "LV": "EU",
    "LT": "EU", "LU": "EU", "IS": "EU", "UA": "EU", "RS": "EU",
    "JP": "ASIA", "KR": "ASIA", "CN": "ASIA", "TW": "ASIA", "HK": "ASIA",
    "SG": "ASIA", "MY": "ASIA", "PH": "ASIA", "TH": "ASIA", "ID": "ASIA",
    "VN": "ASIA", "IN": "ASIA",
    "MX": "LATAM", "BR": "LATAM", "AR": "LATAM", "CL": "LATAM", "CO": "LATAM",
    "PE": "LATAM", "CR": "LATAM", "UY": "LATAM",
}

FORMAT_DISPLAY_NAMES: Dict[str, str] = {
    "standard_2000": "Standard (2000pt)",
    "incursion_1000": "Small Points / Incursion",
    "standard": "Standard",
    "modern": "Modern",
    "legacy": "Legacy",
    "pioneer": "Pioneer",
    "pauper": "Pauper",
    "vintage": "Vintage",
    "commander": "Commander / cEDH",
    "duel_commander": "Duel Commander (1v1)",
    "limited": "Limited (Draft / Sealed)",
    "expanded": "Expanded",
    "glc": "Gym Leader Challenge",
    "retro": "Retro / Historical",
    "premier": "Premier",
    "twin_suns": "Twin Suns",
    "classic_constructed": "Classic Constructed",
    "blitz": "Blitz",
    "living_legend": "Living Legend",
    "core_constructed": "Core (Constructed)",
    "highlander": "Highlander / Premodern",
}

FORMAT_DISPLAY_LABELS = FORMAT_DISPLAY_NAMES

_ONLINE_WORD_RE = re.compile(
    r"\b(tts|tabletop\s+simulator|wartable|vassal|cockatrice|untap|octgn|mtgo|mtg\s+arena|ptcg\s+live|optcg\s+sim|spelltable|webcam)\b",
    re.IGNORECASE,
)
_TEAM_SIZE_WORD_RE = re.compile(
    r"\b(5v5|8v8|4v4|3v3|6v6|wtc\s+team|atc\s+team|team\s+tournament|team\s+gt)\b",
    re.IGNORECASE,
)
_DOUBLES_WORD_RE = re.compile(
    r"\b(2v2|doubles|two[- ]headed\s+giant|2hg|duos)\b",
    re.IGNORECASE,
)
_SMALL_PTS_RE = re.compile(
    r"\b(combat\s+patrol|spearhead|boarding\s+actions|1000\s*pts?|1000\s*points|1k\s+rtt|1k\s+tournament|incursion|500\s*pts?|750\s*pts?|1250\s*pts?|escalation|crusade)\b",
    re.IGNORECASE,
)


def _as_dict(raw_json: Any) -> Dict[str, Any]:
    if isinstance(raw_json, dict):
        return raw_json
    if isinstance(raw_json, str) and raw_json.strip():
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def classify_is_online(
    city: Optional[str] = None,
    country: Optional[str] = None,
    venue_name: Optional[str] = None,
    name: Optional[str] = None,
    address: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    raw_json: Any = None,
    source_platform: Optional[str] = None,
    event_id: Optional[str] = None,
) -> bool:
    """Determines whether an event was held online/digitally vs. in-person."""
    rj = _as_dict(raw_json)

    # 1. Explicit native booleans / platform_type fields (note: BCP `showOnline` is UI visibility, NOT online venue!)
    if rj.get("isOnlineEvent") is True or rj.get("onlineEvent") is True or rj.get("is_online") is True:
        return True
    plat_type = str(rj.get("platform_type") or "").strip().lower()
    if plat_type in ("online", "mtgo", "mtg arena", "digital", "discord", "webcam", "ptcg live"):
        return True
    if plat_type in ("in-person", "in person", "paper", "tabletop"):
        return False

    city_l = str(city or "").strip().lower()
    country_l = str(country or "").strip().lower()
    addr_s = str(address or "").strip()
    addr_l = addr_s.lower()
    if (
        city_l in ("online", "discord", "tts", "webcam", "spelltable", "virtual")
        or country_l == "global"
        or addr_l in ("online", "discord", "tts", "webcam", "spelltable", "virtual")
    ):
        return True

    # 2. Check whether real physical coordinates or a real street address exist (ignoring (0, 0) Null Island)
    has_valid_coords = False
    if latitude is not None:
        try:
            lat_f = float(latitude)
            lng_f = float(longitude) if longitude is not None else None
            if abs(lat_f) > 0.01 or (lng_f is not None and abs(lng_f) > 0.01):
                has_valid_coords = True
        except (TypeError, ValueError):
            has_valid_coords = False

    has_real_addr = bool(addr_s and addr_l not in ("n/a", "none", "tbd", "unknown"))
    has_physical_loc = has_valid_coords or has_real_addr

    # 3. Title / Venue checks: explicit digital simulator keywords win unless a real street address overrides casual mention
    text_blob = f"{name or ''} {venue_name or ''}"
    if _ONLINE_WORD_RE.search(text_blob) and not has_real_addr:
        return True

    if not has_physical_loc and re.search(r"\b(online|discord|virtual)\b", text_blob, re.IGNORECASE):
        return True

    return False


def normalize_country_and_region(
    country: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    address: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    raw_json: Any = None,
    is_online: bool = False,
) -> Tuple[Optional[str], Optional[str], str]:
    """Returns `(country_code, state_code, region_code)` normalized to ISO-2 and macro-regions."""
    if is_online:
        return None, None, "ONLINE"

    rj = _as_dict(raw_json)
    raw_country = str(country or rj.get("country") or "").strip()
    raw_state = str(state or rj.get("state") or "").strip()
    raw_city = str(city or rj.get("city") or "").strip()
    raw_addr = str(address or rj.get("formatted_address") or rj.get("formattedAddress") or "").strip()
    tz_str = str(rj.get("timeZone") or rj.get("timezone") or "").strip()

    cc: Optional[str] = None
    sc: Optional[str] = None

    if raw_country:
        c_low = raw_country.lower().strip(".")
        if c_low != "global":
            cc = COUNTRY_ALIAS_TO_ISO2.get(c_low)
            if not cc and len(raw_country) == 2 and raw_country.isalpha():
                cc = raw_country.upper()

    # Check Longshanks-style "Washington, United States" or "Ontario, Canada" in `city` or `formatted_address`
    if not cc:
        for loc_txt in (raw_city, raw_addr):
            if "," in loc_txt:
                parts = [p.strip() for p in loc_txt.split(",") if p.strip()]
                if parts:
                    tail_low = parts[-1].lower().strip(".")
                    cc = COUNTRY_ALIAS_TO_ISO2.get(tail_low)
                    if cc:
                        if len(parts) >= 2 and not raw_state:
                            raw_state = parts[-2]
                        break

    # Normalize State / Province and infer US / CA / GB when country was omitted
    if raw_state:
        st_clean = raw_state.strip()
        st_up = st_clean.upper()
        st_low = st_clean.lower()
        if st_low in UK_NATIONS:
            cc = cc or "GB"
            sc = st_clean.title()
        elif (cc in (None, "US")) and (st_up in US_STATE_CODES or st_low in US_STATE_NAME_TO_CODE):
            sc = st_up if st_up in US_STATE_CODES else US_STATE_NAME_TO_CODE[st_low]
            cc = cc or "US"
        elif (cc in (None, "CA")) and st_low in CA_PROVINCE_TO_CODE:
            sc = CA_PROVINCE_TO_CODE[st_low]
            cc = cc or "CA"
        elif len(st_clean) <= 24:
            sc = st_up if len(st_clean) <= 3 else st_clean[:24]

    # Infer US state from Longshanks city="California, United States" when raw_state came from parts[0]
    if cc == "US" and not sc and raw_city:
        first_part = raw_city.split(",")[0].strip().lower()
        if first_part in US_STATE_NAME_TO_CODE:
            sc = US_STATE_NAME_TO_CODE[first_part]

    # Coordinate bounding-box fallback when country is still missing
    if not cc and latitude is not None and longitude is not None:
        try:
            lat_f = float(latitude)
            lng_f = float(longitude)
            if 24.0 <= lat_f <= 49.5 and -125.0 <= lng_f <= -66.5:
                cc = "US"
            elif 49.5 < lat_f <= 72.0 and -141.0 <= lng_f <= -52.0:
                cc = "CA"
            elif 49.8 <= lat_f <= 60.9 and -8.6 <= lng_f <= 1.8:
                cc = "GB"
            elif -44.5 <= lat_f <= -10.0 and 112.0 <= lng_f <= 154.5:
                cc = "AU"
            elif -47.5 <= lat_f <= -34.0 and 166.0 <= lng_f <= 179.0:
                cc = "NZ"
        except (TypeError, ValueError):
            pass

    # Timezone fallback for region (and GB/AU/JP country when unambiguous)
    region = ISO2_TO_REGION.get(cc, "") if cc else ""
    if not region and tz_str:
        tz_l = tz_str.lower()
        if tz_l in ("europe/london", "europe/belfast"):
            cc = cc or "GB"
            region = "UK_IE"
        elif tz_l == "europe/dublin":
            cc = cc or "IE"
            region = "UK_IE"
        elif tz_l.startswith("europe/"):
            region = "EU"
        elif tz_l.startswith("australia/"):
            cc = cc or "AU"
            region = "OCE"
        elif tz_l == "pacific/auckland":
            cc = cc or "NZ"
            region = "OCE"
        elif tz_l.startswith("america/"):
            if any(k in tz_l for k in ("sao_paulo", "buenos_aires", "santiago", "bogota", "lima", "mexico")):
                region = "LATAM"
            else:
                region = "NA"
        elif tz_l.startswith("asia/"):
            if "tokyo" in tz_l:
                cc = cc or "JP"
            region = "ASIA"

    if not region:
        region = "OTHER" if cc else "UNKNOWN"

    return cc, sc, region


def _normalize_format_slug(raw_fmt: str, game_system: str, structure_tag: str, points_val: int, title: str) -> str:
    sys_l = (game_system or "40k").strip().lower()
    f_low = (raw_fmt or "").strip().lower()
    t_low = (title or "").strip().lower()

    # Wargames (40k, AoS, etc.) never use TCG 'commander' format slug
    if sys_l in ("40k", "aos", "the_old_world", "horus_heresy", "kings_of_war", "conquest", "bolt_action"):
        if points_val >= 1750:
            return "standard_2000"
        if (250 <= points_val <= 1500) or _SMALL_PTS_RE.search(t_low):
            return "incursion_1000"
        return "standard_2000"

    if structure_tag == "ffa_pod":
        return "commander"

    if not f_low and t_low:
        for kw, slug in (
            ("modern", "modern"),
            ("legacy", "legacy"),
            ("pioneer", "pioneer"),
            ("pauper", "pauper"),
            ("vintage", "vintage"),
            ("cedh", "commander"),
            ("commander", "commander"),
            ("draft", "limited"),
            ("sealed", "limited"),
            ("prerelease", "limited"),
            ("expanded", "expanded"),
            ("glc", "glc"),
            ("classic constructed", "classic_constructed"),
            ("blitz", "blitz"),
            ("twin suns", "twin_suns"),
        ):
            if re.search(rf"\b{re.escape(kw)}\b", t_low):
                return slug

    if any(k in f_low for k in ("draft", "sealed", "limited", "prerelease", "booster")):
        return "limited"
    if "duel commander" in f_low or "1v1 commander" in f_low or "centurion" in f_low:
        return "duel_commander"
    if any(k in f_low for k in ("commander", "cedh", "edh", "multiplayer")):
        return "commander"
    if "modern" in f_low and "premodern" not in f_low:
        return "modern"
    if "legacy" in f_low:
        return "legacy"
    if "pioneer" in f_low:
        return "pioneer"
    if "pauper" in f_low:
        return "pauper"
    if "vintage" in f_low:
        return "vintage"
    if "highlander" in f_low or "premodern" in f_low or "canlander" in f_low:
        return "highlander"
    if "expanded" in f_low:
        return "expanded"
    if "glc" in f_low or "gym leader" in f_low:
        return "glc"
    if any(k in f_low for k in ("retro", "rs-pk", "dp-", "bw-", "xy-", "sm-", "adv", "base-")):
        return "retro"
    if "classic constructed" in f_low or f_low == "cc":
        return "classic_constructed"
    if "blitz" in f_low:
        return "blitz"
    if "living legend" in f_low:
        return "living_legend"
    if "twin suns" in f_low:
        return "twin_suns"
    if "premier" in f_low:
        return "premier"
    if "core" in f_low:
        return "core_constructed"
    if "standard" in f_low or not f_low:
        if sys_l == "sw_unlimited":
            return "premier"
        if sys_l == "lorcana":
            return "core_constructed"
        if sys_l == "flesh_blood":
            return "classic_constructed"
        return "standard"

    clean = re.sub(r"[^a-z0-9]+", "_", f_low).strip("_")[:32]
    return clean or "standard"


def classify_event_structure_and_format(
    event_id: Optional[str] = None,
    name: Optional[str] = None,
    event_date: Any = None,
    end_date: Any = None,
    event_type: Optional[str] = None,
    team_size: Optional[int] = None,
    points: Optional[int] = None,
    game_system: Optional[str] = "40k",
    raw_json: Any = None,
    has_ffa_matches: bool = False,
    has_doubles_matches: bool = False,
    has_team_pods: bool = False,
    match_span_days: int = 0,
) -> Tuple[str, str, bool]:
    """Returns `(structure_tag, format_tag, is_league)`."""
    rj = _as_dict(raw_json)
    eid_s = str(event_id or "").strip().lower()
    title = str(name or rj.get("name") or rj.get("title") or "").strip()
    ev_type_l = str(event_type or "").strip().lower()
    t_size = int(team_size or 1)

    # 1. League detection (native BCP boolean, league_ ID prefix, or >5 day span)
    is_league = bool(
        rj.get("leagueEvent") is True
        or eid_s.startswith("league_")
        or int(match_span_days or 0) > 5
    )
    if not is_league and event_date and end_date:
        try:
            d1 = datetime.fromisoformat(str(event_date)[:10])
            d2 = datetime.fromisoformat(str(end_date)[:10])
            if (d2 - d1).days > 5:
                is_league = True
        except Exception:
            pass

    # 2. Structure tag (`ffa_pod`, `doubles`, `teams`, `singles`)
    pods_count = int(rj.get("pods_count") or 0)
    if has_ffa_matches or (eid_s.startswith("td:") and pods_count > 0 and "commander" in title.lower()):
        structure_tag = "ffa_pod"
    elif (
        rj.get("doublesEvent") is True
        or ev_type_l == "doubles"
        or t_size == 2
        or has_doubles_matches
        or bool(_DOUBLES_WORD_RE.search(title))
    ):
        structure_tag = "doubles"
    elif (
        rj.get("teamEvent") is True
        or ev_type_l in ("teams", "team")
        or t_size >= 3
        or has_team_pods
        or bool(_TEAM_SIZE_WORD_RE.search(title))
    ):
        structure_tag = "teams"
    else:
        structure_tag = "singles"

    # 3. Format tag (platform structured format or wargame points tier)
    raw_fmt = str(
        rj.get("format_name")
        or rj.get("format")
        or ((rj.get("details") or {}).get("format") if isinstance(rj.get("details"), dict) else "")
    ).strip()
    if not raw_fmt and isinstance(rj.get("summary"), dict):
        raw_fmt = str(rj["summary"].get("format") or "").strip()

    pts_val = 0
    for cand in (rj.get("pointsValue"), points):
        try:
            v = int(cand or 0)
            if v > 0:
                pts_val = v
                break
        except (TypeError, ValueError):
            pass
    # Note: schema default `points = 2000` on events table only overrides if raw_json had explicit pointsValue
    raw_bcp_pts = 0
    try:
        raw_bcp_pts = int(rj.get("pointsValue") or 0)
    except (TypeError, ValueError):
        raw_bcp_pts = 0
    eff_pts = raw_bcp_pts if raw_bcp_pts > 0 else (pts_val if pts_val != 2000 else 0)

    format_tag = _normalize_format_slug(raw_fmt, str(game_system or "40k"), structure_tag, eff_pts, title)
    return structure_tag, format_tag, is_league


# ---------------------------------------------------------------------------
# Canonical Filter Specification (`MetaFilterSpec`)
# ---------------------------------------------------------------------------

VALID_VENUE_MODES = frozenset({"all", "in_person", "online"})
VALID_STRUCTURES = frozenset({"all", "singles", "teams", "doubles", "ffa_pod"})
VALID_REGIONS = frozenset({"all", "NA", "UK_IE", "EU", "OCE", "ASIA", "LATAM", "OTHER"})


@dataclass(frozen=True)
class MetaFilterSpec:
    min_players: int = 0
    max_players: int = 0
    min_rounds: int = 0
    venue_mode: str = "all"
    event_structure: str = "all"
    event_format: str = "all"
    exclude_leagues: bool = False
    region: str = "all"
    country: str = "all"
    state: str = "all"
    elo_floor: int = 0

    def is_default(self) -> bool:
        return (
            self.min_players <= 0
            and self.max_players <= 0
            and self.min_rounds <= 0
            and self.venue_mode == "all"
            and self.event_structure == "all"
            and self.event_format == "all"
            and not self.exclude_leagues
            and self.region == "all"
            and self.country == "all"
            and self.state == "all"
            and self.elo_floor <= 0
        )

    def has_event_filters(self) -> bool:
        return (
            self.min_players > 0
            or self.max_players > 0
            or self.min_rounds > 0
            or self.venue_mode != "all"
            or self.event_structure != "all"
            or self.event_format != "all"
            or self.exclude_leagues
            or self.region != "all"
            or self.country != "all"
            or self.state != "all"
        )

    def cache_suffix(self) -> str:
        if self.is_default():
            return ""
        parts = []
        if self.min_players > 0:
            parts.append(f"mp{self.min_players}")
        if self.max_players > 0:
            parts.append(f"xp{self.max_players}")
        if self.min_rounds > 0:
            parts.append(f"mr{self.min_rounds}")
        if self.venue_mode != "all":
            parts.append(f"vm_{self.venue_mode}")
        if self.event_structure != "all":
            parts.append(f"es_{self.event_structure}")
        if self.event_format != "all":
            parts.append(f"ef_{self.event_format}")
        if self.exclude_leagues:
            parts.append("xlg1")
        if self.region != "all":
            parts.append(f"rg_{self.region}")
        if self.country != "all":
            parts.append(f"cc_{self.country}")
        if self.state != "all":
            parts.append(f"st_{self.state}")
        if self.elo_floor > 0:
            parts.append(f"elo{self.elo_floor}")
        return "__" + "_".join(parts)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "min_players": self.min_players,
            "max_players": self.max_players,
            "min_rounds": self.min_rounds,
            "venue_mode": self.venue_mode,
            "event_structure": self.event_structure,
            "event_format": self.event_format,
            "exclude_leagues": self.exclude_leagues,
            "region": self.region,
            "country": self.country,
            "state": self.state,
            "elo_floor": self.elo_floor,
            "is_filtered": not self.is_default(),
        }


def parse_meta_filters(
    min_players: Any = 0,
    max_players: Any = 0,
    min_rounds: Any = 0,
    venue_mode: Optional[str] = None,
    event_structure: Optional[str] = None,
    event_format: Optional[str] = None,
    exclude_leagues: Any = False,
    region: Optional[str] = None,
    country: Optional[str] = None,
    state: Optional[str] = None,
    elo_floor: Any = 0,
) -> MetaFilterSpec:
    """Normalizes raw HTTP/Python filter inputs into a safe `MetaFilterSpec`."""
    try:
        mp = max(0, min(5000, int(min_players or 0)))
    except (TypeError, ValueError):
        mp = 0
    try:
        xp = max(0, min(50000, int(max_players or 0)))
    except (TypeError, ValueError):
        xp = 0
    try:
        mr = max(0, min(30, int(min_rounds or 0)))
    except (TypeError, ValueError):
        mr = 0

    vm = str(venue_mode or "all").strip().lower().replace("-", "_")
    if vm in ("irl", "tabletop", "offline", "physical"):
        vm = "in_person"
    if vm not in VALID_VENUE_MODES:
        vm = "all"

    es = str(event_structure or "all").strip().lower().replace("-", "_")
    if es == "team":
        es = "teams"
    elif es in ("double", "2v2"):
        es = "doubles"
    elif es in ("pod", "pods", "ffa"):
        es = "ffa_pod"
    elif es == "single":
        es = "singles"
    if es not in VALID_STRUCTURES:
        es = "all"

    ef_raw = str(event_format or "all").strip().lower()
    ef = re.sub(r"[^a-z0-9_]+", "_", ef_raw).strip("_")[:32] if ef_raw and ef_raw != "all" else "all"
    if not ef:
        ef = "all"

    if isinstance(exclude_leagues, bool):
        xlg = exclude_leagues
    else:
        xlg = str(exclude_leagues or "").strip().lower() in ("1", "true", "yes", "on")

    rg_raw = str(region or "all").strip()
    rg_up = rg_raw.upper().replace("-", "_")
    if rg_raw.lower() in ("all", "global", ""):
        rg = "all"
    elif rg_up in VALID_REGIONS:
        rg = rg_up
    else:
        rg = "all"

    cc_raw = str(country or "all").strip()
    if cc_raw.lower() in ("all", "global", ""):
        cc = "all"
    else:
        cc = COUNTRY_ALIAS_TO_ISO2.get(cc_raw.lower()) or (cc_raw.upper() if len(cc_raw) == 2 and cc_raw.isalpha() else "all")

    st_raw = str(state or "all").strip()
    if st_raw.lower() in ("all", ""):
        st = "all"
    else:
        st_up = st_raw.upper()
        st = st_up if st_up in US_STATE_CODES else US_STATE_NAME_TO_CODE.get(st_raw.lower(), re.sub(r"[^A-Za-z0-9 ]+", "", st_raw)[:24] or "all")

    try:
        ef_elo = int(elo_floor or 0)
    except (TypeError, ValueError):
        ef_elo = 0
    if ef_elo >= 1650:
        ef_elo = 1650
    elif ef_elo >= 1550:
        ef_elo = 1550
    else:
        ef_elo = 0

    return MetaFilterSpec(
        min_players=mp,
        max_players=xp,
        min_rounds=mr,
        venue_mode=vm,
        event_structure=es,
        event_format=ef,
        exclude_leagues=xlg,
        region=rg,
        country=cc,
        state=st,
        elo_floor=ef_elo,
    )
