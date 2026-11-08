// Client for POST /api/chat. Successful replies stream as server-sent events; errors come back
// as JSON with a non-200 status.
import type { ApiErrorCode, ChatMessage, Lang, ServerEvent } from "./types.ts";

export class ChatApiError extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode) {
    super(code);
    this.code = code;
  }
}

// Vite replaces import.meta.env.DEV with false in production builds, so the mock below is
// dropped from them. (The typeof check only matters when Node runs this file, in tests.)
const DEV = typeof import.meta.env !== "undefined" && import.meta.env.DEV;

export async function* streamChat(
  body: { lang: Lang; messages: ChatMessage[] },
  signal?: AbortSignal,
): AsyncGenerator<ServerEvent> {
  if (DEV) {
    // `npm run dev` with ?mock in the URL: answer from a stand-in instead of the Worker (see mock.ts).
    const mock = await import("./mock.ts");
    const mode = mock.mockMode();
    if (mode) {
      yield* mock.mockChat(body, mode);
      return;
    }
  }
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ChatApiError("unavailable");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
    throw new ChatApiError(data.error ?? "unavailable");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) yield JSON.parse(line.slice(6)) as ServerEvent;
      }
    }
  }
}
