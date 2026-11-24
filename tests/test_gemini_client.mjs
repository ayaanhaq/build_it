import {
  GeminiModelClient,
  GeminiClientError,
  parseSseText,
  DEFAULT_GEMINI_MODEL,
} from "../src/model/geminiClient.ts";

const results = {
  multiEventOrder: {},
  splitAcrossChunks: {},
  retry429Then200: {},
  noRetryOn400: {},
  missingApiKey: {},
  sanitizedError: {},
  parseSsePure: {},
  abortOnEarlyStop: {},
  timeoutAbort: {},
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

function sseData(text) {
  return (
    "data: " +
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }) +
    "\n\n"
  );
}

async function runTests() {
  // 1. Multi-event stream yields text pieces in order
  {
    let capturedUrl = "";
    let capturedHeaders = {};
    let capturedBody = "";

    const fakeFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers ?? {};
      capturedBody = String(init?.body ?? "");
      return new Response(
        makeStream([sseData('{"stepNumber":1,'), sseData('"title":"Leg"}\n')]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    };

    const client = new GeminiModelClient({
      apiKey: "test-secret-key-123",
      fetch: fakeFetch,
    });
    const out = [];
    for await (const piece of client.generateStream("build desk")) {
      out.push(piece);
    }

    const parsedBody = JSON.parse(capturedBody);
    const valid =
      out.length === 2 &&
      out[0] === '{"stepNumber":1,' &&
      out[1] === '"title":"Leg"}\n' &&
      capturedUrl ===
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:streamGenerateContent?alt=sse` &&
      !capturedUrl.includes("test-secret-key-123") &&
      capturedHeaders["x-goog-api-key"] === "test-secret-key-123" &&
      parsedBody?.contents?.[0]?.parts?.[0]?.text === "build desk";

    results.multiEventOrder = { out, capturedUrl, valid };
    if (!valid) results.passed = false;
  }

  // 2. Event split across two network chunks is parsed correctly
  {
    const fullEvent = sseData("hello split chunk");
    const splitPoint = Math.floor(fullEvent.length / 2);
    const chunkA = fullEvent.slice(0, splitPoint);
    const chunkB = fullEvent.slice(splitPoint);

    const fakeFetch = async () =>
      new Response(makeStream([chunkA, chunkB]), { status: 200 });

    const client = new GeminiModelClient({
      apiKey: "test-secret-key-split",
      fetch: fakeFetch,
    });
    const out = [];
    for await (const piece of client.generateStream("split test")) {
      out.push(piece);
    }

    const valid = out.length === 1 && out[0] === "hello split chunk";
    results.splitAcrossChunks = { out, valid };
    if (!valid) results.passed = false;
  }

  // 3. HTTP 429 followed by 200 retries once and succeeds
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(makeStream([sseData("recovered after 429")]), {
        status: 200,
      });
    };

    const client = new GeminiModelClient({
      apiKey: "test-secret-key-429",
      fetch: fakeFetch,
    });
    const out = [];
    for await (const piece of client.generateStream("retry test")) {
      out.push(piece);
    }

    const valid =
      callCount === 2 && out.length === 1 && out[0] === "recovered after 429";
    results.retry429Then200 = { callCount, out, valid };
    if (!valid) results.passed = false;
  }

  // 4. HTTP 400 does not retry and throws GeminiClientError
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      return new Response("bad request", { status: 400 });
    };

    const client = new GeminiModelClient({
      apiKey: "test-secret-key-400",
      fetch: fakeFetch,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("bad req")) {
        // should throw
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      callCount === 1 &&
      caught instanceof GeminiClientError &&
      caught.status === 400 &&
      caught.message.includes("400");
    results.noRetryOn400 = {
      callCount,
      isGeminiClientError: caught instanceof GeminiClientError,
      status: caught?.status,
      message: caught?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 5. Missing API key throws before any request is made, and error message contains no key
  {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount++;
      return new Response(makeStream([]), { status: 200 });
    };

    let caught = null;
    try {
      const client = new GeminiModelClient({
        apiKey: "",
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
      caught instanceof GeminiClientError &&
      typeof caught.message === "string" &&
      caught.message.length > 0 &&
      !caught.message.includes("AIza");

    results.missingApiKey = {
      callCount,
      isGeminiClientError: caught instanceof GeminiClientError,
      message: caught?.message,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 6. Error message never contains the key or URL even when fake fetch fails with key in error
  {
    const secretKey = "FAKE_SECRET_KEY_XYZ_987654";
    const fakeFetch = async (url, init) => {
      const hdrKey = init?.headers?.["x-goog-api-key"];
      throw new Error(`Fetch exploded at ${url} with x-goog-api-key=${hdrKey}`);
    };

    const client = new GeminiModelClient({
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
      caught instanceof GeminiClientError &&
      !msg.includes(secretKey) &&
      !msg.includes("generativelanguage.googleapis.com") &&
      !msg.includes("https://");

    results.sanitizedError = {
      isGeminiClientError: caught instanceof GeminiClientError,
      message: msg,
      containsKey: msg.includes(secretKey),
      containsUrl: msg.includes("https://"),
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 7. Pure parseSseText parser handles multiple parts and CRLF/LF split chunks
  {
    const raw =
      'data: {"candidates":[{"content":{"parts":[{"text":"A"},{"text":"B"}]}}]}\r\n\r\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"C"}]}}]}\n\n';
    const pieces = [raw.slice(0, 15), raw.slice(15, 50), raw.slice(50)];
    const out = [];
    for await (const txt of parseSseText(pieces)) {
      out.push(txt);
    }
    const valid = out.length === 3 && out.join("") === "ABC";
    results.parseSsePure = { out, valid };
    if (!valid) results.passed = false;
  }

  // 8. Consumer stopping early aborts AbortController cleanly
  {
    let wasAborted = false;
    const fakeFetch = async (_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        wasAborted = true;
      });
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(sseData("first")));
          controller.enqueue(enc.encode(sseData("second")));
          // Keep stream open until cancelled
        },
        cancel() {
          wasAborted = true;
        },
      });
      return new Response(stream, { status: 200 });
    };

    const client = new GeminiModelClient({
      apiKey: "test-secret-abort",
      fetch: fakeFetch,
    });
    const collected = [];
    for await (const text of client.generateStream("abort early")) {
      collected.push(text);
      break;
    }

    const valid = collected.length === 1 && collected[0] === "first" && wasAborted;
    results.abortOnEarlyStop = { collected, wasAborted, valid };
    if (!valid) results.passed = false;
  }

  // 9. Timeout aborts via AbortController and throws GeminiClientError
  {
    let wasAborted = false;
    const fakeFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          wasAborted = true;
          reject(new Error("Aborted"));
        });
      });

    const client = new GeminiModelClient({
      apiKey: "test-secret-timeout",
      fetch: fakeFetch,
      timeoutMs: 30,
      maxRetries: 0,
    });

    let caught = null;
    try {
      for await (const _ of client.generateStream("timeout")) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    const valid =
      wasAborted &&
      caught instanceof GeminiClientError &&
      caught.message.includes("timed out");
    results.timeoutAbort = { wasAborted, message: caught?.message, valid };
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
