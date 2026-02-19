import json
import os
import httpx
from pathlib import Path
from typing import Any

AIDO_CONFIG_PATH = Path.home() / ".aido-data" / "config.json"

OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")
DMR_ENDPOINT = os.environ.get("DMR_ENDPOINT", "http://localhost:12434")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com"
ZEN_ENDPOINT = "https://opencode.ai/zen"
OPENAI_ENDPOINT = "https://api.openai.com"

AIDO_META_MODELS = [
    "aido/auto",
    "aido/cloud",
    "aido/local",
]

ZEN_MODELS = [
    "big-pickle",
    "minimax-m2.5-free",
    "kimi-k2.5-free",
    "gpt-5-nano",
    "gpt-5.2-codex",
    "gpt-5.2",
    "claude-sonnet-4-5",
    "claude-opus-4-6",
    "gemini-3-pro",
    "gemini-3-flash",
    "glm-5",
    "kimi-k2.5",
    "qwen3-coder",
]

GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
]

OPENAI_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
]


def load_config() -> dict[str, Any]:
    if AIDO_CONFIG_PATH.exists():
        with open(AIDO_CONFIG_PATH) as f:
            return json.load(f)
    return {"providers": {}}


def get_provider_keys(provider: str) -> list[dict[str, str]]:
    config = load_config()
    provider_config = config.get("providers", {}).get(provider, {})
    keys = provider_config.get("keys", [])
    if keys:
        return keys
    single_key = provider_config.get("key")
    if single_key:
        return [{"key": single_key, "name": "default"}]
    env_var = f"{provider.upper().replace('-', '_')}_API_KEY"
    env_key = os.environ.get(env_var)
    if env_key:
        return [{"key": env_key, "name": "env"}]
    return []


def get_selection_mode() -> str:
    config = load_config()
    return config.get("selection", {}).get("default_mode", "cloud_first") or config.get(
        "model_preference", "cloud_first"
    )


async def check_ollama() -> tuple[bool, list[str]]:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_ENDPOINT}/api/tags")
            if resp.status_code == 200:
                models = [m["name"] for m in resp.json().get("models", [])]
                return True, models
    except Exception:
        pass
    return False, []


async def check_dmr() -> tuple[bool, list[str]]:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{DMR_ENDPOINT}/v1/models")
            if resp.status_code == 200:
                models = [m["id"] for m in resp.json().get("data", [])]
                return True, models
    except Exception:
        pass
    return False, []


async def get_provider_status() -> dict[str, dict]:
    ollama_running, ollama_models = await check_ollama()
    dmr_running, dmr_models = await check_dmr()

    return {
        "opencode-zen": {
            "enabled": True,
            "keys": len(get_provider_keys("opencode-zen")),
            "models": ZEN_MODELS,
            "status": "ready" if get_provider_keys("opencode-zen") else "no_keys",
        },
        "gemini": {
            "enabled": True,
            "keys": len(get_provider_keys("gemini")),
            "models": GEMINI_MODELS,
            "status": "ready" if get_provider_keys("gemini") else "no_keys",
        },
        "openai": {
            "enabled": True,
            "keys": len(get_provider_keys("openai")),
            "models": OPENAI_MODELS,
            "status": "ready" if get_provider_keys("openai") else "no_keys",
        },
        "ollama": {
            "enabled": True,
            "endpoint": OLLAMA_ENDPOINT,
            "models": ollama_models,
            "status": "running" if ollama_running else "not_running",
        },
        "docker-model-runner": {
            "enabled": True,
            "endpoint": DMR_ENDPOINT,
            "models": dmr_models,
            "status": "running" if dmr_running else "not_running",
        },
    }
