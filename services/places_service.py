"""Service for Google Places API text search, store validation, and venue discovery."""
import os
import json
import math
import time
import re
import urllib.request
import urllib.parse
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("PlacesService")


class PlacesService:
    """Encapsulates venue discovery, Google Places TextSearch, and store validation heuristics."""

    @classmethod
    def is_valid_game_store_name(
        cls,
        name: str,
        types: Optional[List[str]] = None,
        is_from_google_places: bool = False
    ) -> bool:
        """
        Validates whether a venue corresponds to a legitimate local game/hobby store
        rather than a hotel, convention hall, brewery, private residence, tournament title, or junk test event.
        """
        if not name or len(name.strip()) < 3:
            return False

        name_clean = name.strip()
        norm = name_clean.lower().replace("'", "").replace('"', '').strip()

        # 1. Obvious junk / test strings / virtual platforms / private residences
        JUNK_EXACT = {
            "asdf", "test", "testing", "tbd", "na", "n/a", "none", "null", "undefined",
            "unknown", "online", "discord", "tabletop simulator", "tts", "vassal",
            "home", "house", "garage", "basement", "private", "my house", "my home",
            "somewhere", "anywhere", "tba", "zoom", "google meet", "room"
        }
        if norm in JUNK_EXACT:
            return False

        # Single word without store keywords (e.g. personal names like "Luis", "Dave", "John")
        words = [w for w in norm.split() if w]
        if len(words) == 1 and len(norm) <= 7:
            if not any(k in norm for k in ("game", "hobby", "comic", "cards", "dice", "gunnzo")):
                return False

        # 2. Google Places specific type check
        if types:
            excluded_types = {"lodging", "hotel", "campground", "tourist_attraction", "airport", "movie_theater"}
            if any(t in excluded_types for t in types):
                return False

        # 3. Excluded non-store venue categories (Hotels, Fairgrounds, Convention Centers, Breweries, etc.)
        NON_STORE_PATTERNS = (
            r"\b("
            r"hotel|motel|resort|suites|inn\b|lodge|banquet|ballroom|fairground|fairgrounds|"
            r"convention\s*center|conference\s*center|expo\s*center|civic\s*center|events?\s*center|"
            r"coliseum|arena|pavilion|hall\b|"
            r"brewing|brewery|brewhouse|beer|winery|vineyard|saloon|bar\s*&\s*grill|bar\s*and\s*grill|"
            r"tavern|pub\b|pizzeria|pizza|restaurant|bistro|cantina|"
            r"park|recreation\s*center|rec\s*center|church|temple|chapel|community\s*center|"
            r"elementary|high\s*school|middle\s*school|university|college|campus"
            r")\b"
        )
        SPECIFIC_NON_STORES = {
            "del mar fairgrounds", "town and country san diego", "town and country",
            "handlery hotel", "handlery hotel: garden space", "crowne plaza", "crowne plaza san diego",
            "alesmith", "alesmith brewing", "alesmith brewing company", "stone brewing", "ballast point"
        }

        if any(bad in norm for bad in SPECIFIC_NON_STORES):
            return False

        if re.search(NON_STORE_PATTERNS, norm, re.IGNORECASE):
            # Exception only if explicitly marked as a board game / tabletop cafe
            if not any(good in norm for good in ("board game", "boardgame", "tabletop cafe", "game cafe", "gaming cafe")):
                return False

        # 4. Tournament / Event title in place of venue name (e.g. "Warhammer League 12", "San Diego GT")
        EVENT_TITLES_PATTERN = (
            r"\b("
            r"tournament|grand\s*tournament|\bgt\b|\brtt\b|championship|invitational|"
            r"qualifier|\bleague\b|\bcup\b"
            r")\b"
        )
        if re.search(EVENT_TITLES_PATTERN, norm, re.IGNORECASE):
            if not any(good in norm for good in ("store", "shop", "hobbies", "hobby", "games", "gaming")):
                return False

        # If from Google Places, we already know it was returned for a game store query
        if is_from_google_places:
            return True

        # 5. For database tournament venues: require explicit store/hobby keywords or known store whitelist
        STORE_KEYWORDS = (
            r"\b("
            r"game|games|gaming|hobby|hobbies|tabletop|comic|comics|card|cards|"
            r"collectible|collectibles|warhammer|games\s*workshop|miniature|miniatures|"
            r"dice|wargame|wargames|wargaming|boardgame|boardgames|tcg"
            r")\b"
        )
        KNOWN_STORES = {
            "tc rockets", "tcs rockets", "tc's rockets", "gunnzo", "pair a dice",
            "off the shelf", "crazy squirrel", "bards & cards", "bards and cards",
            "at ease", "game empire", "warp rider", "villainous lair", "so cal games",
            "socal games", "brookhurst"
        }

        if any(known in norm for known in KNOWN_STORES):
            return True

        if re.search(STORE_KEYWORDS, norm, re.IGNORECASE):
            return True

        return False

    @classmethod
    def get_local_game_stores(
        cls,
        db: Any,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        radius_miles: float = 50.0,
        query: Optional[str] = None,
        location_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Discovers local game stores and clubs for Warhammer within a specified radius:
        1. Queries Google Places TextSearch API (if Google Maps API key is configured).
        2. Queries verified Warhammer tournament venues from the PostgreSQL events database.
        3. Merges, enriches with tournament hosting history, calculates distances, and sorts by proximity.
        """
        try:
            radius_miles = float(radius_miles or 50.0)
        except (ValueError, TypeError):
            radius_miles = 50.0
        radius_miles = max(5.0, min(radius_miles, 250.0))

        user_lat = None
        user_lng = None
        if lat is not None and lng is not None:
            try:
                user_lat = float(lat)
                user_lng = float(lng)
            except (ValueError, TypeError):
                user_lat = None
                user_lng = None

        # If user_lat and user_lng are provided, NEVER overwrite them.
        # Only resolve coordinates from location_name if coordinates were not provided.
        if user_lat is None or user_lng is None:
            if location_name:
                matched_hub = db.resolve_community_hub(location_name) if hasattr(db, "resolve_community_hub") else None
                if matched_hub:
                    user_lat, user_lng, hub_name = matched_hub
                    if not location_name:
                        location_name = hub_name

        if user_lat is None or user_lng is None:
            user_lat = 32.7157
            user_lng = -117.1611
            if not location_name:
                location_name = "San Diego, CA"
        elif not location_name or location_name.strip().lower() in ["my location", "your location", "current location", "local tabletop"] or location_name.strip().lower().startswith("gps ("):
            geo = db.reverse_geocode_coordinates(user_lat, user_lng)
            location_name = geo.get("formatted") or f"{user_lat:.2f}, {user_lng:.2f}"

        clean_query = (query or "").strip()
        cache_key = (
            "v3",
            round(user_lat, 2),
            round(user_lng, 2),
            int(round(radius_miles)),
            clean_query.lower()
        )
        cached = db.get_cached(db._stores_cache_dict, cache_key, ttl=1800)
        if cached is not None:
            return cached

        stores = []
        seen_names = set()
        seen_place_ids = set()

        # 1. Query Google Places API if key is available
        google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
        if not google_maps_key:
            try:
                from config import GOOGLE_MAPS_API_KEY
                google_maps_key = GOOGLE_MAPS_API_KEY
            except Exception:
                pass

        if google_maps_key:
            search_text = f"{clean_query} game store" if clean_query else "Warhammer 40k game store"
            params = {
                "query": search_text,
                "location": f"{user_lat},{user_lng}",
                "radius": int(min(50000, radius_miles * 1609.34)),
                "key": google_maps_key
            }
            url = f"https://maps.googleapis.com/maps/api/place/textsearch/json?{urllib.parse.urlencode(params)}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "EloRanking/1.0", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=3.5) as resp:
                    p_data = json.loads(resp.read().decode("utf-8"))
                    results = p_data.get("results", [])
                    for place in results:
                        status = place.get("business_status", "OPERATIONAL")
                        if status == "CLOSED_PERMANENTLY":
                            continue
                        pid = place.get("place_id") or ""
                        p_name = place.get("name", "Game Store").strip()
                        types = place.get("types") or []
                        if not cls.is_valid_game_store_name(p_name, types=types, is_from_google_places=True):
                            continue
                        geom = place.get("geometry", {}).get("location", {})
                        p_lat = geom.get("lat")
                        p_lng = geom.get("lng")
                        if p_lat is None or p_lng is None:
                            continue

                        # Haversine distance
                        R = 3959.0
                        dlat = math.radians(p_lat - user_lat)
                        dlng = math.radians(p_lng - user_lng)
                        a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(p_lat)) * math.sin(dlng / 2.0) ** 2
                        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
                        dist = round(R * c, 1)

                        if dist > (radius_miles * 1.25):
                            continue

                        norm_name = p_name.lower().replace("'", "").replace('"', '').strip()
                        if pid and pid in seen_place_ids:
                            continue
                        if norm_name in seen_names:
                            continue

                        if pid:
                            seen_place_ids.add(pid)
                        seen_names.add(norm_name)

                        opening_hours = place.get("opening_hours") or {}
                        open_now = opening_hours.get("open_now")
                        photos = place.get("photos") or []
                        photo_ref = photos[0].get("photo_reference") if photos else None

                        is_gw_official = bool("warhammer" in norm_name or "games workshop" in norm_name)

                        # Check if website was already cached from Place Details
                        cached_details = db.get_cached(db._place_details_cache_dict, pid, ttl=86400 * 7) if pid else None
                        initial_website = cached_details.get("website") if cached_details else None
                        if not initial_website and is_gw_official:
                            initial_website = "https://www.warhammer.com/en-US/store-finder"

                        stores.append({
                            "id": pid or f"g_{len(stores)}",
                            "place_id": pid,
                            "name": p_name,
                            "address": place.get("formatted_address", ""),
                            "latitude": float(p_lat),
                            "longitude": float(p_lng),
                            "distance_miles": dist,
                            "rating": float(place.get("rating", 0.0)) if place.get("rating") else None,
                            "user_ratings_total": int(place.get("user_ratings_total", 0)),
                            "open_now": open_now,
                            "photo_reference": photo_ref,
                            "is_official_warhammer": is_gw_official,
                            "is_tournament_venue": False,
                            "tournament_count": 0,
                            "website": initial_website,
                            "source": "google_places"
                        })
            except Exception as e:
                logger.warning(f"Google Places TextSearch query notice: {e}")

        # 2. Query verified Warhammer tournament venues from PostgreSQL database
        try:
            lat_delta = (radius_miles * 1.25) / 69.0
            cos_lat = max(0.2, math.cos(math.radians(user_lat)))
            lng_delta = (radius_miles * 1.25) / (69.0 * cos_lat)
            min_lat = user_lat - lat_delta
            max_lat = user_lat + lat_delta
            min_lng = user_lng - lng_delta
            max_lng = user_lng + lng_delta

            try:
                from psycopg2 import extras
            except ImportError:
                from core import extras

            with db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    cursor.execute("""
                        WITH venues_filtered AS (
                            SELECT 
                                COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') as venue_name,
                                e.city, e.state, e.country,
                                COALESCE(e.raw_json->>'address', e.raw_json->'location'->>'address', '') as address,
                                e.latitude as lat,
                                e.longitude as lng,
                                COUNT(*) as tournament_count,
                                MAX(e.event_date) as last_tournament_date,
                                MAX(COALESCE(
                                    NULLIF(TRIM(e.raw_json->>'website'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'website'), ''),
                                    NULLIF(TRIM(e.raw_json->>'url'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'url'), ''),
                                    NULLIF(TRIM(e.raw_json->>'facebook'), ''),
                                    NULLIF(TRIM(e.raw_json->'location'->>'facebook'), '')
                                )) as website
                            FROM events e
                            WHERE e.latitude BETWEEN %s AND %s
                              AND e.longitude BETWEEN %s AND %s
                              AND (e.venue IS NOT NULL OR e.venue_name IS NOT NULL OR e.raw_json->>'locationName' IS NOT NULL)
                            GROUP BY 1, 2, 3, 4, 5, 6, 7
                        ),
                        venues_dist AS (
                            SELECT *,
                                (3959.0 * acos(
                                    LEAST(1.0, GREATEST(-1.0,
                                        cos(radians(%s)) * cos(radians(lat)) * cos(radians(lng) - radians(%s)) +
                                        sin(radians(%s)) * sin(radians(lat))
                                    ))
                                )) AS distance_miles
                            FROM venues_filtered
                            WHERE lat IS NOT NULL AND lng IS NOT NULL
                              AND NOT (lat = 0.0 AND lng = 0.0)
                        )
                        SELECT venue_name, city, state, country, address, lat, lng,
                                tournament_count, last_tournament_date, website,
                                ROUND(distance_miles::numeric, 1) as distance_miles
                        FROM venues_dist
                        WHERE distance_miles <= %s
                        ORDER BY distance_miles ASC, tournament_count DESC
                        LIMIT 40;
                    """, (min_lat, max_lat, min_lng, max_lng, user_lat, user_lng, user_lat, radius_miles))
                    db_venues = cursor.fetchall()
                    for v in db_venues:
                        v_name = (v.get("venue_name") or "").strip()
                        if not v_name or len(v_name) < 3:
                            continue
                        if not cls.is_valid_game_store_name(v_name, is_from_google_places=False):
                            continue
                        v_norm = v_name.lower().replace("'", "").replace('"', '').strip()
                        v_dist = float(v.get("distance_miles") or 0.0)
                        v_lat = float(v.get("lat") or 0.0)
                        v_lng = float(v.get("lng") or 0.0)
                        v_website = (v.get("website") or "").strip() or None
                        t_count = int(v.get("tournament_count") or 0)
                        last_date = v.get("last_tournament_date")
                        if hasattr(last_date, "isoformat"):
                            last_date = last_date.isoformat()

                        matched_existing = None
                        for s in stores:
                            s_norm = s["name"].lower().replace("'", "").replace('"', '').strip()
                            if s_norm in v_norm or v_norm in s_norm or (abs(s["latitude"] - v_lat) < 0.003 and abs(s["longitude"] - v_lng) < 0.003):
                                matched_existing = s
                                break

                        if matched_existing:
                            matched_existing["is_tournament_venue"] = True
                            matched_existing["tournament_count"] = max(matched_existing["tournament_count"], t_count)
                            matched_existing["last_tournament_date"] = last_date
                            if not matched_existing.get("website") and v_website:
                                matched_existing["website"] = v_website
                        else:
                            if v_norm not in seen_names:
                                seen_names.add(v_norm)
                                is_gw = bool("warhammer" in v_norm or "games workshop" in v_norm)
                                city_state = f"{v.get('city') or ''}, {v.get('state') or ''}".strip(', ')
                                full_addr = v.get("address") or city_state or location_name
                                venue_web = v_website or ("https://www.warhammer.com/en-US/store-finder" if is_gw else None)
                                stores.append({
                                    "id": f"db_{len(stores)}",
                                    "place_id": None,
                                    "name": v_name,
                                    "address": full_addr,
                                    "city": v.get("city") or "",
                                    "state": v.get("state") or "",
                                    "latitude": v_lat,
                                    "longitude": v_lng,
                                    "distance_miles": v_dist,
                                    "rating": None,
                                    "user_ratings_total": 0,
                                    "open_now": None,
                                    "photo_reference": None,
                                    "is_official_warhammer": is_gw,
                                    "is_tournament_venue": True,
                                    "tournament_count": t_count,
                                    "last_tournament_date": last_date,
                                    "website": venue_web,
                                    "source": "database_tournaments"
                                })
        except Exception as e:
            logger.warning(f"Database tournament venues notice: {e}")

        # Sort stores by distance
        stores.sort(key=lambda s: (s.get("distance_miles") if s.get("distance_miles") is not None else 9999.0))

        result = {
            "success": True,
            "stores": stores,
            "total_found": len(stores),
            "location": {
                "lat": user_lat,
                "lng": user_lng,
                "radius_miles": radius_miles,
                "location_name": location_name
            }
        }
        db.set_cached(db._stores_cache_dict, cache_key, result)
        return result

    @classmethod
    def get_store_tournaments(
        cls,
        db: Any,
        store_name: str,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
        place_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retrieves all verified Warhammer tournaments hosted by a specific game store or venue.
        Matches by Google Place ID, spatial proximity (~350m), or normalized venue name.
        """
        clean_name = (store_name or "").strip()
        s_norm = clean_name.lower().replace("'", "").replace('"', '').strip()

        # Extract core name by removing common geographical / corporate suffixes
        core_name = s_norm
        for suffix in [" san diego", " llc", " inc", " store", " game store", " hobby shop", " games"]:
            if core_name.endswith(suffix):
                core_name = core_name[:-len(suffix)].strip()

        p_lat = None
        p_lng = None
        if lat is not None and lng is not None:
            try:
                p_lat = float(lat)
                p_lng = float(lng)
            except (ValueError, TypeError):
                p_lat = None
                p_lng = None

        events = []
        try:
            try:
                from psycopg2 import extras
            except ImportError:
                from core import extras

            with db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    min_lat = p_lat - 0.006 if p_lat is not None else None
                    max_lat = p_lat + 0.006 if p_lat is not None else None
                    min_lng = p_lng - 0.006 if p_lng is not None else None
                    max_lng = p_lng + 0.006 if p_lng is not None else None

                    like_name = f"%{clean_name}%" if clean_name else "%"
                    like_core = f"%{core_name}%" if core_name and len(core_name) >= 3 else like_name

                    sql = """
                    SELECT 
                        e.id,
                        e.name,
                        e.event_date,
                        e.end_date,
                        e.city,
                        e.state,
                        e.country,
                        COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') as venue,
                        COALESCE(e.address, e.raw_json->>'address', e.raw_json->'location'->>'address') as address,
                        COALESCE(
                            NULLIF(TRIM(e.raw_json->>'website'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'website'), ''),
                            NULLIF(TRIM(e.raw_json->>'url'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'url'), ''),
                            NULLIF(TRIM(e.raw_json->>'facebook'), ''),
                            NULLIF(TRIM(e.raw_json->'location'->>'facebook'), '')
                        ) as venue_website,
                        COALESCE(e.total_players, 0) as total_players,
                        COALESCE(e.num_rounds, 0) as num_rounds,
                        COALESCE(e.current_round, 0) as current_round,
                        e.is_ended,
                        e.event_type,
                        e.latitude,
                        e.longitude,
                        e.place_id,
                        COALESCE(
                            w.winner_name,
                            e.raw_json->>'winnerName',
                            e.raw_json->'winner'->>'name'
                        ) as winner_name,
                        w.winner_faction
                    FROM events e
                    LEFT JOIN LATERAL (
                        SELECT ep.full_name as winner_name, ep.faction as winner_faction
                        FROM event_participants ep
                        WHERE ep.event_id = e.id AND ep.placement = 1
                        ORDER BY ep.placement ASC
                        LIMIT 1
                    ) w ON true
                    WHERE 
                        (
                            %s IS NOT NULL AND %s IS NOT NULL
                            AND e.latitude BETWEEN %s AND %s
                            AND e.longitude BETWEEN %s AND %s
                        )
                        OR (
                            %s IS NOT NULL AND %s != ''
                            AND (
                                e.place_id = %s
                                OR e.raw_json->>'place_id' = %s
                                OR e.raw_json->'location'->>'placeId' = %s
                            )
                        )
                        OR (
                            %s IS NOT NULL AND %s != ''
                            AND (
                                COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') ILIKE %s
                                OR COALESCE(e.venue, e.venue_name, e.raw_json->>'locationName', e.raw_json->>'gameStoreName') ILIKE %s
                            )
                        )
                    ORDER BY e.event_date DESC NULLS LAST;
                    """

                    params = (
                        min_lat, min_lng, min_lat, max_lat, min_lng, max_lng,
                        place_id, place_id, place_id, place_id, place_id,
                        clean_name, clean_name, like_name, like_core
                    )

                    cursor.execute(sql, params)
                    raw_rows = cursor.fetchall()

                    seen_ids = set()
                    found_website = None
                    for r in raw_rows:
                        eid = str(r.get("id"))
                        if eid in seen_ids:
                            continue

                        v_name = (r.get("venue") or "").strip()
                        v_norm = v_name.lower().replace("'", "").replace('"', '').strip()
                        ev_lat = r.get("latitude")
                        ev_lng = r.get("longitude")
                        ev_pid = r.get("place_id")

                        is_match = False
                        if place_id and ev_pid and ev_pid == place_id:
                            is_match = True
                        elif p_lat is not None and p_lng is not None and ev_lat is not None and ev_lng is not None:
                            if abs(p_lat - float(ev_lat)) < 0.0035 and abs(p_lng - float(ev_lng)) < 0.0035:
                                is_match = True

                        if not is_match and s_norm and v_norm and len(v_norm) >= 3:
                            if s_norm in v_norm or v_norm in s_norm:
                                is_match = True
                            elif core_name and len(core_name) >= 3 and (core_name in v_norm or v_norm in core_name):
                                is_match = True

                        if is_match:
                            seen_ids.add(eid)
                            if not found_website and r.get("venue_website"):
                                found_website = (r.get("venue_website") or "").strip() or None

                            ed = r.get("event_date")
                            if hasattr(ed, "isoformat"):
                                ed = ed.isoformat()
                            end_d = r.get("end_date")
                            if hasattr(end_d, "isoformat"):
                                end_d = end_d.isoformat()

                            events.append({
                                "id": eid,
                                "name": r.get("name") or "Tournament",
                                "event_date": ed,
                                "end_date": end_d,
                                "city": r.get("city") or "",
                                "state": r.get("state") or "",
                                "country": r.get("country") or "",
                                "venue": v_name,
                                "address": r.get("address") or "",
                                "total_players": int(r.get("total_players") or 0),
                                "num_rounds": int(r.get("num_rounds") or 0),
                                "current_round": int(r.get("current_round") or 0),
                                "is_ended": bool(r.get("is_ended")),
                                "event_type": r.get("event_type") or "singles",
                                "winner_name": r.get("winner_name"),
                                "winner_faction": r.get("winner_faction")
                            })
        except Exception as e:
            logger.error(f"Error getting store tournaments for {store_name}: {e}")

        if not found_website and place_id:
            cached_d = db.get_cached(db._place_details_cache_dict, place_id, ttl=86400 * 7)
            if cached_d and cached_d.get("website"):
                found_website = cached_d.get("website")

        return {
            "success": True,
            "store_name": clean_name,
            "store_website": found_website,
            "total_tournaments": len(events),
            "tournaments": events
        }

    @classmethod
    def get_place_details(cls, db: Any, place_id: str) -> Dict[str, Any]:
        """
        Fetches Google Place Details (website, maps url, phone) with in-memory 7-day caching.
        """
        if not place_id or not place_id.strip():
            return {"success": False, "error": "Missing place_id"}

        clean_pid = place_id.strip()
        cached = db.get_cached(db._place_details_cache_dict, clean_pid, ttl=86400 * 7)
        if cached is not None:
            return cached

        google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
        if not google_maps_key:
            try:
                from config import GOOGLE_MAPS_API_KEY
                google_maps_key = GOOGLE_MAPS_API_KEY
            except Exception:
                pass

        if not google_maps_key:
            return {"success": False, "error": "GOOGLE_MAPS_API_KEY not configured"}

        url = f"https://maps.googleapis.com/maps/api/place/details/json?place_id={urllib.parse.quote(clean_pid)}&fields=website,url,formatted_phone_number,name&key={google_maps_key}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EloRanking/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                result = data.get("result", {})
                website = (result.get("website") or "").strip() or None
                maps_url = result.get("url") or None
                phone = result.get("formatted_phone_number") or None
                name = result.get("name") or None
                res = {
                    "success": True,
                    "place_id": clean_pid,
                    "name": name,
                    "website": website,
                    "maps_url": maps_url,
                    "phone": phone
                }
                db.set_cached(db._place_details_cache_dict, clean_pid, res)
                return res
        except Exception as e:
            logger.warning(f"Error fetching Google Place details for {clean_pid}: {e}")
            return {"success": False, "error": str(e)}
