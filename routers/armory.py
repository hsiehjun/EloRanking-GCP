"""Retribution Armory Router for OmniTactica.

Handles catalog retrieval, item purchases with spendable Glory,
equipping cosmetic loadouts (dice, card frames, titles), and vault inventory.
"""

import json
import uuid
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timezone, timedelta

from core import (
    APIRouter, HTTPException, Request, Response,
    get_database, get_auth_manager, _get_user_session_or_401
)
import armory_catalog
import badges

logger = logging.getLogger("ArmoryRouter")
router = APIRouter(tags=["Retribution Armory"])


def _ensure_armory_db(auth_mgr):
    """Ensures armory_vault and glory_spent columns and armory_transactions table exist."""
    if not auth_mgr or not hasattr(auth_mgr, "db") or not auth_mgr.db:
        return
    try:
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                ALTER TABLE users ADD COLUMN IF NOT EXISTS armory_vault TEXT DEFAULT '{}';
                ALTER TABLE users ADD COLUMN IF NOT EXISTS glory_spent INTEGER DEFAULT 0;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS total_glory INTEGER DEFAULT 0;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS glory_balance INTEGER DEFAULT 0;
                CREATE TABLE IF NOT EXISTS armory_transactions (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(64) NOT NULL,
                    item_id VARCHAR(64) NOT NULL,
                    glory_cost INTEGER NOT NULL,
                    transaction_type VARCHAR(32) NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_armory_trans_user ON armory_transactions(user_id);
                """)
            conn.commit()
    except Exception as e:
        logger.debug(f"Notice ensuring armory schema in db: {e}")


def _calculate_user_glory_state(auth_mgr, user_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculates total earned unified glory across 40K and AoS, spent glory, and remaining spendable balance."""
    target_pid = user_data.get("player_id")
    target_uid = user_data.get("id")
    
    total_40k = 0
    total_aos = 0
    crest_tier = 1
    peak_elo = float(user_data.get("peak_elo") or user_data.get("elo") or 1500.0)

    if auth_mgr and (target_pid or target_uid):
        try:
            hub_40k = auth_mgr.get_user_competitor_hub(player_id=target_pid, user_id=target_uid, game_system="40k")
            total_40k = int(hub_40k.get("glory_40k") or 0)
            total_aos = int(hub_40k.get("glory_aos") or 0)
            evaluated_glory = int(hub_40k.get("unified_glory") or hub_40k.get("total_glory") or (total_40k + total_aos))
            crest_tier = max(crest_tier, int((hub_40k.get("rank") or {}).get("rank") or 1))
            peak_elo = max(peak_elo, float((hub_40k.get("player") or {}).get("peak_elo") or 1500.0))
            user_championships = hub_40k.get("championships", {})
        except Exception as e:
            logger.warning(f"Notice computing glory for user {target_uid}: {e}")
            evaluated_glory = total_40k + total_aos
            user_championships = {}
    else:
        evaluated_glory = 0
        user_championships = {}
    db_total = int(user_data.get("total_glory") or 0)
    db_spent = int(user_data.get("glory_spent") or 0)
    db_balance = int(user_data.get("glory_balance") or 0)

    # Sync and persist: If evaluated_glory is greater than db_total, award new points!
    if evaluated_glory > db_total:
        db_total = evaluated_glory
        db_balance = max(0, db_total - db_spent)
        user_data["total_glory"] = db_total
        user_data["glory_balance"] = db_balance
        if auth_mgr and hasattr(auth_mgr, "db") and auth_mgr.db and target_uid:
            try:
                _ensure_armory_db(auth_mgr)
                with auth_mgr.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                        UPDATE users SET total_glory = %s, glory_balance = %s, updated_at = NOW() WHERE id = %s;
                        """, (db_total, db_balance, target_uid))
                    conn.commit()
            except Exception as e:
                logger.debug(f"Notice persisting synced glory balance: {e}")
    elif db_total > 0 and evaluated_glory == 0:
        # Transient disconnect or timeout: fall back to persistent database values!
        evaluated_glory = db_total
        db_balance = max(0, db_total - db_spent)
    elif db_balance == 0 and db_total > 0:
        db_balance = max(0, db_total - db_spent)
    elif db_total == 0 and evaluated_glory > 0:
        db_total = evaluated_glory
        db_balance = max(0, db_total - db_spent)
        user_data["total_glory"] = db_total
        user_data["glory_balance"] = db_balance

    return {
        "total_earned": db_total or evaluated_glory,
        "total_glory": db_total or evaluated_glory,
        "glory_40k": total_40k,
        "glory_aos": total_aos,
        "glory_spent": db_spent,
        "spendable_glory": db_balance,
        "glory_balance": db_balance,
        "crest_tier": crest_tier,
        "peak_elo": peak_elo,
        "championships": user_championships
    }


def _get_or_init_vault(user_data: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts or initializes the player's armory vault."""
    vault = user_data.get("armory_vault")
    if isinstance(vault, str):
        try:
            vault = json.loads(vault)
        except Exception:
            vault = None

    if not isinstance(vault, dict):
        vault = {}

    if "inventory" not in vault or not isinstance(vault["inventory"], dict):
        vault["inventory"] = {}
    if "equipped" not in vault or not isinstance(vault["equipped"], dict):
        vault["equipped"] = {
            "active_dice": None,
            "active_card_frame": None,
            "active_title": None,
            "active_avatar": None,
            "active_card_finish": None
        }

    return vault


@router.get("/api/armory/catalog", summary="Get Retribution Armory catalog")
async def get_catalog(request: Request):
    """Returns the full Armory catalog with ownership flags and equipped status."""
    auth_mgr = get_auth_manager()
    user_vault = {"inventory": {}, "equipped": {}}
    user_crest_tier = 1
    glory_state = {"spendable_glory": 0, "total_earned": 0, "glory_spent": 0, "peak_elo": 1500.0}

    try:
        session = _get_user_session_or_401(request)
        user_id = session.get("user_id") or session.get("id")
        user_data = auth_mgr.get_user_by_id(user_id) or session
        user_vault = _get_or_init_vault(user_data)
        glory_state = _calculate_user_glory_state(auth_mgr, user_data)
        user_crest_tier = glory_state["crest_tier"]
    except Exception:
        # Unauthenticated users can still view the full catalog
        pass

    game_sys = request.query_params.get("game_system", "40k")
    user_peak_elo = float(glory_state.get("peak_elo") or 1500.0)
    user_champs = glory_state.get("championships")
    catalog = armory_catalog.get_armory_catalog(
        user_vault=user_vault,
        user_crest_tier=user_crest_tier,
        game_system=game_sys,
        user_peak_elo=user_peak_elo,
        user_championships=user_champs
    )
    catalog["user_glory"] = glory_state
    catalog["user_vault"] = user_vault
    return catalog


@router.get("/api/armory/vault", summary="Get player's armory inventory and equipped loadout")
async def get_vault(request: Request):
    """Returns the authenticated user's inventory, active equipped items, and Glory balance."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    vault = _get_or_init_vault(user_data)
    glory_state = _calculate_user_glory_state(auth_mgr, user_data)

    return {
        "success": True,
        "user_id": user_id,
        "vault": vault,
        "inventory": vault["inventory"],
        "equipped": vault["equipped"],
        "glory": glory_state
    }


@router.post("/api/armory/purchase", summary="Purchase an item from the Retribution Armory")
async def purchase_item(request: Request):
    """Atomically requisitions an item using spendable Glory points."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    try:
        body = await request.json()
    except Exception:
        body = {}

    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")

    item = armory_catalog.get_item_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found in Armory catalog")

    glory_state = _calculate_user_glory_state(auth_mgr, user_data)
    cost = item.get("cost_glory", 0)

    # 1. Verify sufficient Glory balance
    if glory_state["spendable_glory"] < cost:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient Glory Honor. Item costs {cost} Glory, but you only have {glory_state['spendable_glory']} available."
        )

    # 2. Check prerequisite locks (Career Crest Tier & All-Time Peak Elo)
    prereq = item.get("prerequisite")
    if prereq:
        req_tier = prereq.get("career_crest_tier")
        if req_tier is not None and glory_state["crest_tier"] < req_tier:
            raise HTTPException(
                status_code=400,
                detail=prereq.get("label", f"Prerequisite not met: Requires Career Crest Tier {req_tier}+")
            )
        req_peak = prereq.get("peak_elo")
        if req_peak is not None and float(glory_state.get("peak_elo") or 1500.0) < req_peak:
            raise HTTPException(
                status_code=400,
                detail=prereq.get("label", f"Prerequisite not met: Requires All-Time Peak Elo {req_peak:.0f}+ (Your Peak: {glory_state.get('peak_elo', 1500.0):.0f})")
            )

    vault = _get_or_init_vault(user_data)
    inventory = vault["inventory"]
    now_iso = datetime.now(timezone.utc).isoformat()

    # 3. Check ownership for non-consumable items
    if not item.get("is_consumable") and item_id in inventory:
        raise HTTPException(status_code=409, detail="You already own this permanent item.")

    # 4. Update inventory
    if item.get("is_consumable"):
        existing_qty = inventory.get(item_id, {}).get("quantity", 0)
        bundle_add = item.get("bundle_count", 1)
        inventory[item_id] = {
            "acquired_at": now_iso,
            "quantity": existing_qty + bundle_add,
            "item_name": item["name"],
            "wing": item["wing"]
        }
    else:
        inventory[item_id] = {
            "acquired_at": now_iso,
            "item_name": item["name"],
            "wing": item["wing"],
            "slot": item.get("slot")
        }

    # 5. Persist to database
    new_spent = glory_state["glory_spent"] + cost
    new_balance = max(0, glory_state["spendable_glory"] - cost)
    user_data["armory_vault"] = vault
    user_data["glory_spent"] = new_spent
    user_data["glory_balance"] = new_balance
    session["armory_vault"] = vault
    session["glory_spent"] = new_spent
    session["glory_balance"] = new_balance

    try:
        _ensure_armory_db(auth_mgr)
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users
                SET armory_vault = %s, glory_spent = %s, glory_balance = %s, updated_at = NOW()
                WHERE id = %s;
                """, (json.dumps(vault), new_spent, new_balance, user_id))
            conn.commit()

            try:
                with conn.cursor() as cur:
                    cur.execute("""
                    INSERT INTO armory_transactions (user_id, item_id, glory_cost, transaction_type, metadata, created_at)
                    VALUES (%s, %s, %s, 'purchase', %s, NOW());
                    """, (user_id, item_id, cost, json.dumps({"item_name": item["name"], "wing": item["wing"]})))
                conn.commit()
            except Exception as te:
                logger.debug(f"Transaction logging notice: {te}")
    except Exception as dbe:
        logger.warning(f"Database persist error in armory purchase (proceeding with session state): {dbe}")

    updated_glory = _calculate_user_glory_state(auth_mgr, user_data)

    return {
        "success": True,
        "message": f"Successfully requisitioned {item['name']} for {cost} Glory!",
        "item": item,
        "vault": vault,
        "glory": updated_glory
    }


@router.post("/api/armory/equip", summary="Equip an item from inventory to active loadout")
async def equip_item(request: Request):
    """Equips an owned item into an active slot (active_dice, active_card_frame, active_title)."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    try:
        body = await request.json()
    except Exception:
        body = {}

    slot = (body.get("slot") or "").strip()
    item_id = (body.get("item_id") or "").strip()

    valid_slots = ("active_dice", "active_card_frame", "active_title", "active_avatar", "active_card_finish")
    if slot not in valid_slots:
        raise HTTPException(status_code=400, detail=f"Invalid slot '{slot}'. Valid slots: {valid_slots}")

    vault = _get_or_init_vault(user_data)
    inventory = vault["inventory"]

    if item_id not in inventory:
        raise HTTPException(status_code=400, detail=f"You do not own item '{item_id}'. Please requisition it first.")

    item = armory_catalog.get_item_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item metadata not found")

    sys_key = (body.get("game_system") or item.get("game_system") or "40k").lower().strip()
    if sys_key not in ("40k", "aos"):
        sys_key = "40k"

    if not isinstance(vault.get("equipped"), dict):
        vault["equipped"] = {}
    sys_eq = vault["equipped"].setdefault(sys_key, {"active_dice": None, "active_card_frame": None, "active_title": None, "active_avatar": None, "active_card_finish": None})
    sys_eq[slot] = item_id
    vault["equipped"][slot] = item_id
    user_data["armory_vault"] = vault
    session["armory_vault"] = vault

    try:
        _ensure_armory_db(auth_mgr)
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET armory_vault = %s, updated_at = NOW() WHERE id = %s;
                """, (json.dumps(vault), user_id))
            conn.commit()
    except Exception as dbe:
        logger.warning(f"Database update error in armory equip: {dbe}")

    return {
        "success": True,
        "message": f"Equipped {item['name']} to {slot} ({sys_key.upper()}).",
        "slot": slot,
        "item_id": item_id,
        "game_system": sys_key,
        "equipped": vault["equipped"]
    }


@router.post("/api/armory/unequip", summary="Unequip an item from active loadout")
async def unequip_item(request: Request):
    """Clears an active cosmetic slot back to default."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    try:
        body = await request.json()
    except Exception:
        body = {}

    slot = (body.get("slot") or "").strip()
    valid_slots = ("active_dice", "active_card_frame", "active_title", "active_avatar", "active_card_finish")
    if slot not in valid_slots:
        raise HTTPException(status_code=400, detail=f"Invalid slot '{slot}'. Valid slots: {valid_slots}")

    sys_key = (body.get("game_system") or "40k").lower().strip()
    if sys_key not in ("40k", "aos"):
        sys_key = "40k"

    vault = _get_or_init_vault(user_data)
    if isinstance(vault.get("equipped"), dict):
        if isinstance(vault["equipped"].get(sys_key), dict):
            vault["equipped"][sys_key][slot] = None
        vault["equipped"][slot] = None
    user_data["armory_vault"] = vault
    session["armory_vault"] = vault

    try:
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET armory_vault = %s, updated_at = NOW() WHERE id = %s;
                """, (json.dumps(vault), user_id))
            conn.commit()
    except Exception as dbe:
        logger.warning(f"Database update error in armory unequip: {dbe}")

    return {
        "success": True,
        "message": f"Unequipped {slot} ({sys_key.upper()}).",
        "slot": slot,
        "game_system": sys_key,
        "equipped": vault["equipped"]
    }


@router.post("/api/armory/poke", summary="Poke another player with an armory poke")
async def poke_player(request: Request):
    """Dispatches an interactive poke to another player, consuming 1 charge."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    try:
        body = await request.json()
    except Exception:
        body = {}

    poke_id = (body.get("poke_id") or "").strip()
    target_player_id = (body.get("target_player_id") or "p_dev_opponent").strip()
    target_name = (body.get("target_name") or "Opposing Commander").strip()

    if not poke_id:
        raise HTTPException(status_code=400, detail="poke_id is required")

    item = armory_catalog.get_item_by_id(poke_id)
    if not item or item.get("wing") != "pokes":
        raise HTTPException(status_code=404, detail=f"Poke item '{poke_id}' not found")

    vault = _get_or_init_vault(user_data)
    inventory = vault["inventory"]

    inv_entry = inventory.get(poke_id)
    if not inv_entry or inv_entry.get("quantity", 0) <= 0:
        raise HTTPException(status_code=400, detail=f"You have no remaining charges of {item['name']}. Requisition a 5-pack in the Armory.")

    # Deduct 1 charge
    remaining_qty = inv_entry["quantity"] - 1
    inv_entry["quantity"] = remaining_qty

    payload = item.get("payload") or {}
    sender_name = user_data.get("display_name") or user_data.get("name") or "Innes Wilson"
    now_dt = datetime.now(timezone.utc)
    duration_hours = int(payload.get("hex_duration_hours", 24))
    expires_dt = now_dt + timedelta(hours=duration_hours)
    now_iso = now_dt.isoformat()
    expires_iso = expires_dt.isoformat()
    toast_msg = payload.get("toast_message", f"{item.get('icon', '👉')} Poked {target_name}!").replace("{target}", target_name)
    banner_desc = payload.get("hex_banner_desc", f"Targeted by rival commander {sender_name}.").replace("{sender}", sender_name)

    poke_event = {
        "id": f"poke_evt_{uuid.uuid4().hex[:10]}",
        "poke_id": poke_id,
        "poke_name": item["name"],
        "icon": item.get("icon", "👉"),
        "sender_id": str(user_id),
        "sender_name": sender_name,
        "target_player_id": target_player_id,
        "target_name": target_name,
        "created_at": now_iso,
        "expires_at": expires_iso,
        "duration_hours": duration_hours,
        "seen": False,
        "sign_in_effect": payload.get("sign_in_effect", "spark"),
        "hex_badge_title": payload.get("hex_badge_title", "Rival Hex"),
        "hex_banner_desc": banner_desc,
        "toast_message": toast_msg,
        "css_glow": payload.get("css_glow", "#38bdf8")
    }

    # Store in sender's dispatched log
    dispatched = vault.setdefault("dispatched_pokes", [])
    dispatched.insert(0, poke_event)
    vault["dispatched_pokes"] = dispatched[:30]
    user_data["armory_vault"] = vault

    try:
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users SET armory_vault = %s, updated_at = NOW() WHERE id = %s;
                """, (json.dumps(vault), user_id))
            conn.commit()
    except Exception as dbe:
        logger.warning(f"Database update error in poke: {dbe}")

    # Deliver to target player's vault if target exists
    if target_player_id and str(target_player_id) != str(user_id):
        try:
            target_user = auth_mgr.get_user_by_id(target_player_id)
            if target_user:
                target_v = _get_or_init_vault(target_user)
                t_pokes = target_v.setdefault("received_pokes", [])
                t_pokes.insert(0, poke_event)
                # Keep active + recent within 48h
                target_v["received_pokes"] = [p for p in t_pokes[:30] if p.get("expires_at", "") > (now_dt - timedelta(hours=48)).isoformat()]
                with auth_mgr.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE users SET armory_vault = %s, updated_at = NOW() WHERE id = %s;", (json.dumps(target_v), target_player_id))
                    conn.commit()
        except Exception as te:
            logger.warning(f"Notice delivering poke to target {target_player_id}: {te}")

    return {
        "success": True,
        "message": f"Successfully poked {target_name} with {item['name']}!",
        "poke_id": poke_id,
        "poke_name": item["name"],
        "sender_name": sender_name,
        "target_player_id": target_player_id,
        "target_name": target_name,
        "charges_remaining": remaining_qty,
        "toast_message": toast_msg,
        "css_glow": payload.get("css_glow", "#38bdf8"),
        "icon": item.get("icon", "👉"),
        "duration_hours": duration_hours,
        "expires_at": expires_iso,
        "sign_in_effect": payload.get("sign_in_effect", "spark"),
        "hex_badge_title": payload.get("hex_badge_title", "Rival Hex"),
        "hex_banner_desc": banner_desc,
        "poke_event": poke_event
    }


@router.get("/api/armory/pokes/active", summary="Get active pokes and hexes received by current player")
async def get_active_pokes(request: Request):
    """Returns active, unexpired pokes received within the last 24 hours."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    vault = _get_or_init_vault(user_data)
    now_iso = datetime.now(timezone.utc).isoformat()
    raw_pokes = vault.get("received_pokes") or []

    # Active pokes: not expired (now < expires_at)
    active_pokes = [p for p in raw_pokes if isinstance(p, dict) and p.get("expires_at", "") > now_iso]
    unseen_pokes = [p for p in active_pokes if not p.get("seen")]

    return {
        "success": True,
        "active_pokes": active_pokes,
        "unseen_pokes": unseen_pokes,
        "total_active": len(active_pokes),
        "unseen_count": len(unseen_pokes)
    }


@router.post("/api/armory/poke/acknowledge", summary="Acknowledge incoming poke effect")
async def acknowledge_poke(request: Request):
    """Marks a received poke event as seen (dismisses initial sign-in animation)."""
    session = _get_user_session_or_401(request)
    user_id = session.get("user_id") or session.get("id")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session

    try:
        body = await request.json()
    except Exception:
        body = {}

    target_evt_id = body.get("poke_event_id")
    vault = _get_or_init_vault(user_data)
    raw_pokes = vault.get("received_pokes") or []

    modified = False
    for p in raw_pokes:
        if not target_evt_id or p.get("id") == target_evt_id:
            if not p.get("seen"):
                p["seen"] = True
                modified = True

    if modified:
        user_data["armory_vault"] = vault
        try:
            with auth_mgr.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE users SET armory_vault = %s, updated_at = NOW() WHERE id = %s;", (json.dumps(vault), user_id))
                conn.commit()
        except Exception as dbe:
            logger.warning(f"Database update error in acknowledge poke: {dbe}")

    return {"success": True, "acknowledged": True}


@router.get("/api/armory/transactions", summary="Get auditable Glory transactions (earned and spent)")
async def get_armory_transactions(request: Request):
    """Returns detailed history of all Glory points earned and spent for verification and auditing."""
    auth_mgr = get_auth_manager()
    try:
        session = _get_user_session_or_401(request)
        user_id = session.get("user_id") or session.get("id")
        user_data = auth_mgr.get_user_by_id(user_id) or session
    except Exception:
        return {"success": True, "debits": [], "credits": [], "summary": {}}

    vault = _get_or_init_vault(user_data)
    glory_state = _calculate_user_glory_state(auth_mgr, user_data)

    db_txs = []
    if auth_mgr and hasattr(auth_mgr, "db") and auth_mgr.db:
        try:
            with auth_mgr.db.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                    cur.execute("""
                    SELECT id, item_id, glory_cost, transaction_type, metadata, created_at
                    FROM armory_transactions
                    WHERE user_id = %s
                    ORDER BY created_at DESC;
                    """, (user_id,))
                    db_txs = [dict(r) for r in cur.fetchall()]
        except Exception as e:
            logger.debug(f"Notice fetching db armory transactions: {e}")

    debits = []
    seen_items = set()
    for tx in db_txs:
        meta = tx.get("metadata") or {}
        if isinstance(meta, str):
            try: meta = json.loads(meta)
            except Exception: meta = {}
        debits.append({
            "id": f"tx_{tx.get('id')}",
            "type": "debit",
            "item_id": tx.get("item_id"),
            "name": meta.get("item_name") or tx.get("item_id"),
            "wing": meta.get("wing") or "Armory Requisition",
            "cost": int(tx.get("glory_cost") or 0),
            "date": tx.get("created_at").isoformat() if hasattr(tx.get("created_at"), "isoformat") else str(tx.get("created_at") or "")
        })
        seen_items.add(tx.get("item_id"))

    inv = vault.get("inventory", {})
    for item_id, inv_item in inv.items():
        if item_id in seen_items:
            continue
        c_item = armory_catalog.get_item_by_id(item_id) or {}
        cost = int(c_item.get("cost") or (inv_item.get("cost") if isinstance(inv_item, dict) else 0) or 0)
        acquired = inv_item.get("purchased_at") if isinstance(inv_item, dict) else ""
        debits.append({
            "id": f"inv_{item_id}",
            "type": "debit",
            "item_id": item_id,
            "name": c_item.get("name") or (inv_item.get("name") if isinstance(inv_item, dict) else item_id),
            "wing": c_item.get("wing") or (inv_item.get("wing") if isinstance(inv_item, dict) else "Armory Requisition"),
            "cost": cost,
            "date": acquired or ""
        })

    credits = []
    target_pid = user_data.get("player_id")
    if auth_mgr and (target_pid or user_id):
        try:
            hub = auth_mgr.get_user_competitor_hub(player_id=target_pid, user_id=user_id, game_system="40k")
            champs = (hub.get("championships") or {}).get("items", [])
            for c in champs:
                credits.append({
                    "id": f"champ_{c.get('event_id')}",
                    "type": "credit",
                    "category": "Tournament Silverware",
                    "name": f"🏆 {c.get('event_name')}",
                    "detail": f"{c.get('tier_title')} • Record: {c.get('record')}",
                    "amount": int(c.get("glory_bonus") or 0),
                    "date": str(c.get("event_date") or "")
                })

            badges_list = hub.get("badges", [])
            for b in badges_list:
                if b.get("unlocked") and int(b.get("glory") or b.get("glory_bounty") or 0) > 0:
                    credits.append({
                        "id": f"badge_{b.get('id')}",
                        "type": "credit",
                        "category": "Battlefield Honor",
                        "name": f"🎖️ {b.get('name')}",
                        "detail": f"{b.get('tier_name', 'Honor')} • {b.get('provenance') or b.get('description') or ''}",
                        "amount": int(b.get("glory") or b.get("glory_bounty") or 0),
                        "date": ""
                    })

            if hub.get("glory_aos") and int(hub.get("glory_aos")) > 0:
                credits.append({
                    "id": "cross_sys_aos",
                    "type": "credit",
                    "category": "Cross-Game System",
                    "name": "⚡ Age of Sigmar Competitive Honor",
                    "detail": "Match play & verified tournament performance in AoS",
                    "amount": int(hub.get("glory_aos")),
                    "date": ""
                })
        except Exception as he:
            logger.debug(f"Notice building glory credits: {he}")

    total_earned = glory_state.get("total_earned", 0)
    total_spent = glory_state.get("glory_spent", 0)
    spendable = glory_state.get("spendable_glory", 0)

    return {
        "success": True,
        "summary": {
            "total_earned": total_earned,
            "total_spent": total_spent,
            "spendable_glory": spendable,
            "glory_40k": glory_state.get("glory_40k", 0),
            "glory_aos": glory_state.get("glory_aos", 0),
            "is_balanced": (total_earned - total_spent) == spendable
        },
        "debits": debits,
        "credits": credits
    }

