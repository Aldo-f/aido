from typing import Optional
from datetime import datetime, timedelta
import hashlib

import config
import database

provider_key_index: dict[str, int] = {}


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16] if key else ""


def reset():
    provider_key_index.clear()


def get_next_key(provider: str) -> tuple[Optional[str], Optional[str]]:
    keys = config.get_provider_keys(provider)
    if not keys:
        return None, None

    if provider not in provider_key_index:
        provider_key_index[provider] = 0

    start_idx = provider_key_index[provider]
    total_keys = len(keys)

    for i in range(total_keys):
        idx = (start_idx + i) % total_keys

        if database.is_key_available(provider, idx):
            provider_key_index[provider] = idx
            key_info = keys[idx]
            return key_info.get("key"), key_info.get("name")

    return None, None


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

    key_hash = _hash_key(keys[current_idx].get("key", ""))

    database.mark_key_failed_db(
        provider=provider,
        key_index=current_idx,
        key_hash=key_hash,
        status_code=status_code,
        error_message=error_message,
        retry_after_seconds=retry_after,
    )

    provider_key_index[provider] = (current_idx + 1) % len(keys)


def mark_key_success(provider: str):
    current_idx = provider_key_index.get(provider, 0)
    database.clear_key_failure(provider, current_idx)


def get_current_key_name(provider: str) -> str:
    keys = config.get_provider_keys(provider)
    idx = provider_key_index.get(provider, 0)
    if keys and idx < len(keys):
        return keys[idx].get("name", "default")
    return "unknown"
