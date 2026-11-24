import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../scripts/generate-scene.ts";
import { FakeModelClient } from "../src/generatePipeline.ts";

const results = {
  saveValidJsonWithoutRawOutput: {},
  debugWritesStderrNeverKey: {},
  failedRunSavesPartialIncomplete: {},
  saveWithoutPathFails: {},
  passed: true,
};

function makeStepJson(num) {
  return JSON.stringify({
    stepNumber: num,
    title: `Step ${num}: Shelf Component`,
    parts: [
      {
        id: `shelf_part_${num}`,
        name: `Part ${num}`,
        primitive: "box",
        dimensions: { width: 400, height: 25, depth: 300 },
        position: { x: 0, y: num * 300, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "tan",
        material: "oak",
        step: num,
        qty: 1,
      },
    ],
  });
}

function makeBuffers() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    getStdout: () => out,
    getStderr: () => err,
  };
}

async function runTests() {
  const tempDir = mkdtempSync(join(tmpdir(), "build-it-cli-test-"));
  try {
    // 1. --save writes valid JSON with complete: true, no key, and no rawOutput without --debug
    {
      const fakeKey = "FAKE_SECRET_KEY_SAVE_ONLY_123";
      const outPath = join(tempDir, "valid-build.json");
      const io = makeBuffers();

      const exitCode = await runCli(["--save", outPath, "build a 2-shelf bookcase"], {
        env: { GEMINI_API_KEY: fakeKey },
        stdout: io.stdout,
        stderr: io.stderr,
        clientFactory: () =>
          new FakeModelClient([[makeStepJson(1) + "\n", makeStepJson(2) + "\n"]]),
      });

      const fileText = readFileSync(outPath, "utf8");
      const saved = JSON.parse(fileText);

      const valid =
        exitCode === 0 &&
        saved.schemaVersion === 1 &&
        saved.request === "build a 2-shelf bookcase" &&
        saved.complete === true &&
        Array.isArray(saved.steps) &&
        saved.steps.length === 2 &&
        saved.rawOutput === undefined &&
        !fileText.includes(fakeKey) &&
        !io.getStdout().includes(fakeKey) &&
        io.getStderr() === "";

      results.saveValidJsonWithoutRawOutput = {
        exitCode,
        complete: saved.complete,
        stepCount: saved.steps?.length,
        hasRawOutput: saved.rawOutput !== undefined,
        containsKey: fileText.includes(fakeKey),
        valid,
      };
      if (!valid) results.passed = false;
    }

    // 2. --debug prints raw model chunks to stderr and never prints the API key (even if echoed)
    {
      const fakeKey = "FAKE_SECRET_DEBUG_KEY_999";
      const outPath = join(tempDir, "debug-build.json");
      const io = makeBuffers();
      const chunk1 = makeStepJson(1) + "\n";
      // Inject fakeKey inside a raw chunk line comment/bad-step or error test:
      // Test with valid stream + raw chunk debug output first, plus secret redaction in chunk text
      const stepWithKeyInRaw = JSON.stringify({
        stepNumber: 1,
        title: `Step 1 (${fakeKey})`,
        parts: [
          {
            id: "dbg_part_1",
            name: "Debug Part",
            primitive: "box",
            dimensions: { width: 100, height: 25, depth: 100 },
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            color: "tan",
            material: "oak",
            step: 1,
            qty: 1,
          },
        ],
      }) + "\n";

      const exitCode = await runCli(
        ["--debug", "--save", outPath, "debug key leak test"],
        {
          env: { GEMINI_API_KEY: fakeKey },
          stdout: io.stdout,
          stderr: io.stderr,
          clientFactory: () => new FakeModelClient([[stepWithKeyInRaw]]),
        }
      );

      const stderrText = io.getStderr();
      const stdoutText = io.getStdout();
      const savedText = readFileSync(outPath, "utf8");
      const saved = JSON.parse(savedText);

      const valid =
        exitCode === 0 &&
        stderrText.includes('"id":"dbg_part_1"') &&
        stderrText.includes("[REDACTED]") &&
        !stderrText.includes(fakeKey) &&
        !savedText.includes(fakeKey) &&
        typeof saved.rawOutput === "string";

      results.debugWritesStderrNeverKey = {
        exitCode,
        stderrHasRawChunk: stderrText.includes("dbg_part_1"),
        stderrContainsKey: stderrText.includes(fakeKey),
        stdoutHasJson: stdoutText.trim().length > 0,
        savedHasRawOutput: typeof saved.rawOutput === "string",
        savedContainsKey: savedText.includes(fakeKey),
        valid,
      };
      if (!valid) results.passed = false;
    }

    // 3. Failed run still writes partial --save file marked "complete": false with passing steps
    {
      const fakeKey = "FAKE_SECRET_PARTIAL_KEY_456";
      const outPath = join(tempDir, "partial-build.json");
      const io = makeBuffers();

      const invalidStep2 = JSON.stringify({
        stepNumber: 2,
        title: "Step 2: Broken",
        parts: [
          {
            id: "broken_2",
            name: "Broken",
            primitive: "box",
            dimensions: { width: 9999, height: 25, depth: 100 },
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            color: "tan",
            material: "oak",
            step: 2,
            qty: 1,
          },
        ],
      }) + "\n";

      const exitCode = await runCli(
        ["--save", outPath, "partial fail build"],
        {
          env: { GEMINI_API_KEY: fakeKey },
          stdout: io.stdout,
          stderr: io.stderr,
          clientFactory: () =>
            new FakeModelClient([
              [makeStepJson(1) + "\n", invalidStep2],
              [invalidStep2],
              [invalidStep2],
              [invalidStep2],
            ]),
        }
      );

      const savedText = readFileSync(outPath, "utf8");
      const saved = JSON.parse(savedText);

      const valid =
        exitCode !== 0 &&
        saved.complete === false &&
        Array.isArray(saved.steps) &&
        saved.steps.length === 1 &&
        saved.steps[0].stepNumber === 1 &&
        typeof saved.error === "string" &&
        !savedText.includes(fakeKey);

      results.failedRunSavesPartialIncomplete = {
        exitCode,
        complete: saved.complete,
        savedStepCount: saved.steps?.length,
        hasError: typeof saved.error === "string",
        valid,
      };
      if (!valid) results.passed = false;
    }

    // 4. --save with missing path exits non-zero cleanly
    {
      const io = makeBuffers();
      const exitCode = await runCli(["build test", "--save"], {
        env: { GEMINI_API_KEY: "unused" },
        stdout: io.stdout,
        stderr: io.stderr,
      });

      const valid = exitCode !== 0 && io.getStderr().includes("--save");
      results.saveWithoutPathFails = {
        exitCode,
        stderr: io.getStderr().trim(),
        valid,
      };
      if (!valid) results.passed = false;
    }

    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    if (!results.passed) {
      process.exit(1);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
