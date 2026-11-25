import {
  GroqModelClient,
  GroqClientError,
  DEFAULT_GROQ_MODEL,
  DEFAULT_GROQ_MAX_TOKENS,
  GROQ_CHAT_COMPLETIONS_URL,
} from "../src/model/groqClient.ts";
import { GeminiModelClient } from "../src/model/geminiClient.ts";
import {
  createProviderModelClient,
  resolveLlmProvider,
} from "../src/model/provider.ts";
import { startGenerateServer } from "../server/generateServer.ts";
import { runCli } from "../scripts/generate-scene.ts";
import { FakeModelClient } from "../src/generatePipeline.ts";

const results = {
  fixedSseOrderAndRequestShape: {},
  splitAcrossChunks: {},
  doneTerminatesStream: {},
  retry429WithRetryAfterThen200: {},
  noRetryOn400: {},
  missingApiKey: {},
  sanitizedErrorNeverLeaksKey: {},
  abortOnEarlyStopAndTimeout: {},
  providerSelectionUnit: {},
  serverAndCliProviderSelection: {},
  midObjectEndsRaisesIncompleteOutput: {},
  finishReasonLengthRaisesIncompleteOutput: {},
  maxTokensSentInBodyAndOverridable: {},
  passed: true,
};

function makeStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

function groqSseChunk(content, extraDelta = {}) {
  return (
    "data: " +
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { ...extraDelta, content },
          finish_reason: null,
        },
      ],
    }) +
    "\n\n"
  );
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function runTests() {
  // 1. Fixed OpenAI-style SSE body yields text chunks in order + verifies request shape
  {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders = {};
    let capturedBody = "";

    const fakeFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = String(init?.method ?? "");
      capturedHeaders = init?.headers ?? {};
      capturedBody = String(init?.body ?? "");
      return new Response(
        makeStream([
          "data: " +
            JSON.stringify({
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            }) +
            "\n\n",
          groqSseChunk('{"stepNumber":1,'),
          groqSseChunk('"title":"Shelf"}\n'),
          "data: " +
            JSON.stringify({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    };

    const client = new GroqModelClient({
      apiKey: "gsk_fake_test_secret_111",
      fetch: fakeFetch,
    });

    const out = [];
    for await (const chunk of client.generateStream("build bookshelf")) {
      out.push(chunk);
    }

    const parsedBody = JSON.parse(capturedBody);
    const valid =
      out.length === 2 &&
      out[0] === '{"stepNumber":1,' &&
      out[1] === '"title":"Shelf"}\n' &&
      capturedMethod === "POST" &&
      capturedUrl === GROQ_CHAT_COMPLETIONS_URL &&
      !capturedUrl.includes("gsk_fake_test_secret_111") &&
      capturedHeaders.Authorization === "Bearer gsk_fake_test_secret_111" &&
      parsedBody.model === DEFAULT_GROQ_MODEL &&
      parsedBody.stream === true &&
      parsedBody.response_format === undefined &&
      Array.isArray(parsedBody.messages) &&
      parsedBody.messages.length === 1 &&
      parsedBody.messages[0].role === "user" &&
      parsedBody.messages[0].content === "build bookshelf";

    results.fixedSseOrderAndRequestShape = {
      out,
      model: parsedBody.model,
      hasResponseFormat: parsedBody.response_format !== undefined,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 2. Event split across two network chunks is parsed correctly
  {
    const fullEvent = groqSseChunk("split-groq-payload");
    const splitPoint = Math.floor(fullEvent.length / 2);
    const chunkA = fullEvent.slice(0, splitPoint);
    const chunkB = fullEvent.slice(splitPoint);

    const fakeFetch = async () =>
      new Response(makeStream([chunkA, chunkB, "data: [DONE]\n\n"]), {
        status: 200,
      });

    const client = new GroqModelClient({
      apiKey: "gsk_fake_split_222",
      fetch: fakeFetch,
    });

    const out = [];
    for await (const chunk of client.generateStream("split test")) {
      out.push(chunk);
    }

    const valid = out.length === 1 && out[0] === "split-groq-payload";
    results.splitAcrossChunks = { out, valid };
    if (!valid) results.passed = false;
  }

  // 3. "data: [DONE]" terminates the stream immediately even if more chunks follow or stream stays open
  {
    let cancelCalled = false;
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(groqSseChunk("before-done")));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.enqueue(enc.encode(groqSseChunk("after-done-should-not-emit")));
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const fakeFetch = async () => new Response(stream, { status: 200 });
    const client = new GroqModelClient({
      apiKey: "gsk_fake_done_333",
      fetch: fakeFetch,
    });

    const out = [];
    for await (const chunk of client.generateStream("done test")) {
      out.push(chunk);
    }

    const valid =
      out.length === 1 &&
      out[0] === "before-done" &&
      cancelCalled;

    results.doneTerminatesStream = { out, cancelCalled, valid };
    if (!valid) results.passed = false;
  }

  // 4. HTTP 429 with retry-after retries once and succeeds
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("rate limit", {
          status: 429,
          headers: { "Retry-After": "0.05" },
        });
      }
      return new Response(
        makeStream([groqSseChunk("recovered-after-429"), "data: [DONE]\n\n"]),
        { status: 200 }
      );
    };

    const client = new GroqModelClient({
      apiKey: "gsk_fake_retry_444",
      fetch: fakeFetch,
    });

    const startMs = Date.now();
    const out = [];
    for await (const chunk of client.generateStream("retry 429 test")) {
      out.push(chunk);
    }
    const elapsedMs = Date.now() - startMs;

    const valid =
      callCount === 2 &&
      out.length === 1 &&
      out[0] === "recovered-after-429" &&
      elapsedMs >= 30 &&
      elapsedMs < 800;

    results.retry429WithRetryAfterThen200 = {
      callCount,
      out,
      elapsedMs,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 5. HTTP 400 does not retry and throws GroqClientError with status 400
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      return new Response("bad request", { status: 400 });
    };

    const client = new GroqModelClient({
      apiKey: "gsk_fake_400_555",
      fetch: fakeFetch,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("bad request")) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      callCount === 1 &&
      caught instanceof GroqClientError &&
      caught.status === 400 &&
      caught.message.includes("400");

    results.noRetryOn400 = {
      callCount,
      isGroqClientError: caught instanceof GroqClientError,
      status: caught?.status,
      message: caught?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 6. Missing key throws before any request, message has no key
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      return new Response(makeStream([]), { status: 200 });
    };

    let caught = null;
    try {
      const client = new GroqModelClient({
        apiKey: "   ",
        fetch: fakeFetch,
      });
      for await (const _ of client.generateStream("no key")) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      callCount === 0 &&
      caught instanceof GroqClientError &&
      typeof caught.message === "string" &&
      caught.message.length > 0 &&
      !caught.message.includes("gsk_");

    results.missingApiKey = {
      callCount,
      isGroqClientError: caught instanceof GroqClientError,
      message: caught?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 7. Key never appears in error message even when fake fetch echoes it
  {
    const secretKey = "gsk_SUPER_SECRET_LEAK_TEST_98765";
    const fakeFetch = async (url, init) => {
      const auth = init?.headers?.Authorization ?? "";
      throw new Error(`Request failed at ${url} with header ${auth} and ${secretKey}`);
    };

    const client = new GroqModelClient({
      apiKey: secretKey,
      fetch: fakeFetch,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("boom")) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    const msg = String(caught?.message ?? "");
    const valid =
      caught instanceof GroqClientError &&
      !msg.includes(secretKey) &&
      !msg.includes("api.groq.com") &&
      !msg.includes("https://");

    results.sanitizedErrorNeverLeaksKey = {
      isGroqClientError: caught instanceof GroqClientError,
      message: msg,
      containsKey: msg.includes(secretKey),
      containsUrl: msg.includes("https://"),
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 8. Consumer early break and timeout abort AbortController cleanly
  {
    let earlyAborted = false;
    const fakeFetchEarly = async (_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        earlyAborted = true;
      });
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(groqSseChunk("first")));
          controller.enqueue(enc.encode(groqSseChunk("second")));
        },
        cancel() {
          earlyAborted = true;
        },
      });
      return new Response(stream, { status: 200 });
    };

    const clientEarly = new GroqModelClient({
      apiKey: "gsk_fake_abort",
      fetch: fakeFetchEarly,
    });
    const collected = [];
    for await (const piece of clientEarly.generateStream("abort early")) {
      collected.push(piece);
      break;
    }

    let timeoutAborted = false;
    const fakeFetchTimeout = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          timeoutAborted = true;
          reject(new Error("Aborted"));
        });
      });

    const clientTimeout = new GroqModelClient({
      apiKey: "gsk_fake_timeout",
      fetch: fakeFetchTimeout,
      timeoutMs: 30,
      maxRetries: 0,
    });
    let timeoutErr = null;
    try {
      for await (const _ of clientTimeout.generateStream("timeout")) {
        // unreachable
      }
    } catch (err) {
      timeoutErr = err;
    }

    const valid =
      collected.length === 1 &&
      earlyAborted &&
      timeoutAborted &&
      timeoutErr instanceof GroqClientError &&
      timeoutErr.message.includes("timed out");

    results.abortOnEarlyStopAndTimeout = {
      earlyAborted,
      timeoutAborted,
      timeoutMessage: timeoutErr?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 9. Provider selection unit checks: groq -> GroqModelClient, gemini/default -> GeminiModelClient, unknown -> clear error
  {
    const defaultProvider = resolveLlmProvider({});
    const geminiProvider = resolveLlmProvider({ LLM_PROVIDER: "gemini" });
    const groqProvider = resolveLlmProvider({ LLM_PROVIDER: "groq" });

    const groqClient = createProviderModelClient({
      provider: groqProvider,
      apiKey: "gsk_test_provider",
    });
    const geminiClient = createProviderModelClient({
      provider: geminiProvider,
      apiKey: "gem_test_provider",
    });

    let unknownErrMsg = "";
    try {
      resolveLlmProvider({ LLM_PROVIDER: "openai" });
    } catch (err) {
      unknownErrMsg = String(err?.message ?? err);
    }

    const valid =
      defaultProvider === "gemini" &&
      geminiProvider === "gemini" &&
      groqProvider === "groq" &&
      groqClient instanceof GroqModelClient &&
      geminiClient instanceof GeminiModelClient &&
      unknownErrMsg.includes("LLM_PROVIDER") &&
      unknownErrMsg.includes("openai");

    results.providerSelectionUnit = {
      defaultProvider,
      groqClientClass: groqClient.constructor.name,
      geminiClientClass: geminiClient.constructor.name,
      unknownErrMsg,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 10. Server & CLI provider selection + missing GROQ_API_KEY + unknown LLM_PROVIDER startup error
  {
    let serverStartupErr = "";
    try {
      await startGenerateServer({
        port: 0,
        env: { LLM_PROVIDER: "anthropic" },
      });
    } catch (err) {
      serverStartupErr = String(err?.message ?? err);
    }

    // Server with LLM_PROVIDER=groq & missing GROQ_API_KEY returns 500 without exposing any key
    const missingKeyServer = await startGenerateServer({
      port: 0,
      env: { LLM_PROVIDER: "groq" },
    });
    let groqMissingKeyStatus = 0;
    let groqMissingKeyBody = "";
    try {
      const resp = await fetch(`${missingKeyServer.url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "build a chair" }),
      });
      groqMissingKeyStatus = resp.status;
      groqMissingKeyBody = await resp.text();
    } finally {
      await closeServer(missingKeyServer.server);
    }

    // Server with LLM_PROVIDER=groq selects provider="groq" and passes GROQ_MODEL
    let seenFactoryOpts = null;
    const groqSelectedServer = await startGenerateServer({
      port: 0,
      env: {
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk_server_secret_666",
        GROQ_MODEL: "openai/gpt-oss-120b",
      },
      clientFactory: (opts) => {
        seenFactoryOpts = opts;
        return new FakeModelClient([
          [
            JSON.stringify({
              stepNumber: 1,
              title: "Step 1",
              parts: [
                {
                  id: "p1",
                  name: "Board",
                  primitive: "box",
                  dimensions: { width: 400, height: 25, depth: 300 },
                  position: { x: 0, y: 12.5, z: 0 },
                  rotation: { x: 0, y: 0, z: 0 },
                  color: "tan",
                  material: "oak",
                  step: 1,
                  qty: 1,
                },
              ],
            }) + "\n",
          ],
        ]);
      },
    });
    let groqServerStatus = 0;
    try {
      const resp = await fetch(`${groqSelectedServer.url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "build a board" }),
      });
      groqServerStatus = resp.status;
      await resp.text();
    } finally {
      await closeServer(groqSelectedServer.server);
    }

    // CLI unknown LLM_PROVIDER and missing GROQ_API_KEY
    let cliBadErr = "";
    const cliBadCode = await runCli(["build a chair"], {
      env: { LLM_PROVIDER: "unknown_provider" },
      stdout: { write: () => {} },
      stderr: { write: (s) => { cliBadErr += s; } },
    });

    let cliMissingKeyErr = "";
    const cliMissingKeyCode = await runCli(["build a chair"], {
      env: { LLM_PROVIDER: "groq" },
      stdout: { write: () => {} },
      stderr: { write: (s) => { cliMissingKeyErr += s; } },
    });

    let cliSeenProvider = "";
    const cliGroqCode = await runCli(["build a board"], {
      env: { LLM_PROVIDER: "groq", GROQ_API_KEY: "gsk_cli_secret_777" },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      clientFactory: (_key, opts) => {
        cliSeenProvider = opts?.provider ?? "";
        return new FakeModelClient([
          [
            JSON.stringify({
              stepNumber: 1,
              title: "Step 1",
              parts: [
                {
                  id: "cli_p1",
                  name: "Board",
                  primitive: "box",
                  dimensions: { width: 400, height: 25, depth: 300 },
                  position: { x: 0, y: 12.5, z: 0 },
                  rotation: { x: 0, y: 0, z: 0 },
                  color: "tan",
                  material: "oak",
                  step: 1,
                  qty: 1,
                },
              ],
            }) + "\n",
          ],
        ]);
      },
    });

    const valid =
      serverStartupErr.includes("LLM_PROVIDER") &&
      groqMissingKeyStatus === 500 &&
      groqMissingKeyBody.includes("GROQ_API_KEY") &&
      groqServerStatus === 200 &&
      seenFactoryOpts?.provider === "groq" &&
      seenFactoryOpts?.model === "openai/gpt-oss-120b" &&
      cliBadCode !== 0 &&
      cliBadErr.includes("LLM_PROVIDER") &&
      cliMissingKeyCode !== 0 &&
      cliMissingKeyErr.includes("GROQ_API_KEY") &&
      cliGroqCode === 0 &&
      cliSeenProvider === "groq";

    results.serverAndCliProviderSelection = {
      serverStartupErr,
      groqMissingKeyStatus,
      groqServerStatus,
      seenProvider: seenFactoryOpts?.provider,
      cliBadCode,
      cliMissingKeyCode,
      cliGroqCode,
      cliSeenProvider,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 11. Stream ending mid-object raises GroqClientError with code === "incomplete_output"
  {
    const fakeFetch = async () =>
      new Response(
        makeStream([
          groqSseChunk('{"stepNumber":1,"title":"Cutoff","parts":[{"id":"side_1"'),
          "data: [DONE]\n\n",
        ]),
        { status: 200 }
      );
    const client = new GroqModelClient({
      apiKey: "gsk_fake_mid_obj",
      fetch: fakeFetch,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("cutoff test")) {
        // consume stream
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      caught instanceof GroqClientError &&
      caught.code === "incomplete_output";
    results.midObjectEndsRaisesIncompleteOutput = {
      isGroqClientError: caught instanceof GroqClientError,
      code: caught?.code,
      message: caught?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 12. finish_reason === "length" raises GroqClientError with code === "incomplete_output"
  {
    let seenMeta = null;
    const fakeFetch = async () =>
      new Response(
        makeStream([
          groqSseChunk('{"stepNumber":1,"title":"Trunc"}'),
          "data: " +
            JSON.stringify({
              choices: [{ index: 0, delta: {}, finish_reason: "length" }],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ]),
        { status: 200 }
      );
    const client = new GroqModelClient({
      apiKey: "gsk_fake_len",
      fetch: fakeFetch,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("len test", {
        onMetadata: (m) => {
          seenMeta = m;
        },
      })) {
        // consume stream
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      caught instanceof GroqClientError &&
      caught.code === "incomplete_output" &&
      caught.finishReason === "length" &&
      seenMeta?.finishReason === "length";
    results.finishReasonLengthRaisesIncompleteOutput = {
      isGroqClientError: caught instanceof GroqClientError,
      code: caught?.code,
      finishReason: caught?.finishReason,
      metaFinishReason: seenMeta?.finishReason,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 13. Default max_completion_tokens (8192) is sent and per-call maxTokens override works
  {
    const bodies = [];
    const fakeFetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        makeStream([
          groqSseChunk('{"stepNumber":1}'),
          "data: " +
            JSON.stringify({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ]),
        { status: 200 }
      );
    };
    const client = new GroqModelClient({
      apiKey: "gsk_fake_tokens",
      fetch: fakeFetch,
    });
    for await (const _ of client.generateStream("default tokens")) {}
    for await (const _ of client.generateStream("override tokens", {
      maxTokens: 16384,
    })) {}

    const valid =
      DEFAULT_GROQ_MAX_TOKENS >= 8000 &&
      bodies[0]?.max_completion_tokens === DEFAULT_GROQ_MAX_TOKENS &&
      bodies[1]?.max_completion_tokens === 16384;
    results.maxTokensSentInBodyAndOverridable = {
      defaultMaxTokens: DEFAULT_GROQ_MAX_TOKENS,
      firstReqMaxTokens: bodies[0]?.max_completion_tokens,
      secondReqMaxTokens: bodies[1]?.max_completion_tokens,
      valid,
    };
    if (!valid) results.passed = false;
  }

  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  if (!results.passed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
