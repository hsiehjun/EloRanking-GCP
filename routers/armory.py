"""Retribution Armory Router for OmniTactica.

Handles catalog retrieval, item purchases with spendable Glory,
equipping cosmetic loadouts (dice, card frames, titles), and vault inventory.
"""

import json
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from core import (
    APIRouter, HTTPException, Request, Response,
    get_database, get_auth_manager, _get_user_session_or_401
)
import armory_catalog
import badges

logger = logging.getLogger("ArmoryRouter")
router = APIRouter(tags=["Retribution Armory"])


def _calculate_user_glory_state(auth_mgr, user_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculates total earned glory, spent glory, and remaining spendable balance."""
    player_id = user_data.get("player_id")
    total_earned = 0
    crest_tier = 1

    if player_id:
        try:
            db = get_database()
            # Evaluate authentic badges to get earned glory and crest tier
            b_eval = badges.evaluate_player_badges(db, player_id, game_system="40k")
            total_earned = int(b_eval.get("glory_balance") or b_eval.get("glory_score") or 0)
            crest_tier = int((b_eval.get("rank") or {}).get("rank") or 1)
        except Exception as e:
            logger.warning(f"Notice computing glory for player {player_id}: {e}")
            total_earned = int(user_data.get("glory_score") or 0)
    else:
        total_earned = int(user_data.get("glory_score") or 0)

    # In dev or unlinked profiles, provide standard starting balance if empty
    if total_earned <= 0 and user_data.get("id"):
        total_earned = 500  # Starting recruit stipend

    spent = int(user_data.get("glory_spent") or 0)
    spendable = max(0, total_earned - spent)
    peak_elo = float(user_data.get("peak_elo") or user_data.get("elo") or 1500.0)

    return {
        "total_earned": total_earned,
        "glory_spent": spent,
        "spendable_glory": spendable,
        "crest_tier": crest_tier,
        "peak_elo": peak_elo
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
            "active_avatar": None
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
    catalog = armory_catalog.get_armory_catalog(
        user_vault=user_vault,
        user_crest_tier=user_crest_tier,
        game_system=game_sys,
        user_peak_elo=user_peak_elo
    )
    catalog["user_glory"] = glory_state
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
    user_data["armory_vault"] = vault
    user_data["glory_spent"] = new_spent

    try:
        with auth_mgr.db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                UPDATE users
                SET armory_vault = %s, glory_spent = %s, updated_at = NOW()
                WHERE id = %s;
                """, (json.dumps(vault), new_spent, user_id))

                # Log transaction
                cur.execute("""
                INSERT INTO armory_transactions (user_id, item_id, glory_cost, transaction_type, metadata, created_at)
                VALUES (%s, %s, %s, 'purchase', %s, NOW());
                """, (user_id, item_id, cost, json.dumps({"item_name": item["name"], "wing": item["wing"]})))
            conn.commit()
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

    valid_slots = ("active_dice", "active_card_frame", "active_title", "active_avatar")
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
    sys_eq = vault["equipped"].setdefault(sys_key, {"active_dice": None, "active_card_frame": None, "active_title": None, "active_avatar": None})
    sys_eq[slot] = item_id
    vault["equipped"][slot] = item_id
    user_data["armory_vault"] = vault

    try:
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
    valid_slots = ("active_dice", "active_card_frame", "active_title", "active_avatar")
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

    payload = item.get("payload") or {}
    sender_name = user_data.get("display_name") or user_data.get("name") or "Innes Wilson"

    return {
        "success": True,
        "message": f"Successfully poked {target_name} with {item['name']}!",
        "poke_id": poke_id,
        "poke_name": item["name"],
        "sender_name": sender_name,
        "target_player_id": target_player_id,
        "target_name": target_name,
        "charges_remaining": remaining_qty,
        "toast_message": payload.get("toast_message", f"{item['icon']} Poked by {sender_name}!"),
        "css_glow": payload.get("css_glow", "#38bdf8"),
        "icon": item.get("icon", "👉")
    }

