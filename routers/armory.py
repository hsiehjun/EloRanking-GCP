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


import glory_ledger_service


def _calculate_user_glory_state(auth_mgr, user_data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculates total earned unified glory across 40K and AoS, syncs with the ACID Glory Ledger, and returns the verified wallet state."""
    target_pid = user_data.get("player_id")
    target_uid = str(user_data.get("id") or user_data.get("user_id") or "")

    total_40k = 0
    total_aos = 0
    crest_tier = 1
    peak_elo = float(user_data.get("peak_elo") or user_data.get("elo") or 1500.0)
    user_championships = {}

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
    else:
        evaluated_glory = int(user_data.get("total_glory") or 0)

    db_total = int(user_data.get("total_glory") or 0)
    effective_earned = max(evaluated_glory, db_total)

    if target_uid:
        ledger_svc = glory_ledger_service.get_glory_ledger_service()
        wallet_resp = ledger_svc.sync_earned_career_glory(
            user_id=target_uid,
            evaluated_earned_glory=effective_earned,
            glory_40k=total_40k,
            glory_aos=total_aos
        )
        user_data["total_glory"] = wallet_resp["total_glory"]
        user_data["glory_spent"] = wallet_resp["glory_spent"]
        user_data["glory_balance"] = wallet_resp["glory_balance"]
        return {
            **wallet_resp,
            "crest_tier": crest_tier,
            "peak_elo": peak_elo,
            "championships": user_championships
        }

    db_spent = int(user_data.get("glory_spent") or 0)
    db_balance = max(0, effective_earned - db_spent)
    return {
        "total_earned": effective_earned,
        "total_glory": effective_earned,
        "earned_glory_total": effective_earned,
        "purchased_glory_total": 0,
        "granted_glory_total": 0,
        "glory_40k": total_40k,
        "glory_aos": total_aos,
        "glory_spent": db_spent,
        "spent_glory_total": db_spent,
        "spendable_glory": db_balance,
        "glory_balance": db_balance,
        "current_balance": db_balance,
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

    # 5. Execute atomic ACID debit + inventory update in GloryLedgerService
    ledger_svc = glory_ledger_service.get_glory_ledger_service()
    client_idem_key = (body.get("idempotency_key") or "").strip()
    if not client_idem_key:
        if not item.get("is_consumable"):
            # Permanent items have a natural deterministic idempotency key per user+item
            client_idem_key = f"armory_perm:{user_id}:{item_id}"
        else:
            new_qty = inventory.get(item_id, {}).get("quantity", 0)
            client_idem_key = f"armory_cons:{user_id}:{item_id}:qty_{new_qty}:{int(datetime.now(timezone.utc).timestamp() // 2)}"

    def _persist_vault_inside_tx(cur, _wallet):
        if cur is not None:
            cur.execute("""
                UPDATE users
                SET armory_vault = %s, updated_at = NOW()
                WHERE id = %s;
            """, (json.dumps(vault), user_id))

    try:
        tx_wallet = ledger_svc.execute_transaction(
            user_id=str(user_id),
            direction="DEBIT",
            bucket="SPENT",
            category="armory_purchase",
            amount=int(cost),
            description=f"Armory Requisition: {item['name']} ({item['wing']})",
            idempotency_key=client_idem_key,
            reference_type="armory_item",
            reference_id=item_id,
            actor_user_id=str(user_id),
            metadata={"item_id": item_id, "item_name": item["name"], "wing": item["wing"], "cost_glory": int(cost)},
            vault_updater=_persist_vault_inside_tx
        )
    except glory_ledger_service.GloryLedgerError as gle:
        raise HTTPException(status_code=gle.status_code, detail=gle.message)
    except Exception as dbe:
        logger.error(f"ACID ledger error in armory purchase for {user_id}: {dbe}")
        raise HTTPException(status_code=500, detail="Transaction aborted by Glory Honor Ledger safety check. No Glory was deducted.")

    user_data["armory_vault"] = vault
    user_data["glory_spent"] = tx_wallet["glory_spent"]
    user_data["glory_balance"] = tx_wallet["glory_balance"]
    session["armory_vault"] = vault
    session["glory_spent"] = tx_wallet["glory_spent"]
    session["glory_balance"] = tx_wallet["glory_balance"]

    updated_glory = {
        **glory_state,
        **tx_wallet
    }

    return {
        "success": True,
        "message": f"Successfully requisitioned {item['name']} for {cost} Glory! (TX: {tx_wallet.get('last_tx_id')})",
        "tx_id": tx_wallet.get("last_tx_id"),
        "entry_hash": tx_wallet.get("last_entry_hash"),
        "item": item,
        "vault": vault,
        "glory": updated_glory
    }


@router.get("/api/glory/ledger", summary="Get user's immutable hash-chained Glory Honor transaction ledger")
@router.get("/api/armory/ledger", summary="Get user's immutable hash-chained Glory Honor transaction ledger")
async def get_user_glory_ledger(request: Request, limit: int = 50):
    session = _get_user_session_or_401(request)
    user_id = str(session.get("user_id") or session.get("id") or "")
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(user_id) or session
    glory_state = _calculate_user_glory_state(auth_mgr, user_data)
    ledger_svc = glory_ledger_service.get_glory_ledger_service()
    entries = ledger_svc.get_user_ledger_history(user_id=user_id, limit=limit)
    audit = ledger_svc.audit_user_wallet(user_id=user_id)
    return {
        "success": True,
        "user_id": user_id,
        "wallet": glory_state,
        "audit": audit,
        "ledger": entries,
        "count": len(entries)
    }


@router.get("/api/glory/audit", summary="Run 5-point mathematical & SHA-256 cryptographic hash-chain audit on Glory wallet")
@router.get("/api/armory/audit", summary="Run 5-point mathematical & SHA-256 cryptographic hash-chain audit on Glory wallet")
async def run_user_glory_audit(request: Request, target_user_id: Optional[str] = None):
    session = _get_user_session_or_401(request)
    caller_uid = str(session.get("user_id") or session.get("id") or "")
    is_admin = bool(session.get("is_admin") or str(session.get("role") or "").lower() in ("admin", "superuser", "developer", "owner"))
    uid = str(target_user_id).strip() if (target_user_id and is_admin) else caller_uid
    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(uid) or session
    _calculate_user_glory_state(auth_mgr, user_data)
    ledger_svc = glory_ledger_service.get_glory_ledger_service()
    report = ledger_svc.audit_user_wallet(user_id=uid)
    return {
        "success": True,
        "audit": report
    }


@router.post("/api/glory/transact", summary="Execute an atomic, idempotent Glory Honor transaction (Event/League fee, Fiat Top-Up, Refund, or Grant)")
async def execute_glory_transaction(request: Request):
    session = _get_user_session_or_401(request)
    caller_uid = str(session.get("user_id") or session.get("id") or "")
    is_admin = bool(session.get("is_admin") or str(session.get("role") or "").lower() in ("admin", "superuser", "developer", "owner"))
    try:
        body = await request.json()
    except Exception:
        body = {}

    target_uid = str(body.get("user_id") or caller_uid).strip()
    direction = str(body.get("direction") or "DEBIT").upper().strip()
    bucket = str(body.get("bucket") or ("SPENT" if direction == "DEBIT" else "PURCHASED")).upper().strip()
    category = str(body.get("category") or "general").strip()
    amount = int(body.get("amount") or 0)
    description = str(body.get("description") or f"Glory Honor {direction}: {category}").strip()
    idempotency_key = str(body.get("idempotency_key") or "").strip()
    reference_type = str(body.get("reference_type") or "").strip() or None
    reference_id = str(body.get("reference_id") or "").strip() or None
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}

    # Security rule: Non-admin users can only DEBIT their own wallet (e.g., event/league registration fees, model purchases)
    # or process verified top-ups with a valid payment reference. Admin grants/refunds require admin privilege.
    if target_uid != caller_uid and not is_admin:
        raise HTTPException(status_code=403, detail="Cannot execute transactions on another user's Glory wallet.")
    if direction == "CREDIT" and bucket in ("GRANTED", "REFUND") and not is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can issue manual Glory Honor grants or refunds.")
    if not idempotency_key:
        raise HTTPException(status_code=400, detail="idempotency_key is mandatory for all Glory Honor financial transactions.")

    auth_mgr = get_auth_manager()
    user_data = auth_mgr.get_user_by_id(target_uid) or session
    _calculate_user_glory_state(auth_mgr, user_data)

    ledger_svc = glory_ledger_service.get_glory_ledger_service()
    try:
        wallet_res = ledger_svc.execute_transaction(
            user_id=target_uid,
            direction=direction,
            bucket=bucket,
            category=category,
            amount=amount,
            description=description,
            idempotency_key=idempotency_key,
            reference_type=reference_type,
            reference_id=reference_id,
            actor_user_id=caller_uid,
            metadata=metadata
        )
        audit_report = ledger_svc.audit_user_wallet(user_id=target_uid)
        return {
            "success": True,
            "tx_id": wallet_res.get("last_tx_id"),
            "entry_hash": wallet_res.get("last_entry_hash"),
            "was_idempotent_replay": wallet_res.get("was_idempotent_replay", False),
            "wallet": wallet_res,
            "audit": audit_report
        }
    except glory_ledger_service.GloryLedgerError as gle:
        raise HTTPException(status_code=gle.status_code, detail=gle.message)


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

    item = armory_catalog.get_item_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item metadata not found")

    canon_id = item["id"]
    if item_id not in inventory and canon_id not in inventory and not any(getattr(armory_catalog, "ARMORY_ALIASES", {}).get(k) == canon_id for k in inventory.keys()):
        raise HTTPException(status_code=400, detail=f"You do not own item '{item_id}'. Please requisition it first.")

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
        cost = int(c_item.get("cost_glory") or c_item.get("cost") or (inv_item.get("cost") if isinstance(inv_item, dict) else 0) or 0)
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
                b_glory = int(b.get("glory_points") or b.get("glory") or b.get("glory_bounty") or 0)
                if b.get("unlocked") and b_glory > 0:
                    credits.append({
                        "id": f"badge_{b.get('id')}",
                        "type": "credit",
                        "category": "Battlefield Honor",
                        "name": f"🎖️ {b.get('name')}",
                        "detail": f"{b.get('tier_name', 'Honor')} • {b.get('provenance') or b.get('description') or ''}",
                        "amount": b_glory,
                        "date": str(b.get("unlocked_at") or "")
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

    ledger_svc = glory_ledger_service.get_glory_ledger_service()
    ledger_entries = ledger_svc.get_user_ledger_history(user_id=str(user_id), limit=200)
    audit_report = ledger_svc.audit_user_wallet(user_id=str(user_id))

    # Merge any non-badge ledger credits (Fiat Top-Ups, TO/Admin Grants, Refunds) into credits
    # and any non-Armory ledger debits (Event Registration Fees, League Registration Fees, Model Purchases) into debits
    for entry in ledger_entries:
        cat = str(entry.get("category") or "")
        tx_id = entry.get("tx_id")
        if entry.get("direction") == "CREDIT" and cat not in ("genesis_career_sync", "career_achievement_sync"):
            credits.insert(0, {
                "id": tx_id,
                "tx_id": tx_id,
                "type": "credit",
                "bucket": entry.get("bucket", "PURCHASED"),
                "category": f"{entry.get('bucket', 'CREDIT')} • {cat}",
                "name": f"💎 {entry.get('description')}",
                "detail": f"TX: {tx_id} • Balance: {entry.get('balance_before'):,} → {entry.get('balance_after'):,} • SHA-256: {str(entry.get('entry_hash') or '')[:12]}…",
                "amount": int(entry.get("amount") or 0),
                "balance_before": int(entry.get("balance_before") or 0),
                "balance_after": int(entry.get("balance_after") or 0),
                "entry_hash": entry.get("entry_hash"),
                "date": str(entry.get("created_at") or "")
            })
        elif entry.get("direction") == "DEBIT" and cat not in ("genesis_armory_spend",):
            ref_id = entry.get("reference_id")
            if ref_id and ref_id in seen_items and cat == "armory_purchase":
                continue
            debits.insert(0, {
                "id": tx_id,
                "tx_id": tx_id,
                "type": "debit",
                "item_id": ref_id or cat,
                "name": entry.get("description") or cat,
                "wing": f"TX: {tx_id} • Balance: {entry.get('balance_before'):,} → {entry.get('balance_after'):,} • SHA-256: {str(entry.get('entry_hash') or '')[:12]}…",
                "cost": int(entry.get("amount") or 0),
                "balance_before": int(entry.get("balance_before") or 0),
                "balance_after": int(entry.get("balance_after") or 0),
                "entry_hash": entry.get("entry_hash"),
                "date": str(entry.get("created_at") or "")
            })

    total_earned = int(glory_state.get("total_earned", 0))
    total_spent = int(glory_state.get("glory_spent", 0))
    spendable = int(glory_state.get("spendable_glory", 0))

    return {
        "success": True,
        "summary": {
            "total_earned": total_earned,
            "earned_glory_total": int(glory_state.get("earned_glory_total", total_earned)),
            "purchased_glory_total": int(glory_state.get("purchased_glory_total", 0)),
            "granted_glory_total": int(glory_state.get("granted_glory_total", 0)),
            "total_spent": total_spent,
            "refunded_glory_total": int(glory_state.get("refunded_glory_total", 0)),
            "spendable_glory": spendable,
            "glory_40k": int(glory_state.get("glory_40k", 0)),
            "glory_aos": int(glory_state.get("glory_aos", 0)),
            "is_balanced": bool(audit_report.get("is_valid", True)) and ((total_earned - total_spent) == spendable),
            "audit_id": audit_report.get("audit_id"),
            "audit_status": audit_report.get("status", "VERIFIED_INTACT"),
            "chain_head_hash": audit_report.get("chain_head_hash", "GENESIS"),
            "transactions_verified": int(audit_report.get("transactions_verified", len(ledger_entries)))
        },
        "audit": audit_report,
        "hash_chain_ledger": ledger_entries,
        "debits": debits,
        "credits": credits
    }

