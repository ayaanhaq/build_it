import { startGenerateServer } from "../server/generateServer.ts";
import { FakeModelClient } from "../src/generatePipeline.ts";

const results = {
  validStreamsStepAndDone: {},
  corsAllowedAndRejected: {},
  invalidBodiesReturn400: {},
  concurrentRequestReturns429: {},
  keyRedactedAcrossEventsAndErrors: {},
  missingKeyReturns500: {},
  portEnvOverrideRespected: {},
  passed: true,
};

function makeStepJson(num, titleOverride) {
  return JSON.stringify({
    stepNumber: num,
    title: titleOverride ?? `Step ${num}: Assembly Component`,
    parts: [
      {
        id: `srv_part_${num}`,
        name: `Server Part ${num}`,
        primitive: "box",
        dimensions: { width: 400, height: 25, depth: 300 },
        position: { x: 0, y: num * 100, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "tan",
        material: "oak",
        step: num,
        qty: 1,
      },
    ],
  });
}

function parseSseBlockList(rawText) {
  const events = [];
  const normalized = rawText.replace(/\r\n/g, "\n");
  for (const block of normalized.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let eventName = "message";
    const dataLines = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length > 0) {
      events.push({
        event: eventName,
        data: JSON.parse(dataLines.join("\n")),
      });
    }
  }
  return events;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}

async function runTests() {
  // 1. Valid request streams "step" events followed by "done"
  {
    const fakeKey = "FAKE_SERVER_KEY_VALID_111";
    const { server, url } = await startGenerateServer({
      port: 0,
      env: { GEMINI_API_KEY: fakeKey },
      clientFactory: () =>
        new FakeModelClient([
          [makeStepJson(1) + "\n", makeStepJson(2) + "\n"],
        ]),
    });

    try {
      const resp = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "  build a bookcase  " }),
      });

      const bodyText = await resp.text();
      const events = parseSseBlockList(bodyText);

      const valid =
        resp.status === 200 &&
        resp.headers.get("content-type")?.includes("text/event-stream") &&
        resp.headers.get("access-control-allow-origin") === "http://localhost:5173" &&
        events.length === 3 &&
        events[0].event === "step" &&
        events[0].data.stepNumber === 1 &&
        events[1].event === "step" &&
        events[1].data.stepNumber === 2 &&
        events[2].event === "done" &&
        events[2].data.complete === true &&
        events[2].data.stepCount === 2 &&
        !bodyText.includes(fakeKey);

      results.validStreamsStepAndDone = {
        status: resp.status,
        eventNames: events.map((e) => e.event),
        doneData: events[2]?.data,
        valid,
      };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 2. CORS preflight allowed for http://localhost:5173, other origins rejected with 403
  {
    const { server, url } = await startGenerateServer({
      port: 0,
      env: { GEMINI_API_KEY: "FAKE_CORS_KEY" },
      clientFactory: () => new FakeModelClient([[makeStepJson(1) + "\n"]]),
    });

    try {
      const preflight = await fetch(`${url}/api/generate`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
        },
      });

      const evilPost = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.example.com",
        },
        body: JSON.stringify({ request: "build a desk" }),
      });

      const wrongPortPost = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ request: "build a desk" }),
      });

      const valid =
        preflight.status === 204 &&
        preflight.headers.get("access-control-allow-origin") === "http://localhost:5173" &&
        evilPost.status === 403 &&
        evilPost.headers.get("access-control-allow-origin") === null &&
        wrongPortPost.status === 403 &&
        wrongPortPost.headers.get("access-control-allow-origin") === null;

      results.corsAllowedAndRejected = {
        preflightStatus: preflight.status,
        evilStatus: evilPost.status,
        wrongPortStatus: wrongPortPost.status,
        valid,
      };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 3. Invalid bodies return 400
  {
    const { server, url } = await startGenerateServer({
      port: 0,
      env: { GEMINI_API_KEY: "FAKE_BAD_BODY_KEY" },
      clientFactory: () => new FakeModelClient([[makeStepJson(1) + "\n"]]),
    });

    try {
      const badPayloads = [
        { label: "malformedJson", raw: "{not valid json" },
        { label: "emptyString", raw: JSON.stringify({ request: "   " }) },
        { label: "nonString", raw: JSON.stringify({ request: 42 }) },
        { label: "missingField", raw: JSON.stringify({ prompt: "desk" }) },
        { label: "tooLong", raw: JSON.stringify({ request: "a".repeat(501) }) },
      ];

      const statuses = {};
      let all400 = true;

      for (const item of badPayloads) {
        const r = await fetch(`${url}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
          },
          body: item.raw,
        });
        statuses[item.label] = r.status;
        if (r.status !== 400) {
          all400 = false;
        }
      }

      results.invalidBodiesReturn400 = { statuses, valid: all400 };
      if (!all400) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 4. Second concurrent request returns 429 while first generation is active
  {
    let releaseFirstChunk;
    const firstChunkGate = new Promise((resolve) => {
      releaseFirstChunk = resolve;
    });
    let firstStreamEntered;
    const enteredPromise = new Promise((resolve) => {
      firstStreamEntered = resolve;
    });

    const { server, url } = await startGenerateServer({
      port: 0,
      env: { GEMINI_API_KEY: "FAKE_CONCURRENCY_KEY" },
      clientFactory: () => ({
        async *generateStream(prompt) {
          if (prompt.includes("first build")) {
            firstStreamEntered();
            await firstChunkGate;
          }
          yield makeStepJson(1) + "\n";
        },
      }),
    });

    try {
      const firstPromise = fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "first build" }),
      });

      await enteredPromise;

      const secondResp = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "concurrent second build" }),
      });

      releaseFirstChunk();
      const firstResp = await firstPromise;
      const firstText = await firstResp.text();
      const firstEvents = parseSseBlockList(firstText);

      // Verify lock releases after completion so a subsequent request gets 200
      const thirdResp = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "follow-up build" }),
      });
      await thirdResp.text();

      const valid =
        secondResp.status === 429 &&
        firstResp.status === 200 &&
        thirdResp.status === 200 &&
        firstEvents.some((e) => e.event === "done" && e.data.complete === true);

      results.concurrentRequestReturns429 = {
        secondStatus: secondResp.status,
        firstStatus: firstResp.status,
        thirdStatus: thirdResp.status,
        firstEventNames: firstEvents.map((e) => e.event),
        valid,
      };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 5. Key never appears in any response even if the fake client echoes it in a step and/or throws it
  {
    const fakeKey = "SUPER_SECRET_FAKE_GEMINI_KEY_XYZ_987";
    const stepEchoingKey = makeStepJson(1, `Oak Shelf ${fakeKey}`) + "\n";

    const { server, url } = await startGenerateServer({
      port: 0,
      env: { GEMINI_API_KEY: fakeKey },
      clientFactory: () => ({
        async *generateStream() {
          yield stepEchoingKey;
          throw new Error(`Upstream exploded with key=${fakeKey}`);
        },
      }),
    });

    try {
      const resp = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "echo secret test" }),
      });

      const bodyText = await resp.text();
      const events = parseSseBlockList(bodyText);

      const stepEvt = events.find((e) => e.event === "step");
      const errEvt = events.find((e) => e.event === "error");

      const valid =
        resp.status === 200 &&
        !bodyText.includes(fakeKey) &&
        Boolean(stepEvt) &&
        stepEvt.data.title.includes("[REDACTED]") &&
        Boolean(errEvt) &&
        errEvt.data.complete === false &&
        errEvt.data.stepCount === 1 &&
        errEvt.data.message.includes("[REDACTED]");

      results.keyRedactedAcrossEventsAndErrors = {
        containsKey: bodyText.includes(fakeKey),
        eventNames: events.map((e) => e.event),
        stepTitle: stepEvt?.data?.title,
        errorPayload: errEvt?.data,
        valid,
      };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 6. Missing GEMINI_API_KEY returns 500 cleanly without exposing secret
  {
    const { server, url } = await startGenerateServer({
      port: 0,
      env: {},
      clientFactory: () => new FakeModelClient([[makeStepJson(1) + "\n"]]),
    });

    try {
      const resp = await fetch(`${url}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ request: "missing key check" }),
      });
      const json = await resp.json();
      const valid =
        resp.status === 500 &&
        typeof json.error === "string" &&
        json.error.includes("GEMINI_API_KEY");

      results.missingKeyReturns500 = {
        status: resp.status,
        error: json.error,
        valid,
      };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
  }

  // 7. PORT environment variable override is respected
  {
    // First find a free port briefly or pick an unlikely ephemeral port; bind 0 first?
    // Test binding via PORT env var by picking a free port discovered cleanly on 127.0.0.1:
    const probe = await startGenerateServer({ port: 0, env: { GEMINI_API_KEY: "k" } });
    const freePort = probe.port;
    await closeServer(probe.server);

    const { server, port, url } = await startGenerateServer({
      env: { GEMINI_API_KEY: "FAKE_PORT_KEY", PORT: String(freePort) },
    });
    try {
      const valid = port === freePort && url === `http://127.0.0.1:${freePort}`;
      results.portEnvOverrideRespected = { freePort, port, url, valid };
      if (!valid) results.passed = false;
    } finally {
      await closeServer(server);
    }
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
