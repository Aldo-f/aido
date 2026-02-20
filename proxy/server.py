#!/usr/bin/env python3
"""
AIDO Proxy Server - FastAPI
Multi-provider proxy with key rotation and automatic fallback
"""

import json
import os
import sys
import signal
import asyncio
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response
import uvicorn
import httpx

sys.path.insert(0, str(Path(__file__).parent))

import config
import key_manager
import database
from providers.zen import ZenProvider
from providers.gemini import GeminiProvider
from providers.openai import OpenAIProvider
from providers.ollama import OllamaProvider
from providers.dmr import DMRProvider

app = FastAPI(title="AIDO Proxy")

DEFAULT_PORT = int(os.environ.get("AIDO_PORT", "11999"))

DATA_DIR = Path.home() / ".aido-data"
LOG_FILE = DATA_DIR / "logs" / "proxy.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

zen_provider = ZenProvider()
gemini_provider = GeminiProvider()
openai_provider = OpenAIProvider()
ollama_provider = OllamaProvider()
dmr_provider = DMRProvider()

CLOUD_PROVIDERS = [
    ("opencode-zen", zen_provider),
    ("gemini", gemini_provider),
    ("openai", openai_provider),
]

LOCAL_PROVIDERS = [
    ("ollama", ollama_provider),
    ("docker-model-runner", dmr_provider),
]


def log(msg: str, level: str = "INFO"):
    timestamp = import_datetime_now().isoformat()
    log_line = f"[{timestamp}] [{level}] {msg}"
    print(log_line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(log_line + "\n")
    except Exception:
        pass


def get_session_provider(session_id: str | None) -> tuple[str | None, str | None]:
    """Get cached provider and model for a session."""
    if not session_id:
        return None, None

    sessions_dir = Path.home() / ".aido-data" / "sessions"
    session_file = sessions_dir / f"session-{session_id}.json"

    if session_file.exists():
        try:
            with open(session_file) as f:
                session_data = json.load(f)
            return session_data.get("cached_provider"), session_data.get("cached_model")
        except Exception:
            pass

    return None, None


def update_session_provider(session_id: str | None, provider: str, model: str):
    """Update cached provider and model for a session."""
    if not session_id:
        return

    sessions_dir = Path.home() / ".aido-data" / "sessions"
    session_file = sessions_dir / f"session-{session_id}.json"

    if session_file.exists():
        try:
            with open(session_file) as f:
                session_data = json.load(f)
            session_data["cached_provider"] = provider
            session_data["cached_model"] = model
            with open(session_file, "w") as f:
                json.dump(session_data, f, indent=2)
        except Exception:
            pass


def import_datetime_now():
    import datetime

    return datetime.datetime.now()


@app.get("/health")
async def health():
    status = await config.get_provider_status()
    running = [k for k, v in status.items() if v.get("status") in ("running", "ready")]
    return {"status": "ok", "providers": running}


@app.get("/v1/models")
async def list_models():
    status = await config.get_provider_status()
    models = []

    for meta_model in config.AIDO_META_MODELS:
        models.append(
            {
                "id": meta_model,
                "object": "model",
                "created": 0,
                "owned_by": "aido",
            }
        )

    for provider, info in status.items():
        if info.get("status") in ("running", "ready"):
            provider_models = info.get("models", [])
            for model_name in provider_models:
                models.append(
                    {
                        "id": model_name,
                        "object": "model",
                        "created": 0,
                        "owned_by": provider,
                    }
                )

    return {"object": "list", "data": models}


@app.post("/v1/chat/completions")
@app.post("/chat/completions")
async def chat_completions(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    model = body.get("model", "aido/auto")
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    session_id = body.get("session_id")

    log(
        f"Request: model={model}, stream={stream}, session={session_id}, msgs={len(messages)}"
    )

    try:
        resolved_model, provider_type = resolve_model(model)

        if provider_type == "cloud":
            return await handle_cloud_chat(
                resolved_model, messages, stream, session_id=session_id
            )
        elif provider_type == "local":
            return await handle_local_chat(
                resolved_model, messages, stream, session_id=session_id
            )
        else:
            return await handle_auto_chat(
                model, messages, stream, session_id=session_id
            )
    except Exception as e:
        log(f"Error in chat_completions: {e}", "ERROR")
        return JSONResponse({"error": str(e)}, status_code=500)


def resolve_model(model: str) -> tuple[str, str]:
    model = model.strip()

    if model.startswith("aido/"):
        suffix = model.replace("aido/", "")
        if suffix == "auto":
            return "auto", "auto"
        elif suffix == "cloud":
            return "cloud", "cloud"
        elif suffix == "local":
            return "local", "local"

    if model in ("auto", "cloud", "local"):
        return model, model

    if model in config.ZEN_MODELS:
        return model, "zen"
    if model in config.GEMINI_MODELS:
        return model, "gemini"
    if model in config.OPENAI_MODELS:
        return model, "openai"

    if model.startswith("ollama/"):
        return model.replace("ollama/", ""), "ollama"

    return model, "unknown"


async def handle_auto_chat(
    model: str,
    messages: list[dict],
    stream: bool,
    return_metadata: bool = False,
    session_id: str | None = None,
):
    selection_mode = config.get_selection_mode()
    log(f"Auto mode: {selection_mode}")

    if selection_mode == "local_first":
        result = await try_providers(
            LOCAL_PROVIDERS + CLOUD_PROVIDERS,
            model,
            messages,
            stream,
            return_metadata=return_metadata,
            session_id=session_id,
        )
    else:
        result = await try_providers(
            CLOUD_PROVIDERS + LOCAL_PROVIDERS,
            model,
            messages,
            stream,
            return_metadata=return_metadata,
            session_id=session_id,
        )

    if result:
        return result

    error_data: dict[str, Any] = {"error": "No providers available"}
    if return_metadata:
        error_data["model"] = model
        error_data["provider"] = "none"
    return JSONResponse(error_data, status_code=503)


async def handle_cloud_chat(
    model: str,
    messages: list[dict],
    stream: bool,
    return_metadata: bool = False,
    session_id: str | None = None,
):
    result = await try_providers(
        CLOUD_PROVIDERS,
        model,
        messages,
        stream,
        return_metadata=return_metadata,
        session_id=session_id,
    )

    if result:
        return result

    error_data: dict[str, Any] = {"error": "No cloud providers available"}
    if return_metadata:
        error_data["model"] = model
        error_data["provider"] = "none"
    return JSONResponse(error_data, status_code=503)


async def handle_local_chat(
    model: str,
    messages: list[dict],
    stream: bool,
    return_metadata: bool = False,
    session_id: str | None = None,
):
    result = await try_providers(
        LOCAL_PROVIDERS,
        model,
        messages,
        stream,
        return_metadata=return_metadata,
        session_id=session_id,
    )

    if result:
        return result

    error_data: dict[str, Any] = {"error": "No local providers available"}
    if return_metadata:
        error_data["model"] = model
        error_data["provider"] = "none"
    return JSONResponse(error_data, status_code=503)


def is_meta_model(model: str) -> bool:
    return model.startswith("aido/") or model in ("auto", "cloud", "local")


async def safe_stream_wrapper(
    generator: AsyncGenerator[str, None],
    provider_name: str,
    session_id: str | None = None,
) -> AsyncGenerator[str, None]:
    """Wrap a streaming generator to handle errors gracefully."""
    try:
        async for chunk in generator:
            yield chunk
    except Exception as e:
        error_str = str(e)
        log(f"Streaming error from {provider_name}: {error_str}", "ERROR")
        if "401" in error_str or "403" in error_str or "429" in error_str:
            try:
                status_code = int(error_str.split()[0])
                key_manager.mark_key_failed(provider_name, status_code, error_str)
            except (ValueError, IndexError):
                pass
        yield f'{{"error": "{error_str}"}}\n\n'
        yield "data: [DONE]\n\n"


async def try_providers(
    providers: list,
    model: str,
    messages: list[dict],
    stream: bool,
    failed_provider: str | None = None,
    return_metadata: bool = False,
    session_id: str | None = None,
) -> Response | JSONResponse | StreamingResponse | None:
    cached_provider, cached_model = get_session_provider(session_id)

    if cached_provider:
        log(f"Using cached provider: {cached_provider} (model: {cached_model})")
        for i, (provider_name, provider) in enumerate(providers):
            if provider_name == cached_provider:
                api_key = None
                if provider_name in ("opencode-zen", "gemini", "openai"):
                    api_key, key_name = key_manager.get_next_key(provider_name)
                    if not api_key:
                        log(f"No keys for {cached_provider}, trying other providers")
                        break

                model_to_use = cached_model or provider.default_model
                try:
                    log(f"Trying cached {provider_name} with model {model_to_use}")

                    disable_cloud_streaming = (
                        stream
                        and provider_name in ("opencode-zen", "openai")
                        and (model in ("auto", "local") or is_meta_model(model))
                    )

                    if stream and provider_name not in ("opencode-zen", "openai"):
                        generator = await provider.chat(
                            messages, model_to_use, True, api_key
                        )
                        return StreamingResponse(
                            safe_stream_wrapper(generator, provider_name, session_id),
                            media_type="text/event-stream",
                        )
                    else:
                        use_stream_for_provider = stream and not disable_cloud_streaming
                        result = await provider.chat(
                            messages, model_to_use, use_stream_for_provider, api_key
                        )

                        key_manager.mark_key_success(provider_name)

                        if isinstance(result, dict):
                            if return_metadata:
                                result["model"] = model_to_use
                                result["provider"] = provider_name
                            update_session_provider(
                                session_id, provider_name, model_to_use
                            )
                            return JSONResponse(result)
                        elif isinstance(result, AsyncGenerator):
                            update_session_provider(
                                session_id, provider_name, model_to_use
                            )
                            return StreamingResponse(
                                result,
                                media_type="text/event-stream",
                            )
                except Exception as e:
                    log(f"Cached provider {provider_name} failed: {e}")
                    if "401" in str(e) or "403" in str(e) or "429" in str(e):
                        try:
                            status_code = int(str(e).split()[0])
                            key_manager.mark_key_failed(
                                provider_name, status_code, str(e)
                            )
                        except (ValueError, IndexError):
                            pass
                    break

    for provider_name, provider in providers:
        if failed_provider and provider_name == failed_provider:
            continue
        if cached_provider and provider_name == cached_provider:
            continue

        api_key = None
        if provider_name in ("opencode-zen", "gemini", "openai"):
            api_key, key_name = key_manager.get_next_key(provider_name)
            if not api_key:
                log(f"No keys for {provider_name}, skipping")
                continue

            model_to_use = provider.default_model if is_meta_model(model) else model
        else:
            model_to_use = provider.default_model if is_meta_model(model) else model

        try:
            log(f"Trying {provider_name} with model {model_to_use}")

            disable_cloud_streaming = (
                stream
                and provider_name in ("opencode-zen", "openai")
                and (model in ("auto", "local") or is_meta_model(model))
            )

            if (
                stream
                and provider_name in ("opencode-zen", "openai")
                and not disable_cloud_streaming
            ):
                generator = await provider.chat(messages, model_to_use, True, api_key)
                update_session_provider(session_id, provider_name, model_to_use)
                return StreamingResponse(
                    safe_stream_wrapper(generator, provider_name, session_id),
                    media_type="text/event-stream",
                )
            else:
                use_stream_for_provider = stream and not disable_cloud_streaming
                result = await provider.chat(
                    messages, model_to_use, use_stream_for_provider, api_key
                )

                key_manager.mark_key_success(provider_name)

                if isinstance(result, dict):
                    if return_metadata:
                        result["model"] = model_to_use
                        result["provider"] = provider_name
                    update_session_provider(session_id, provider_name, model_to_use)
                    return JSONResponse(result)
                elif isinstance(result, AsyncGenerator):
                    update_session_provider(session_id, provider_name, model_to_use)
                    return StreamingResponse(
                        result,
                        media_type="text/event-stream",
                    )

        except Exception as e:
            error_str = str(e)
            log(f"{provider_name} failed: {error_str}")

            if "401" in error_str or "403" in error_str or "429" in error_str:
                try:
                    status_code = int(error_str.split()[0])
                    key_manager.mark_key_failed(provider_name, status_code, error_str)
                except (ValueError, IndexError):
                    pass

            continue

    return None


async def stream_provider(
    provider,
    messages: list[dict],
    model: str,
    api_key: str | None = None,
) -> AsyncGenerator[str, None]:
    try:
        async for chunk in provider.chat(messages, model, True, api_key):
            if chunk:
                yield chunk
    except Exception as e:
        yield f'{{"error": "{str(e)}"}}\n\n'
    finally:
        yield "data: [DONE]\n\n"


@app.post("/v1/query")
async def simple_query(request: Request):
    import time

    start_time = time.time()

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    query = body.get("query", "")
    model = body.get("model", "aido/auto")
    stream = body.get("stream", False)
    session_id = body.get("session_id")

    if not query:
        return JSONResponse({"error": "Query is required"}, status_code=400)

    log(
        f"Query: model={model}, stream={stream}, session={session_id}, query={query[:50]}..."
    )

    messages = [{"role": "user", "content": query}]

    try:
        resolved_model, provider_type = resolve_model(model)

        if provider_type == "cloud":
            result = await handle_cloud_chat(
                resolved_model,
                messages,
                stream,
                return_metadata=True,
                session_id=session_id,
            )
        elif provider_type == "local":
            result = await handle_local_chat(
                resolved_model,
                messages,
                stream,
                return_metadata=True,
                session_id=session_id,
            )
        else:
            result = await handle_auto_chat(
                model, messages, stream, return_metadata=True, session_id=session_id
            )

        end_time = time.time()
        response_time_ms = int((end_time - start_time) * 1000)

        if result is None:
            return JSONResponse(
                {"error": "No providers available", "query": query}, status_code=503
            )

        if isinstance(result, StreamingResponse):

            async def add_metadata():
                async for chunk in result.body_iterator:
                    yield chunk

            return StreamingResponse(
                add_metadata(),
                media_type="text/event-stream",
            )

        if isinstance(result, JSONResponse):
            body_content = getattr(result, "body", b"{}")
            if hasattr(body_content, "decode"):
                body_str = body_content.decode()
            else:
                body_str = str(body_content)
            try:
                response_body = json.loads(body_str)
            except Exception:
                response_body = {"response": body_str}
            response_body["response_time_ms"] = response_time_ms
            response_body["query"] = query
            return JSONResponse(response_body, status_code=result.status_code)

        if isinstance(result, dict):
            result["response_time_ms"] = response_time_ms
            result["query"] = query
            return JSONResponse(result)

        return result

    except Exception as e:
        log(f"Error in query: {e}", "ERROR")
        return JSONResponse({"error": str(e), "query": query}, status_code=500)


def run_server(port: int = DEFAULT_PORT):
    database.init_db()
    key_manager.reset()
    log(f"Starting AIDO server on port {port}")

    config_data = config.load_config()
    providers = config_data.get("providers", {})
    keys_count = sum(len(config.get_provider_keys(p)) for p in providers)
    log(f"Configured providers: {len(providers)}, Total keys: {keys_count}")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    port = DEFAULT_PORT
    if len(sys.argv) > 1 and sys.argv[1] == "--port":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT

    run_server(port)
