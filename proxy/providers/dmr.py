import json
from typing import Any, AsyncGenerator

import httpx

import config
from .base import BaseProvider, build_openai_message


class DMRProvider(BaseProvider):
    name = "docker-model-runner"
    endpoint = config.DMR_ENDPOINT
    default_model = "llama3.2"

    def get_headers(self, api_key: str | None = None) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    def get_url(self, model: str | None = None) -> str:
        return f"{self.endpoint}/v1/completions"

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
            "max_tokens": 4096,
        }

        if stream:
            return self._stream(url, body, model)
        else:
            return await self._non_stream(url, body, model, api_key)

    async def _non_stream(
        self, url: str, body: dict, model: str, api_key: str | None
    ) -> dict[str, Any]:
        headers = self.get_headers(api_key)
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code != 200:
                raise Exception(f"DMR error: {resp.status_code} - {resp.text}")

            data = resp.json()
            content = data.get("choices", [{}])[0].get("text", "")

            return {
                "id": f"dmr-{model}",
                "object": "text_completion",
                "created": 0,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "text": content,
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
                        if line.startswith("data:"):
                            yield line + "\n\n"
            except Exception as e:
                yield f'{{"error": "{str(e)}"}}\n\n'
