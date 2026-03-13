// Ollama Cloud uses /api/chat instead of /v1/chat/completions
// Proxy translates requests and responses automatically

interface OpenAIRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
}

interface OllamaRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

export function toOllamaPath(openaiPath: string): string {
  if (openaiPath.includes('/chat/completions')) return '/api/chat';
  if (openaiPath.includes('/models')) return '/api/tags';
  return openaiPath;
}

export function toOllamaBody(body: string): string {
  try {
    const req = JSON.parse(body) as OpenAIRequest;
    const ollama: OllamaRequest = {
      model: req.model,
      messages: req.messages,
      stream: req.stream ?? false,
    };
    return JSON.stringify(ollama);
  } catch {
    return body;
  }
}

export function fromOllamaResponse(body: string): string {
  try {
    const res = JSON.parse(body) as OllamaChatResponse;
    if (!res.message) return body;
    return JSON.stringify({
      id: `chatcmpl-ollama-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: res.model,
      choices: [{
        index: 0,
        message: res.message,
        finish_reason: res.done ? 'stop' : null,
      }],
    });
  } catch {
    return body;
  }
}
