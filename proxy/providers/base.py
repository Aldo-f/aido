from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator


class BaseProvider(ABC):
    name: str = "base"
    endpoint: str = ""
    default_model: str = ""

    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        model: str,
        stream: bool,
        api_key: str | None = None,
    ) -> dict[str, Any] | AsyncGenerator[str, None]:
        pass

    @abstractmethod
    def get_headers(self, api_key: str) -> dict[str, str]:
        pass

    @abstractmethod
    def get_url(self, model: str | None = None) -> str:
        pass


def build_openai_message(messages: list[dict]) -> str:
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        parts.append(f"{role}: {content}")
    return "\n".join(parts)


def convert_to_openai_format(messages: list[dict]) -> list[dict]:
    return [
        {"role": m.get("role", "user"), "content": m.get("content", "")}
        for m in messages
    ]
