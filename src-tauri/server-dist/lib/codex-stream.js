export const parseResponsesSseChunk = (buffer) => {
  const events = [];
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.replace(/^data:\s*/, "");
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* skip malformed stream events */
    }
  }
  return { remainder, events };
};

export const extractResponsesText = (json) => {
  if (!json || typeof json !== "object") return null;
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  if (!Array.isArray(json.output)) return null;

  const parts = [];
  for (const item of json.output) {
    if (!item || typeof item !== "object" || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block?.type === "output_text" && typeof block.text === "string" && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
  }
  return parts.length > 0 ? parts.join("\n").trim() : null;
};

const formatStreamError = (error) => {
  if (!error || typeof error !== "object") return "";
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : "";
  if (message && code) return `${message} (${code})`;
  return message || code;
};

const readWithIdleTimeout = async (reader, idleTimeoutMs) => {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Codex OAuth response stream was idle for too long while waiting for completion."));
        }, idleTimeoutMs);
      }),
    ]);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const readResponsesSseStream = async (body, { idleTimeoutMs = 90_000 } = {}) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { streamed: "", completed: null, error: null };

  const handleEvent = (event) => {
    if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
      state.streamed += event.delta;
      return;
    }
    if (event?.type === "response.completed" && event.response) {
      state.completed = event.response;
      if (event.response.error) state.error = event.response.error;
      return;
    }
    if (event?.type === "response.failed") {
      state.error = event.error || event.response?.error || { message: "Codex OAuth response stream failed." };
    }
  };

  for (;;) {
    const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseResponsesSseChunk(buffer);
    buffer = parsed.remainder;
    for (const event of parsed.events) handleEvent(event);
    if (state.error) break;
  }

  if (buffer.trim()) {
    const parsed = parseResponsesSseChunk(`${buffer}\n`);
    for (const event of parsed.events) handleEvent(event);
  }

  if (state.error) {
    const detail = formatStreamError(state.error);
    throw new Error(detail ? `Codex OAuth provider failed: ${detail}` : "Codex OAuth provider failed.");
  }

  return {
    text: state.streamed.trim() || extractResponsesText(state.completed) || "",
    usage: state.completed?.usage || null,
  };
};
