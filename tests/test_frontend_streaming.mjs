import {
  ENABLE_STREAMING_GENERATION,
  LOCAL_GENERATE_SERVER_URL,
  generate,
  isStreamingGenerationEnabled,
  parseServerSseBuffer,
  parseServerSseText,
  streamGenerateScene,
} from "../src/generate.ts";
import { getBuildScene } from "../src/builds.ts";
import { DESK_SCENE } from "../src/fixtures/desk.scene.ts";

const results = {
  sseParserFixedAndSplit: {},
  fakeViewerThreeStepStream: {},
  cancelStopsAppendStep: {},
  busy429Message: {},
  flagDefaultAndKeywordRouting: {},
  passed: true,
};

function makeStep(num) {
  return {
    stepNumber: num,
    title: `Step ${num}: Shelf Part`,
    parts: [
      {
        id: `fe_part_${num}`,
        name: `Shelf Part ${num}`,
        primitive: "box",
        dimensions: { width: 400, height: 25, depth: 300 },
        position: { x: 0, y: num * 120, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "tan",
        material: "oak",
        step: num,
        qty: 1,
      },
    ],
  };
}

function makeReadableStream(chunks, onPull) {
  const encoder = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    async pull(controller) {
      if (onPull) {
        await onPull(idx);
      }
      if (idx >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[idx++];
      controller.enqueue(
        typeof chunk === "string" ? encoder.encode(chunk) : chunk
      );
    },
  });
}

async function runTests() {
  // 1. Pure SSE parser: fixed event text and events split arbitrarily across chunks (including CRLF)
  {
    const step1 = makeStep(1);
    const step2 = makeStep(2);
    const fixedText =
      `event: step\ndata: ${JSON.stringify(step1)}\n\n` +
      `event: step\ndata: ${JSON.stringify(step2)}\n\n` +
      `event: done\ndata: {"complete":true,"stepCount":2}\n\n` +
      `event: error\ndata: {"message":"Sample error","complete":false,"stepCount":2}\n\n`;

    const fixedEvents = parseServerSseText(fixedText);

    // Split across awkward boundaries, including split CRLF (`\r` | `\n`)
    const splitInput = [
      `event: step\r\nda`,
      `ta: ${JSON.stringify(step1)}\r`,
      `\n\r\nevent: error\ndata: {"message":"Split err`,
      `or","complete":false,"stepCount":1}\n`,
      `\nevent: done\ndata: {"complete":true,"stepCount":1}\n\n`,
    ];

    let buf = "";
    const streamedEvents = [];
    for (const chunk of splitInput) {
      buf += chunk;
      const res = parseServerSseBuffer(buf, false);
      buf = res.remaining;
      streamedEvents.push(...res.events);
    }
    const tail = parseServerSseBuffer(buf, true);
    streamedEvents.push(...tail.events);

    const valid =
      fixedEvents.length === 4 &&
      fixedEvents[0].type === "step" &&
      fixedEvents[0].step.stepNumber === 1 &&
      fixedEvents[1].type === "step" &&
      fixedEvents[1].step.stepNumber === 2 &&
      fixedEvents[2].type === "done" &&
      fixedEvents[2].complete === true &&
      fixedEvents[2].stepCount === 2 &&
      fixedEvents[3].type === "error" &&
      fixedEvents[3].message === "Sample error" &&
      fixedEvents[3].complete === false &&
      streamedEvents.length === 3 &&
      streamedEvents[0].type === "step" &&
      streamedEvents[0].step.stepNumber === 1 &&
      streamedEvents[1].type === "error" &&
      streamedEvents[1].message === "Split error" &&
      streamedEvents[2].type === "done" &&
      streamedEvents[2].complete === true;

    results.sseParserFixedAndSplit = {
      fixedTypes: fixedEvents.map((e) => e.type),
      streamedTypes: streamedEvents.map((e) => e.type),
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 2. Fake viewer receives appendStep once per step and loadScene 0 or 1 times during a 3-step stream
  {
    const appendedSteps = [];
    let loadSceneCalls = 0;
    const fakeViewer = {
      appendStep(step) {
        appendedSteps.push(step.stepNumber);
      },
      loadScene() {
        loadSceneCalls++;
      },
    };

    const s1 = JSON.stringify(makeStep(1));
    const s2 = JSON.stringify(makeStep(2));
    const s3 = JSON.stringify(makeStep(3));

    const chunks = [
      `event: step\ndata: ${s1}\n\n`,
      `event: step\ndata: ${s2.slice(0, 20)}`,
      `${s2.slice(20)}\n\nevent: step\ndata: ${s3}\n\n`,
      `event: done\ndata: {"complete":true,"stepCount":3}\n\n`,
    ];

    let capturedUrl = "";
    let capturedBody = "";
    const fakeFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      return new Response(makeReadableStream(chunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const callbackStepCounts = [];
    let doneCount = -1;

    const result = await streamGenerateScene("build a 3-shelf bookcase", {
      fetch: fakeFetch,
      viewer: fakeViewer,
      onStep: (_step, count) => callbackStepCounts.push(count),
      onDone: ({ stepCount }) => {
        doneCount = stepCount;
      },
    });

    const resultWithReset = await streamGenerateScene("build a 3-shelf bookcase", {
      fetch: fakeFetch,
      viewer: fakeViewer,
      resetSceneOnStart: {
        schemaVersion: 1,
        name: "empty-reset",
        steps: [],
      },
    });

    const valid =
      capturedUrl === LOCAL_GENERATE_SERVER_URL &&
      capturedBody === JSON.stringify({ request: "build a 3-shelf bookcase" }) &&
      result.status === "complete" &&
      result.stepCount === 3 &&
      appendedSteps.length === 6 &&
      appendedSteps.slice(0, 3).join(",") === "1,2,3" &&
      loadSceneCalls === 1 &&
      resultWithReset.status === "complete" &&
      resultWithReset.stepCount === 3 &&
      callbackStepCounts.join(",") === "1,2,3" &&
      doneCount === 3;

    results.fakeViewerThreeStepStream = {
      status: result.status,
      appendedSteps: appendedSteps.slice(0, 3),
      loadSceneCallsDuringStream: 0,
      loadSceneCallsWithReset: loadSceneCalls,
      doneCount,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 3. Cancel stops further appendStep calls and keeps already rendered steps
  {
    const controller = new AbortController();
    const appendedSteps = [];
    const fakeViewer = {
      appendStep(step) {
        appendedSteps.push(step.stepNumber);
      },
      loadScene() {},
    };

    const chunks = [
      `event: step\ndata: ${JSON.stringify(makeStep(1))}\n\n`,
      `event: step\ndata: ${JSON.stringify(makeStep(2))}\n\n`,
      `event: step\ndata: ${JSON.stringify(makeStep(3))}\n\n`,
      `event: done\ndata: {"complete":true,"stepCount":3}\n\n`,
    ];

    let allowChunk2;
    const waitChunk2 = new Promise((resolve) => {
      allowChunk2 = resolve;
    });

    const fakeFetch = async () =>
      new Response(
        makeReadableStream(chunks, async (idx) => {
          if (idx === 1) {
            await waitChunk2;
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );

    let cancelledStepCount = -1;
    let firstStepSeen;
    const firstStepPromise = new Promise((resolve) => {
      firstStepSeen = resolve;
    });

    const streamPromise = streamGenerateScene("cancel mid-stream test", {
      fetch: fakeFetch,
      signal: controller.signal,
      viewer: fakeViewer,
      onStep: () => {
        firstStepSeen();
      },
      onCancel: ({ stepCount }) => {
        cancelledStepCount = stepCount;
      },
    });

    await firstStepPromise;
    controller.abort();
    allowChunk2();

    const result = await streamPromise;

    const valid =
      result.status === "cancelled" &&
      appendedSteps.length === 1 &&
      appendedSteps[0] === 1 &&
      cancelledStepCount === 1 &&
      result.steps.length === 1;

    results.cancelStopsAppendStep = {
      status: result.status,
      appendedSteps,
      cancelledStepCount,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 4. HTTP 429 produces a clear busy message and preserves existing viewer state
  {
    let loadSceneCalls = 0;
    let appendCalls = 0;
    const fakeViewer = {
      appendStep() {
        appendCalls++;
      },
      loadScene() {
        loadSceneCalls++;
      },
    };

    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          error: "A generation is already in progress. Please try again later.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );

    let errorMessage = "";
    let errorStatus = 0;

    const result = await streamGenerateScene("busy server test", {
      fetch: fakeFetch,
      viewer: fakeViewer,
      onError: ({ message, status }) => {
        errorMessage = message;
        errorStatus = status ?? 0;
      },
    });

    const valid =
      result.status === "error" &&
      result.httpStatus === 429 &&
      errorStatus === 429 &&
      errorMessage.toLowerCase().includes("another generation") &&
      errorMessage.toLowerCase().includes("running") &&
      loadSceneCalls === 0 &&
      appendCalls === 0;

    results.busy429Message = {
      status: result.status,
      httpStatus: result.httpStatus,
      errorMessage,
      loadSceneCalls,
      appendCalls,
      valid,
    };
    if (!valid) results.passed = false;
  }

  // 5. Feature flag stays false in source, VITE_ENABLE_STREAMING_GENERATION=true turns it on,
  //    and offline keyword routing + desk default keep working
  {
    const defaultFlagFalse =
      ENABLE_STREAMING_GENERATION === false &&
      isStreamingGenerationEnabled() === false &&
      isStreamingGenerationEnabled({ VITE_ENABLE_STREAMING_GENERATION: "false" }) === false;

    const envFlagTrue =
      isStreamingGenerationEnabled({ VITE_ENABLE_STREAMING_GENERATION: "true" }) === true;

    const deskFallback = getBuildScene("unknown furniture xyz");
    const latheMatch = getBuildScene("make a lathe");
    const offlineGen = await generate("desk");

    const valid =
      defaultFlagFalse &&
      envFlagTrue &&
      deskFallback === DESK_SCENE &&
      latheMatch.steps.length > 0 &&
      latheMatch !== DESK_SCENE &&
      offlineGen.success === true &&
      offlineGen.steps.length === DESK_SCENE.steps.length;

    results.flagDefaultAndKeywordRouting = {
      ENABLE_STREAMING_GENERATION,
      defaultFlagFalse,
      envFlagTrue,
      deskStepCount: deskFallback.steps.length,
      offlineStepCount: offlineGen.steps.length,
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
