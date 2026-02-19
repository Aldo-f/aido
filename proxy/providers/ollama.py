import json
from typing import Any, AsyncGenerator

import httpx

import config
from .base import BaseProvider, build_openai_message


class OllamaProvider(BaseProvider):
    name = "ollama"
    endpoint = config.OLLAMA_ENDPOINT
    default_model = "llama3.2"

    def get_headers(self, api_key: str | None = None) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    def get_url(self, model: str | None = None) -> str:
        return f"{self.endpoint}/api/generate"

    async def chat(
        self,
        messages: list[dict],
        model: str,
        stream: bool,
        api_key: str | None = None,
    ) -> dict[str, Any] | AsyncGenerator[str, None]:
        url = self.get_url()
        prompt = build_openai_message(messages)
        body = {
            "model": model,
            "prompt": prompt,
            "stream": stream,
        }

        if stream:
            return self._stream(url, body, model)
        else:
            return await self._non_stream(url, body, model)

    async def _non_stream(self, url: str, body: dict, model: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body)
            if resp.status_code != 200:
                raise Exception(f"Ollama error: {resp.status_code} - {resp.text}")

            data = resp.json()
            content = data.get("response", "")

            return {
                "id": f"ollama-{model}",
                "object": "chat.completion",
                "created": 0,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": "stop",
                    }
                ],
            }

    async def _stream(
        self, url: str, body: dict, model: str
    ) -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                async with client.stream("POST", url, json=body) as resp:
                    async for line in resp.aiter_lines():
                        if line:
                            try:
                                data = json.loads(line)
                                content = data.get("response", "")
                                if content:
                                    chunk = {
                                        "id": f"ollama-{model}",
                                        "object": "chat.completion.chunk",
                                        "created": 0,
                                        "model": model,
                                        "choices": [
                                            {
                                                "index": 0,
                                                "delta": {"content": content},
                                                "finish_reason": None,
                                            }
                                        ],
                                    }
                                    yield f"data: {json.dumps(chunk)}\n\n"
                            except json.JSONDecodeError:
                                pass

                    yield "data: [DONE]\n\n"
            except Exception as e:
                yield f'{{"error": "{str(e)}"}}\n\n'
