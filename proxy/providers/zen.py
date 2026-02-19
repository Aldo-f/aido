import json
from typing import Any, AsyncGenerator

import httpx

import config
from .base import BaseProvider, convert_to_openai_format


class ZenProvider(BaseProvider):
    name = "opencode-zen"
    endpoint = config.ZEN_ENDPOINT
    default_model = "big-pickle"

    def get_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def get_url(self, model: str | None = None) -> str:
        return f"{self.endpoint}/v1/chat/completions"

    async def chat(
        self,
        messages: list[dict],
        model: str,
        stream: bool,
        api_key: str | None = None,
    ) -> dict[str, Any] | AsyncGenerator[str, None]:
        if not api_key:
            raise ValueError("API key required for Zen provider")

        url = self.get_url()
        headers = self.get_headers(api_key)
        body = {
            "model": model,
            "messages": convert_to_openai_format(messages),
            "stream": stream,
        }

        if stream:
            return self._stream(url, headers, body)
        else:
            return await self._non_stream(url, headers, body)

    async def _non_stream(self, url: str, headers: dict, body: dict) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code != 200:
                raise Exception(f"Zen API error: {resp.status_code} - {resp.text}")
            return resp.json()

    async def _stream(
        self, url: str, headers: dict, body: dict
    ) -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                async with client.stream(
                    "POST", url, json=body, headers=headers
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            yield line + "\n\n"
            except Exception as e:
                yield f'{{"error": "{str(e)}"}}\n\n'
