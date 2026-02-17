#!/usr/bin/env python3
"""
AIDO Proxy - Transparent proxy for intelligent model selection
OpenAI-compatible API that automatically selects the best model
"""

import os
import sys
import json
import signal
import socket
import threading
import datetime
import uuid
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Add proxy directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))
import database

# Configuration
DEFAULT_PORT = 11999
DATA_DIR = Path(os.path.expanduser("~/.aido-data"))
CONFIG_FILE = DATA_DIR / "config.json"
PID_FILE = DATA_DIR / "aido-proxy.pid"
LOG_FILE = DATA_DIR / "logs" / "proxy.log"

# Initialize database
database.init_db()

# Check both DATA_DIR and SCRIPT_DIR for config
SCRIPT_DIR = Path(__file__).parent.resolve()
if not (DATA_DIR / "config.json").exists():
    # Use SCRIPT_DIR as fallback for config
    DATA_DIR = SCRIPT_DIR.parent

# Provider endpoints
OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")
DMR_ENDPOINT = os.environ.get("DMR_ENDPOINT", "http://localhost:12434")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com"
OPENCODE_ZEN_ENDPOINT = "https://opencode.ai/zen"

# Default models for OpenCode Zen (free models first)
OPENCODE_ZEN_MODELS = [
    "big-pickle",  # Free
    "minimax-m2.5-free",  # Free
    "kimi-k2.5-free",  # Free
    "gpt-5-nano",  # Free
    "gpt-5.2-codex",  # Paid
    "gpt-5.2",  # Paid
    "claude-sonnet-4-5",  # Paid
    "claude-opus-4-6",  # Paid
    "gemini-3-pro",  # Paid
    "gemini-3-flash",  # Paid
    "glm-5",  # Paid
    "kimi-k2.5",  # Paid
    "qwen3-coder",  # Paid
]

# Key rotation state
provider_key_index = {}  # {provider_name: current_key_index}
failed_keys = {}  # {provider_name: set of failed key indices}

# Ensure log directory exists
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)


def log(message, level="INFO"):
    """Log message to both stdout and file"""
    timestamp = datetime.datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(log_line + "\n")
    except Exception as e:
        print(f"[WARN] Could not write to log file: {e}")


def get_provider_keys(provider_name: str) -> list:
    """Get list of API keys for a provider from config.

    Supports two formats:
    - "key": "single-api-key" (backwards compatible)
    - "keys": [{"key": "...", "name": "optional"}, ...]
    """
    config = load_config()
    provider = config.get("providers", {}).get(provider_name, {})

    # Single key format (backwards compatible)
    if "key" in provider:
        return [{"key": provider["key"], "name": "default"}]

    # Multiple keys format
    keys = provider.get("keys", [])
    if keys:
        return keys

    # Check environment variable
    env_key = os.environ.get(f"{provider_name.upper()}_API_KEY")
    if env_key:
        return [{"key": env_key, "name": "env"}]

    return []


def get_current_key_index(provider_name: str) -> int:
    """Get current key index for provider"""
    return provider_key_index.get(provider_name, 0)


def get_next_key(provider_name: str) -> tuple[str | None, str | None]:
    """Get next available key for provider.

    Returns:
        (api_key, key_name) or (None, None) if no keys available
    """
    keys = get_provider_keys(provider_name)
    if not keys:
        return None, None

    # Initialize key index if needed
    if provider_name not in provider_key_index:
        provider_key_index[provider_name] = 0
        failed_keys[provider_name] = set()

    # Try keys in order, skipping failed ones
    start_idx = provider_key_index[provider_name]
    checked = 0

    while checked < len(keys):
        idx = (start_idx + checked) % len(keys)

        if idx not in failed_keys.get(provider_name, set()):
            provider_key_index[provider_name] = idx
            key_info = keys[idx]
            return key_info.get("key"), key_info.get("name")

        checked += 1

    log(f"All keys failed for provider: {provider_name}", "WARN")
    return None, None


def mark_key_failed(provider_name: str, status_code: int):
    """Mark current key as failed based on error code.

    Skip on:
    - 401: Invalid/expired key
    - 403: Forbidden
    - 429: Rate limited
    """
    if status_code in (401, 403, 429):
        current_idx = get_current_key_index(provider_name)
        if provider_name not in failed_keys:
            failed_keys[provider_name] = set()
        failed_keys[provider_name].add(current_idx)
        log(f"Key {current_idx} marked failed for {provider_name} (HTTP {status_code})")

        # Reset to try next key
        provider_key_index[provider_name] = (current_idx + 1) % len(
            get_provider_keys(provider_name)
        )


def reset_failed_keys(provider_name: str):
    """Reset failed keys state for provider (call on startup)"""
    if provider_name in failed_keys:
        failed_keys[provider_name].clear()
    provider_key_index[provider_name] = 0


def load_config():
    """Load AIDO configuration"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {
        "providers": {
            "ollama": {"enabled": True, "priority": 1, "endpoint": OLLAMA_ENDPOINT},
            "docker-model-runner": {
                "enabled": True,
                "priority": 2,
                "endpoint": DMR_ENDPOINT,
            },
            "opencode-zen": {
                "enabled": True,
                "priority": 1,
                "endpoint": OPENCODE_ZEN_ENDPOINT,
                "keys": [],
            },
            "gemini": {
                "enabled": True,
                "priority": 2,
                "endpoint": GEMINI_ENDPOINT,
                "keys": [],
            },
            "cloud": {
                "enabled": False,
                "priority": 10,
                "endpoint": "https://api.openai.com",
            },
        },
        "proxy": {"enabled": True, "port": DEFAULT_PORT, "default_model": "auto"},
        "model_preference": "local_first",  # "cloud_first", "local_first", or "auto"
        "api_mode": "generate",  # "chat" or "generate"
    }


def get_model_preference():
    """Get model preference from config"""
    config = load_config()
    # Support both "model_preference" and "selection.default_mode" keys
    return config.get("model_preference") or config.get("selection", {}).get(
        "default_mode", "cloud_first"
    )


def get_api_mode():
    """Get API mode from config: chat or generate
    Default is 'generate' for more detailed responses"""
    config = load_config()
    return config.get("api_mode", "generate")


def detect_providers():
    """Detect available providers"""
    log("Detecting available providers...")
    config = load_config()
    providers = config.get("providers", {})

    available = {}

    # Check Ollama
    try:
        req = urllib.request.Request(f"{OLLAMA_ENDPOINT}/api/tags")
        with urllib.request.urlopen(req, timeout=2) as resp:
            models = json.load(resp).get("models", [])
            model_names = [m["name"] for m in models]
            available["ollama"] = {
                "endpoint": OLLAMA_ENDPOINT,
                "models": model_names,
                "status": "running",
            }
            log(f"Ollama: running, {len(model_names)} models: {model_names}")
    except Exception as e:
        available["ollama"] = {
            "status": "not running",
            "models": [],
            "endpoint": OLLAMA_ENDPOINT,
        }
        log(f"Ollama: not running - {e}", "WARN")

    # Check Docker Model Runner
    try:
        req = urllib.request.Request(f"{DMR_ENDPOINT}/models")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.load(resp)

            # Handle different response formats
            model_names = []
            if isinstance(data, list):
                # Direct list response
                raw_models = data
            elif isinstance(data, dict):
                # Dict with "data" key
                raw_models = data.get("data", [])
            else:
                raw_models = []

            for m in raw_models:
                if isinstance(m, dict):
                    # Try "id" or "tags" for model name
                    model_id = m.get("id")
                    if not model_id and m.get("tags"):
                        model_id = m["tags"][0] if m["tags"] else None
                    if model_id:
                        model_names.append(model_id)
                elif isinstance(m, str):
                    model_names.append(m)

            available["docker-model-runner"] = {
                "endpoint": DMR_ENDPOINT,
                "models": model_names,
                "status": "running",
            }
            log(f"DMR: running, {len(model_names)} models: {model_names}")
    except Exception as e:
        available["docker-model-runner"] = {
            "status": "not running",
            "models": [],
            "endpoint": DMR_ENDPOINT,
        }
        log(f"DMR: not running - {e}", "WARN")

    # Check OpenCode Zen
    provider_config = providers.get("opencode-zen", {})
    zen_endpoint = provider_config.get("endpoint") or OPENCODE_ZEN_ENDPOINT
    if provider_config.get("enabled", True):
        keys = get_provider_keys("opencode-zen")
        if keys:
            # Try to get models from database first
            stored_models = []
            try:
                stored_models = database.get_provider_models("opencode-zen")
            except:
                pass

            # Use stored models from first available key, or fallback to default
            models = OPENCODE_ZEN_MODELS
            if stored_models:
                # Get models from first key
                first_key_hash = keys[0][:8]  # Use first 8 chars of key as hash
                if first_key_hash in stored_models:
                    models = stored_models[first_key_hash]
                    log(
                        f"OpenCode Zen: using stored models from database: {len(models)} models"
                    )

            available["opencode-zen"] = {
                "endpoint": zen_endpoint,
                "models": models,
                "status": "running",
                "keys": keys,
            }
            log(f"OpenCode Zen: running, {len(keys)} key(s)")
        else:
            available["opencode-zen"] = {
                "status": "no keys",
                "models": [],
                "endpoint": zen_endpoint,
            }
            log("OpenCode Zen: no API keys configured", "WARN")
    else:
        available["opencode-zen"] = {
            "status": "disabled",
            "models": [],
            "endpoint": zen_endpoint,
        }

    # Check Google Gemini
    provider_config = providers.get("gemini", {})
    gemini_endpoint = provider_config.get("endpoint") or GEMINI_ENDPOINT
    if provider_config.get("enabled", True):
        keys = get_provider_keys("gemini")
        if keys:
            available["gemini"] = {
                "endpoint": gemini_endpoint,
                "models": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
                "status": "running",
                "keys": keys,
            }
            log(f"Gemini: running, {len(keys)} key(s)")
        else:
            available["gemini"] = {
                "status": "no keys",
                "models": [],
                "endpoint": gemini_endpoint,
            }
            log("Gemini: no API keys configured", "WARN")
    else:
        available["gemini"] = {
            "status": "disabled",
            "models": [],
            "endpoint": gemini_endpoint,
        }

    return available


def analyze_prompt(prompt):
    """Analyze prompt to determine best model"""
    prompt_lower = prompt.lower()

    # Detect capabilities
    capabilities = []

    if any(
        w in prompt_lower
        for w in [
            "code",
            "programming",
            "debug",
            "fix",
            "function",
            "script",
            "write",
            "create",
            "implement",
            "build",
            "hello world",
        ]
    ):
        capabilities.append("coding")

    if any(
        w in prompt_lower
        for w in ["image", "picture", "visual", "diagram", "photo", "wat zie"]
    ):
        capabilities.append("vision")

    if any(
        w in prompt_lower for w in ["explain", "analyze", "compare", "think", "reason"]
    ):
        capabilities.append("reasoning")

    if not capabilities:
        capabilities = ["general"]

    return capabilities


# Classification cache
CLASSIFICATION_CACHE = {}
CLASSIFICATION_CACHE_TTL = 300  # 5 minutes


def classify_with_model(prompt, model="llama3.2:latest"):
    """Use a lightweight model to classify the query type

    Returns: coding, general, vision, reasoning
    """
    # Check cache first
    cache_key = f"model:{hash(prompt)}"
    if cache_key in CLASSIFICATION_CACHE:
        cached_time, cached_result = CLASSIFICATION_CACHE[cache_key]
        if (
            datetime.datetime.now() - cached_time
        ).total_seconds() < CLASSIFICATION_CACHE_TTL:
            log(f"Using cached model classification: {cached_result}")
            return cached_result

    classification_prompt = f"""Classify this query. Reply with only ONE word:
- coding: for programming, debugging, code questions
- vision: for image, visual, diagram questions  
- reasoning: for complex analysis, comparison, thinking
- general: for simple questions

Query: {prompt[:200]}

Reply with only one word:"""

    try:
        result, _ = forward_request(
            OLLAMA_ENDPOINT,
            "/api/generate",
            json.dumps(
                {
                    "model": model,
                    "prompt": classification_prompt,
                    "stream": False,
                    "options": {"temperature": 0.1},
                }
            ),
            provider_name="ollama",
        )

        response = json.loads(result)
        content = response.get("response", "").strip().lower()

        classification = content.split()[0] if content else "general"

        if classification in ["coding", "vision", "reasoning", "general"]:
            CLASSIFICATION_CACHE[cache_key] = (datetime.datetime.now(), classification)
            return classification

        if "code" in content or "program" in content:
            result = "coding"
        elif "image" in content or "visual" in content:
            result = "vision"
        elif "think" in content or "analyz" in content or "reason" in content:
            result = "reasoning"
        else:
            result = "general"

        CLASSIFICATION_CACHE[cache_key] = (datetime.datetime.now(), result)
        return result

    except Exception as e:
        log(f"Model classification failed: {e}", "WARN")
        return "general"


def classify_query(prompt):
    """Classify query - uses model classifier only when keywords detect 'general'

    This is the smart hybrid approach:
    - Keywords are fast, use them first
    - Model classifier only for ambiguous cases (general)
    """
    keywords_result = analyze_prompt(prompt)

    # If keywords detected something specific, use it
    if keywords_result and keywords_result[0] != "general":
        return {
            "method": "keywords",
            "capability": keywords_result[0],
            "all": keywords_result,
        }

    # Keywords returned "general" - use model classifier for better detection
    model_result = classify_with_model(prompt)

    return {
        "method": "model",
        "capability": model_result,
        "keywords_fallback": keywords_result,
    }


def find_model_provider(model_name):
    """Find provider and endpoint for a specific model"""
    available = detect_providers()

    for name, info in available.items():
        if info.get("status") != "running" or not info.get("models"):
            continue
        if model_name in info["models"]:
            return model_name, name, info["endpoint"]

    return None, None, None


def select_model(prompt, provider_hint=None):
    """Select best model for the given prompt"""
    log(f"Selecting model for prompt (length: {len(prompt)} chars)")
    available = detect_providers()
    preference = get_model_preference()
    log(f"Model preference: {preference}")

    failed_models = database.get_failed_models(min_failures=2, hours=1)
    failed_model_names = [m["model_name"] for m in failed_models]
    if failed_model_names:
        log(f"Skipping failed models: {failed_model_names}")
    else:
        failed_model_names = []

    if not available or all(p.get("status") != "running" for p in available.values()):
        log("No providers running, attempting fallback to llama3.2", "ERROR")
        try:
            return "llama3.2", "ollama", OLLAMA_ENDPOINT
        except:
            return None, None, None

    # Determine cloud vs local providers based on API keys
    # Cloud providers: have keys (opencode-zen, gemini, cloud)
    # Local providers: no keys (ollama, docker-model-runner)
    cloud_providers = []
    local_providers = []

    for name, info in available.items():
        if info.get("status") != "running" or not info.get("models"):
            continue
        if info.get("keys"):  # Has API keys = cloud provider
            cloud_providers.append((name, info))
        else:  # No keys = local provider
            local_providers.append((name, info))

    log(f"Cloud providers: {[p[0] for p in cloud_providers]}")
    log(f"Local providers: {[p[0] for p in local_providers]}")

    # Select based on preference
    if preference == "cloud_first":
        # Try cloud first, then local fallback
        providers_to_try = cloud_providers + local_providers
    elif preference == "local_first":
        # Try local first, then cloud fallback
        providers_to_try = local_providers + cloud_providers
    else:  # "auto" - smart pick: use cloud if available, else local
        providers_to_try = cloud_providers if cloud_providers else local_providers

    # Find first available model from providers
    for name, info in providers_to_try:
        models = info["models"]
        # Filter out failed models
        models = [m for m in models if m not in failed_model_names]
        if models:
            model = models[0]
            model_type = "cloud" if name in [p[0] for p in cloud_providers] else "local"
            log(f"Selected model: {model} ({model_type}) from provider: {name}")
            return model, name, info["endpoint"]

    log("No models available from any provider", "ERROR")
    return None, None, None


def select_model_by_type(prompt, model_type="auto"):
    """Select model based on type hint: auto, cloud, local

    Args:
        prompt: The user prompt
        model_type: "auto", "cloud", or "local"

    Returns:
        tuple: (model_name, provider_name, endpoint)
    """
    log(f"Selecting model for type: {model_type}")
    available = detect_providers()

    # Determine cloud vs local providers
    cloud_providers = []
    local_providers = []

    for name, info in available.items():
        if info.get("status") != "running" or not info.get("models"):
            continue
        if info.get("keys"):  # Has API keys = cloud provider
            cloud_providers.append((name, info))
        else:  # No keys = local provider
            local_providers.append((name, info))

    failed_models = database.get_failed_models(min_failures=2, hours=1)
    failed_model_names = [m["model_name"] for m in failed_models]

    # Select providers based on type
    if model_type == "cloud":
        providers_to_try = cloud_providers
    elif model_type == "local":
        providers_to_try = local_providers
    else:  # auto
        # Use preference from config
        preference = get_model_preference()
        if preference == "cloud_first":
            providers_to_try = cloud_providers + local_providers
        elif preference == "local_first":
            providers_to_try = local_providers + cloud_providers
        else:  # auto
            providers_to_try = cloud_providers if cloud_providers else local_providers

    # Find first available model
    for name, info in providers_to_try:
        models = info["models"]
        models = [m for m in models if m not in failed_model_names]
        if models:
            selected_model = models[0]
            log(f"Selected model: {selected_model} from provider: {name}")
            return selected_model, name, info["endpoint"]

    log(f"No models available for type: {model_type}", "ERROR")
    return None, None, None


def get_fallback_model(current_model=None):
    """Get a fallback model (local model) when primary fails"""
    available = detect_providers()
    cloud_suffixes = ["-cloud", ":cloud"]

    for name, info in available.items():
        if info.get("status") == "running" and info.get("models"):
            models = info["models"]
            # Prefer local models
            local_models = [
                m for m in models if not any(s in m for s in cloud_suffixes)
            ]
            if local_models:
                # Skip current model if provided
                for m in local_models:
                    if m != current_model:
                        log(f"Fallback model: {m} (local) from provider: {name}")
                        return m, name, info["endpoint"]
            # If no local, try any other model
            for m in models:
                if m != current_model:
                    log(f"Fallback model: {m} from provider: {name}")
                    return m, name, info["endpoint"]

    return None, None, None


def forward_request(
    endpoint, path, data, stream=False, api_key=None, provider_name=None
):
    """Forward request to provider

    Returns:
        tuple: (response_body, status_code)
    """
    url = f"{endpoint}{path}"

    request_id = str(uuid.uuid4())[:8]
    log(f"[{request_id}] Forwarding request to {url}")

    headers = {"Content-Type": "application/json"}

    # Add API key if provided
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        url, data=data.encode() if data else None, headers=headers, method="POST"
    )

    try:
        start_time = datetime.datetime.now()
        status_code = 200
        # Use appropriate timeout - 60s for local providers (Ollama can be slow), 30s for cloud
        is_local = "localhost" in endpoint or "127.0.0.1" in endpoint
        timeout = 300 if stream else (60 if is_local else 30)
        if stream:
            response = urllib.request.urlopen(req, timeout=timeout)
        else:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                response = resp.read().decode()
                status_code = resp.status

        duration = (datetime.datetime.now() - start_time).total_seconds()
        log(f"[{request_id}] Request successful ({duration:.2f}s)")
        return response, status_code
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        log(
            f"[{request_id}] HTTP Error {e.code}: {e.reason} - {error_body[:200]}",
            "ERROR",
        )

        # Mark key as failed for rate limiting (429) or auth errors (401/403)
        if provider_name and e.code in (401, 403, 429):
            mark_key_failed(provider_name, e.code)

        return json.dumps(
            {"error": f"HTTP {e.code}: {e.reason}", "detail": error_body[:500]}
        ), e.code
    except Exception as e:
        log(
            f"[{request_id}] Request failed: {type(e).__name__}: {str(e)[:200]}",
            "ERROR",
        )
        return json.dumps({"error": str(e)}), 500


class AIDOProxyHandler(BaseHTTPRequestHandler):
    """HTTP handler for AIDO Proxy"""

    def log_message(self, format, *args):
        """Custom logging"""
        log(f"HTTP: {args[0]}")

    def do_GET(self):
        """Handle GET requests"""
        log(f"GET {self.path}")
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/models" or path == "/v1/models":
            self.send_models_list()
        elif path == "/health":
            self.send_health()
        elif path == "/":
            self.send_welcome()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """Handle POST requests"""
        request_id = str(uuid.uuid4())[:8]
        log(f"[{request_id}] POST {self.path}")

        parsed = urlparse(self.path)
        path = parsed.path

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else ""

        # Log request info (truncated for privacy)
        body_preview = body[:200] if body else ""
        log(f"[{request_id}] Request body: {body_preview}...")

        if path == "/chat/completions" or path == "/v1/chat/completions":
            self.handle_chat_completions(body, request_id)
        elif path == "/completions" or path == "/v1/completions":
            self.handle_completions(body, request_id)
        else:
            log(f"[{request_id}] 404 Not Found", "WARN")
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        """Send JSON response"""
        response = json.dumps(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response.encode())

    def send_models_list(self):
        """Send available models list"""
        available = detect_providers()

        # Add AIDO meta-models first
        models = [
            {
                "id": "aido/auto",
                "object": "model",
                "created": 0,
                "owned_by": "aido",
            },
            {
                "id": "aido/cloud",
                "object": "model",
                "created": 0,
                "owned_by": "aido",
            },
            {
                "id": "aido/local",
                "object": "model",
                "created": 0,
                "owned_by": "aido",
            },
        ]

        # Add actual provider models
        for provider_name, info in available.items():
            if info.get("status") == "running":
                for model_name in info.get("models", []):
                    models.append(
                        {
                            "id": model_name,
                            "object": "model",
                            "created": 0,
                            "owned_by": provider_name,
                        }
                    )

        self.send_json({"object": "list", "data": models})

    def send_health(self):
        """Health check"""
        available = detect_providers()
        running = [k for k, v in available.items() if v.get("status") == "running"]
        self.send_json({"status": "ok", "providers": running})

    def send_welcome(self):
        """Welcome message"""
        self.send_json(
            {
                "name": "AIDO Proxy",
                "version": "1.0.0",
                "description": "Transparent AI model proxy with intelligent selection",
            }
        )

    def handle_chat_completions(self, body, request_id="unknown"):
        """Handle chat completions request"""
        log(f"[{request_id}] Processing chat completions")

        try:
            request_data = json.loads(body) if body else {}
        except:
            log(f"[{request_id}] Invalid JSON in request", "ERROR")
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # Get requested model (if any)
        requested_model = request_data.get("model")

        # Get prompt from messages
        messages = request_data.get("messages", [])
        if not messages:
            # Try 'prompt' for non-chat format
            prompt = request_data.get("prompt", "")
        else:
            # Combine all messages into prompt
            prompt = "\n".join(
                [f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages]
            )

        # Get the user message
        user_message = next(
            (m["content"] for m in messages if m.get("role") == "user"), prompt
        )

        # Log user message preview (truncated)
        log(f"[{request_id}] User message: {user_message[:100]}...")

        # Try request with fallback on failure
        fallback_attempted = False
        model = None
        provider = None
        endpoint = None
        while True:
            # Use requested model if provided, otherwise select best model
            if requested_model and not fallback_attempted:
                # Handle AIDO meta-models (with or without aido/ prefix)
                # OpenCode sometimes strips the aido/ prefix
                model_type = None
                if requested_model.startswith("aido/"):
                    model_type = requested_model.split("/")[1]
                elif requested_model in ("auto", "cloud", "local"):
                    model_type = requested_model
                    log(
                        f"[{request_id}] OpenCode sent model without prefix: {requested_model}"
                    )

                if model_type in ("auto", "cloud", "local"):
                    log(f"[{request_id}] Using AIDO meta-model: aido/{model_type}")
                    model, provider, endpoint = select_model_by_type(
                        user_message, model_type
                    )
                    if not model:
                        log(
                            f"[{request_id}] No models available for type: {model_type}",
                            "ERROR",
                        )
                        self.send_json(
                            {"error": f"No models available for type: {model_type}"},
                            503,
                        )
                        return
                    # Remove aido/ prefix for downstream processing
                    requested_model = None
                elif requested_model.startswith("aido/"):
                    # Try to find the specific model (strip aido/ prefix)
                    specific_model = requested_model[5:]  # Remove "aido/"
                    model, provider, endpoint = find_model_provider(specific_model)
                    if not model:
                        # Model not found, fall back to auto-selection
                        log(
                            f"[{request_id}] Requested model '{requested_model}' not found, auto-selecting"
                        )
                        model, provider, endpoint = select_model(user_message)
                        requested_model = None  # Prevent further use
                else:
                    # Find provider for requested model
                    model, provider, endpoint = find_model_provider(requested_model)
                    if not model:
                        # Model not found, fall back to auto-selection
                        log(
                            f"[{request_id}] Requested model '{requested_model}' not found, auto-selecting"
                        )
                        model, provider, endpoint = select_model(user_message)
                        requested_model = None  # Prevent further use
            elif not fallback_attempted:
                # No requested model, auto-select
                model, provider, endpoint = select_model(user_message)
            else:
                log(f"[{request_id}] Trying fallback model...")
                model, provider, endpoint = get_fallback_model(model)

            if not model:
                if fallback_attempted:
                    log(f"[{request_id}] No fallback model available", "ERROR")
                    self.send_json({"error": "No models available"}, 503)
                else:
                    log(f"[{request_id}] No models available", "ERROR")
                    self.send_json({"error": "No models available"}, 503)
                return

            log(f"[{request_id}] Using model: {model} (provider: {provider})")

            request_start_time = datetime.datetime.now()

            # Cloud providers (OpenCode Zen, Gemini, OpenAI) - use OpenAI format
            if provider in ("opencode-zen", "gemini", "cloud"):
                api_key, key_name = get_next_key(provider)
                if not api_key:
                    log(f"[{request_id}] No API keys available for {provider}", "ERROR")
                    if not fallback_attempted:
                        fallback_attempted = True
                        continue
                    self.send_json({"error": f"No API keys for {provider}"}, 503)
                    return

                log(f"[{request_id}] Using {provider} key: {key_name or 'default'}")

                # Forward to cloud provider
                result, status_code = forward_request(
                    endpoint,
                    "/v1/chat/completions",
                    body,
                    api_key=api_key,
                    provider_name=provider,
                )

                # Check for error (rate limit, auth error)
                try:
                    result_check = json.loads(result)
                    if "error" in result_check:
                        error_code = result_check.get("error", {}).get("code")
                        if status_code in (401, 403, 429) or error_code in (
                            "rate_limit",
                            "invalid_api_key",
                        ):
                            log(
                                f"[{request_id}] {provider} error: {result_check.get('error')}, trying next key",
                                "WARN",
                            )
                            if not fallback_attempted:
                                fallback_attempted = True
                                continue
                        self.send_json(
                            result_check, status_code if status_code else 500
                        )
                        return
                except:
                    pass

                # Send successful response
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(result.encode())
                log(f"[{request_id}] Response sent to client")
                return

            # Local Ollama provider
            elif provider == "ollama":
                api_mode = get_api_mode()
                log(f"[{request_id}] API mode: {api_mode}")

                if api_mode == "generate":
                    # Use /api/generate for more detailed responses
                    ollama_data = {
                        "model": model,
                        "prompt": prompt,
                        "stream": request_data.get("stream", False),
                    }
                    result, status_code = forward_request(
                        endpoint,
                        "/api/generate",
                        json.dumps(ollama_data),
                        provider_name="ollama",
                    )

                    # Check for error in response
                    try:
                        result_check = json.loads(result)
                        if "error" in result_check:
                            log(
                                f"[{request_id}] Model error: {result_check.get('error')}",
                                "ERROR",
                            )
                            if not fallback_attempted:
                                fallback_attempted = True
                                continue
                            self.send_json({"error": result_check.get("error")}, 500)
                            return
                    except:
                        pass

                    # Convert generate response to OpenAI format
                    ollama_result = None
                    try:
                        # Handle NDJSON (newline-delimited JSON) - Ollama may return multiple lines
                        lines = result.strip().split("\n")
                        if len(lines) > 1:
                            # Multiple lines - parse the last complete response
                            for line in reversed(lines):
                                line = line.strip()
                                if line:
                                    try:
                                        ollama_result = json.loads(line)
                                        if ollama_result.get("done", False):
                                            break
                                    except:
                                        continue
                        else:
                            ollama_result = json.loads(result)
                        response_content = (
                            ollama_result.get("response", "") if ollama_result else ""
                        )
                        response = {
                            "id": "chatcmpl-" + os.urandom(8).hex(),
                            "object": "chat.completion",
                            "created": 0,
                            "model": model,
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": response_content,
                                    },
                                    "finish_reason": "stop",
                                }
                            ],
                        }
                        log(f"[{request_id}] Response: {response_content[:100]}...")

                        duration_ms = int(
                            (
                                datetime.datetime.now() - request_start_time
                            ).total_seconds()
                            * 1000
                        )
                        database.log_query(
                            query_text=user_message[:500],
                            query_summary=database.summarize_query(user_message),
                            model_used=model,
                            provider=str(provider or "unknown"),
                            api_mode=api_mode,
                            response_time_ms=duration_ms,
                            response_length=len(response_content),
                            success=True,
                        )

                        self.send_json(response)
                        return
                    except Exception as e:
                        log(f"[{request_id}] Error parsing response: {e}", "ERROR")
                        log(f"[{request_id}] Raw response: {result[:500]}", "ERROR")
                        if not fallback_attempted:
                            fallback_attempted = True
                            continue
                        self.send_json({"error": str(e), "detail": result[:500]}, 500)
                        return
                else:
                    # Use /api/chat (default)
                    ollama_data = {
                        "model": model,
                        "messages": messages,
                        "stream": request_data.get("stream", False),
                    }

                    result, _ = forward_request(
                        endpoint,
                        "/api/chat",
                        json.dumps(ollama_data),
                        provider_name="ollama",
                    )

                    # Check for error in response
                    try:
                        result_check = json.loads(result)
                        if "error" in result_check:
                            log(
                                f"[{request_id}] Model error: {result_check.get('error')}",
                                "ERROR",
                            )
                            if not fallback_attempted:
                                fallback_attempted = True
                                continue
                            self.send_json({"error": result_check.get("error")}, 500)
                            return
                    except:
                        pass

                    # Convert back to OpenAI format
                    try:
                        ollama_result = json.loads(result)
                        # Ollama chat API returns: {"message": {"role": "assistant", "content": "..."}, ...}
                        response_content = ollama_result.get("message", {}).get(
                            "content", ""
                        )
                        response = {
                            "id": "chatcmpl-" + os.urandom(8).hex(),
                            "object": "chat.completion",
                            "created": 0,
                            "model": model,
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {
                                        "role": "assistant",
                                        "content": response_content,
                                    },
                                    "finish_reason": "stop",
                                }
                            ],
                        }
                        log(f"[{request_id}] Response: {response_content[:100]}...")

                        duration_ms = int(
                            (
                                datetime.datetime.now() - request_start_time
                            ).total_seconds()
                            * 1000
                        )
                        database.log_query(
                            query_text=user_message[:500],
                            query_summary=database.summarize_query(user_message),
                            model_used=model,
                            provider=str(provider or "unknown"),
                            api_mode=api_mode,
                            response_time_ms=duration_ms,
                            response_length=len(response_content),
                            success=True,
                        )

                        self.send_json(response)
                        return
                    except Exception as e:
                        log(f"[{request_id}] Error parsing response: {e}", "ERROR")
                        log(
                            f"[{request_id}] Raw response (first 500 chars): {result[:500]}",
                            "ERROR",
                        )
                        if not fallback_attempted:
                            fallback_attempted = True
                            continue
                        self.send_json({"error": str(e), "detail": result[:500]}, 500)
                        return
            elif provider == "docker-model-runner":
                # Docker Model Runner - use OpenAI format
                result, status_code = forward_request(
                    endpoint,
                    "/v1/chat/completions",
                    body,
                    provider_name="docker-model-runner",
                )

                # Check for error
                try:
                    result_check = json.loads(result)
                    if "error" in result_check:
                        log(
                            f"[{request_id}] DMR error: {result_check.get('error')}",
                            "ERROR",
                        )
                        if not fallback_attempted:
                            fallback_attempted = True
                            continue
                        self.send_json(result_check, 500)
                        return
                except:
                    pass

                # Log to database for DMR
                try:
                    dmr_response = json.loads(result)
                    response_content = (
                        dmr_response.get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                    )
                    duration_ms = int(
                        (datetime.datetime.now() - request_start_time).total_seconds()
                        * 1000
                    )
                    database.log_query(
                        query_text=user_message[:500],
                        query_summary=database.summarize_query(user_message),
                        model_used=model,
                        provider=str(provider or "unknown"),
                        api_mode="chat",
                        response_time_ms=duration_ms,
                        response_length=len(response_content),
                        success=True,
                    )
                except:
                    pass

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(result.encode())
                log(f"[{request_id}] Response sent to client")
                return
            log(f"[{request_id}] Forwarding to DMR")
            result, _ = forward_request(
                endpoint,
                "/v1/chat/completions",
                body,
                provider_name="docker-model-runner",
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(result.encode())
            log(f"[{request_id}] Response sent to client")

    def handle_completions(self, body, request_id="unknown"):
        """Handle completions request"""
        # Similar to chat_completions but for /completions endpoint
        self.handle_chat_completions(body, request_id)


def run_server(port=DEFAULT_PORT):
    """Run the proxy server"""
    log(f"Starting AIDO Proxy on port {port}")
    server = HTTPServer(("0.0.0.0", port), AIDOProxyHandler)
    log(f"OpenAI-compatible endpoint: http://localhost:{port}/v1")
    log("Proxy ready - press Ctrl+C to stop")

    # Save PID
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Shutting down...")
        server.shutdown()
        if PID_FILE.exists():
            PID_FILE.unlink()


def stop_server():
    """Stop the proxy server"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, signal.SIGTERM)
            log("Proxy stopped")
            PID_FILE.unlink()
            return True
        except ProcessLookupError:
            log("Process not found, removing stale PID file", "WARN")
            PID_FILE.unlink()
            return False
    else:
        log("No PID file found - is the proxy running?", "WARN")
        return False


def check_status():
    """Check if proxy is running"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, 0)
            log(f"Proxy is running (PID: {pid})")
            return True
        except ProcessLookupError:
            log("Proxy is not running (stale PID)", "WARN")
            return False
    else:
        print("[AIDO] Proxy is not running")
        return False


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="AIDO Proxy")
    parser.add_argument(
        "command", choices=["start", "stop", "status"], help="Command to run"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to run on (default: {DEFAULT_PORT})",
    )

    args = parser.parse_args()

    if args.command == "start":
        run_server(args.port)
    elif args.command == "stop":
        stop_server()
    elif args.command == "status":
        check_status()


if __name__ == "__main__":
    main()
