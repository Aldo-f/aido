import json
from typing import Any, AsyncGenerator

import httpx

import config
from .base import BaseProvider, convert_to_openai_format


class GeminiProvider(BaseProvider):
    name = "gemini"
    endpoint = config.GEMINI_ENDPOINT

    def get_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def get_url(self, model: str | None = None) -> str:
        return f"{self.endpoint}/v1beta/models/{model}:generateContent"

    def convert_messages(self, messages: list[dict]) -> list[dict]:
        converted = []
        for m in messages:
            role = "user" if m.get("role") == "user" else "model"
            converted.append({"role": role, "parts": [{"text": m.get("content", "")}]})
        return converted

    async def chat(
        self,
        messages: list[dict],
        model: str,
        stream: bool,
        api_key: str | None = None,
    ) -> dict[str, Any] | AsyncGenerator[str, None]:
        if not api_key:
            raise ValueError("API key required for Gemini provider")

        url = self.get_url(model)
        headers = self.get_headers(api_key)
        body = {
            "contents": self.convert_messages(messages),
            "generationConfig": {
                "temperature": 0.9,
                "maxOutputTokens": 8192,
            },
        }

        if stream:
            return self._stream(url, headers, body, model, api_key)
        else:
            return await self._non_stream(url, headers, body, model)

    async def _non_stream(
        self, url: str, headers: dict, body: dict, model: str
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code != 200:
                raise Exception(f"Gemini API error: {resp.status_code} - {resp.text}")

            data = resp.json()
            content = ""
            if "candidates" in data:
                for candidate in data["candidates"]:
                    if "content" in candidate and "parts" in candidate["content"]:
                        for part in candidate["content"]["parts"]:
                            if "text" in part:
                                content += part["text"]

            return {
                "id": f"gemini-{model}",
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
        self, url: str, headers: dict, body: dict, model: str, api_key: str
    ) -> AsyncGenerator[str, None]:
        stream_url = url.replace(":generateContent", ":streamGenerateContent")
        body["stream"] = True

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0)
        ) as client:
            try:
                async with client.stream(
                    "POST", stream_url, json=body, headers=headers
                ) as resp:
                    if resp.status_code != 200:
                        error_msg = f"Gemini API error: {resp.status_code}"
                        try:
                            error_data = resp.json()
                            if "error" in error_data:
                                error_msg = error_data["error"].get(
                                    "message", error_msg
                                )
                        except Exception:
                            pass
                        raise Exception(f"{resp.status_code} {error_msg}")

                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            yield line + "\n\n"

                    yield "data: [DONE]\n\n"
            except httpx.ReadTimeout:
                raise Exception("Read timeout - provider took too long")
            except Exception as e:
                if "401" in str(e) or "403" in str(e) or "429" in str(e):
                    raise
                yield f'{{"error": "{str(e)}"}}\n\n'
                yield "data: [DONE]\n\n"
