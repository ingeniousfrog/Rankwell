import assert from "node:assert/strict";
import test from "node:test";

import { readResponsesSseStream } from "../lib/codex-stream.js";

const streamFromChunks = (chunks, delayMs = 0) =>
  new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

test("readResponsesSseStream returns streamed text and completed usage", async () => {
  const body = streamFromChunks([
    'data: {"type":"response.output_text.delta","delta":"{\\"ok\\":"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"true}"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
  ]);

  const result = await readResponsesSseStream(body, { timeoutMs: 1_000 });

  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.usage.total_tokens, 5);
});

test("readResponsesSseStream surfaces response.failed details", async () => {
  const body = streamFromChunks([
    'data: {"type":"response.failed","error":{"message":"internal error","code":"server_error"}}\n\n',
  ]);

  await assert.rejects(
    () => readResponsesSseStream(body, { timeoutMs: 1_000 }),
    /internal error \(server_error\)/,
  );
});

test("readResponsesSseStream times out when the stream never completes", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
    },
  });

  await assert.rejects(
    () => readResponsesSseStream(body, { timeoutMs: 20 }),
    /timed out/,
  );
});
