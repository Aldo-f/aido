from typing import Optional
from datetime import datetime, timedelta

import config
import database

provider_key_index: dict[str, int] = {}
failed_keys: dict[str, set[int]] = {}


def reset():
    provider_key_index.clear()
    failed_keys.clear()


def get_next_key(provider: str) -> tuple[Optional[str], Optional[str]]:
    keys = config.get_provider_keys(provider)
    if not keys:
        return None, None

    if provider not in provider_key_index:
        provider_key_index[provider] = 0
        failed_keys[provider] = set()

    start_idx = provider_key_index[provider]
    checked = 0

    while checked < len(keys):
        idx = (start_idx + checked) % len(keys)

        if not is_key_available(provider, idx):
            checked += 1
            continue

        if idx not in failed_keys.get(provider, set()):
            provider_key_index[provider] = idx
            key_info = keys[idx]
            return key_info.get("key"), key_info.get("name")
        checked += 1

    return None, None


def is_key_available(provider: str, key_index: int) -> bool:
    if not database.DB_FILE.exists():
        return True
    return database.is_key_available(provider, key_index)


def mark_key_failed(
    provider: str,
    status_code: int,
    error_message: str = "",
    retry_after: int | None = None,
):
    if status_code not in (401, 403, 429):
        return

    current_idx = provider_key_index.get(provider, 0)
    keys = config.get_provider_keys(provider)

    if not keys:
        return

    if provider not in failed_keys:
        failed_keys[provider] = set()

    failed_keys[provider].add(current_idx)

    key_hash = _hash_key(keys[current_idx].get("key", ""))

    if database.DB_FILE.exists():
        database.mark_key_failed_db(
            provider=provider,
            key_index=current_idx,
            key_hash=key_hash,
            status_code=status_code,
            error_message=error_message,
            retry_after_seconds=retry_after,
        )

    print(f"[key_manager] Key {current_idx} failed for {provider} (HTTP {status_code})")
    provider_key_index[provider] = (current_idx + 1) % len(keys)


def mark_key_success(provider: str):
    current_idx = provider_key_index.get(provider, 0)

    if database.DB_FILE.exists():
        database.clear_key_failure(provider, current_idx)


def get_current_key_name(provider: str) -> str:
    keys = config.get_provider_keys(provider)
    idx = provider_key_index.get(provider, 0)
    if keys and idx < len(keys):
        return keys[idx].get("name", "default")
    return "unknown"


def _hash_key(key: str) -> str:
    import hashlib

    return hashlib.sha256(key.encode()).hexdigest()[:16] if key else ""


def get_available_key_count(provider: str) -> int:
    keys = config.get_provider_keys(provider)
    if not keys:
        return 0

    available = 0
    for idx in range(len(keys)):
        if is_key_available(provider, idx) and idx not in failed_keys.get(
            provider, set()
        ):
            available += 1

    return available
