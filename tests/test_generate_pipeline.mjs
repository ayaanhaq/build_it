import {
  FakeModelClient,
  buildPrompt,
  parseStreamedSteps,
  generateScene,
  DEFAULT_MAX_RETRIES_PER_STEP,
  ALLOWED_PALETTE_NAMES,
} from '../src/generatePipeline.ts';
import { PRIMITIVE_BOUNDS } from '../src/sceneValidator.ts';
import {
  MM_PER_VIEWER_UNIT,
  normalizeSceneToViewerUnits,
  VIEWER_PRIMITIVE_BOUNDS,
} from '../src/sceneUnits.ts';
import { sceneStepToBuildStep } from '../src/builds.ts';
import { DESK_SCENE } from '../src/fixtures/desk.scene.ts';

const testResults = {
  buildPrompt: {},
  cleanThreeSteps: {},
  badStepFixedOnRetry: {},
  neverFixedExceedsRetries: {},
  partialLineSplitAcrossChunks: {},
  malformedJsonLinePreservesRemaining: {},
  fencedSingleLineOutput: {},
  fencedSplitAcrossChunks: {},
  unclosedFenceFailsClearly: {},
  plainUnfencedWithBackticksInJsonString: {},
  retryReusesFailedStepPartId: {},
  realDuplicateAcrossValidStepsRejected: {},
  prettyPrinted20Lines: {},
  bracesInsideStringValue: {},
  escapedQuotesInString: {},
  missingClosingBraceAtCapAndEof: {},
  malformedObjectPreservesLaterPrettyObjects: {},
  fencedPrettyPrintedStream: {},
  normalizeBackPanelAndDistance: {},
  scaleTogetherAndPreserveAnglesQty: {},
  normalizeDoesNotMutateInput: {},
  endToEndMmNormalizesAndValidates: {},
  unitLabelsCmForGeneratedDeskUnchanged: {},
  backPanel1800MmBecomes180Not18: {},
  promptDoesNotAskForCentimeters: {},
  clampDistanceLowFor180CmModel: {},
  distanceUnchangedWhenWithinBounds: {},
  missingCameraPresetSetsDefaults: {},
  deskFixtureDistancesUntouched: {},
  passed: true,
};

function makeStepJson(num, overrides = {}) {
  const step = {
    stepNumber: num,
    title: `Step ${num}: Assembly Component`,
    subtitle: `Step ${num} Subtitle`,
    description: `Description for step ${num}`,
    parts: [
      {
        id: `part_${num}_box`,
        name: `Box Part ${num}`,
        primitive: 'box',
        dimensions: { width: 50, height: 100, depth: 50 },
        position: { x: num * 10, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: num,
        qty: 1,
      },
    ],
    ...overrides,
  };
  return JSON.stringify(step);
}

async function runTests() {
  // 1. buildPrompt verification
  const dummySchema = { type: 'object', properties: { schemaVersion: { type: 'integer' } } };
  const prompt = buildPrompt('Custom Oak Bookshelf', dummySchema, PRIMITIVE_BOUNDS, ALLOWED_PALETTE_NAMES);

  const containsRequest = prompt.includes('Custom Oak Bookshelf');
  const containsSchema = prompt.includes('schemaVersion');
  const containsPrimitives = ['box', 'cylinder', 'lathe', 'bevel', 'spring'].every((p) =>
    prompt.includes(p)
  );
  const containsBounds = prompt.includes('5000') && prompt.includes('2500');
  const staysMillimeters =
    prompt.includes('MILLIMETERS') &&
    !/centimeters?/i.test(prompt) &&
    !/\bcm\b/i.test(prompt);
  const containsPalettes = ['tan', 'ink', 'sun', 'brown'].every((c) => prompt.includes(c));

  testResults.buildPrompt = {
    containsRequest,
    containsSchema,
    containsPrimitives,
    containsBounds,
    staysMillimeters,
    containsPalettes,
    valid:
      containsRequest &&
      containsSchema &&
      containsPrimitives &&
      containsBounds &&
      staysMillimeters &&
      containsPalettes,
  };
  if (!testResults.buildPrompt.valid) testResults.passed = false;

  // 2. Clean 3-step stream produces 3 valid steps
  const cleanChunks = [
    makeStepJson(1) + '\n',
    makeStepJson(2) + '\n',
    makeStepJson(3) + '\n',
  ];
  const client1 = new FakeModelClient([cleanChunks]);
  const res1 = await generateScene('build 3 step desk', client1);

  testResults.cleanThreeSteps = {
    success: res1.success,
    stepCount: res1.steps.length,
    retriesCount: res1.retriesLogged.length,
    valid: res1.success && res1.steps.length === 3 && res1.retriesLogged.length === 0,
  };
  if (!testResults.cleanThreeSteps.valid) testResults.passed = false;

  // 3. Stream with one bad step fixed on retry produces 3 valid steps and 1 logged retry
  const badStep2 = {
    stepNumber: 2,
    title: 'Step 2: Bad Box',
    parts: [
      {
        id: 'bad_box_2',
        name: 'Oversized Box',
        primitive: 'box',
        dimensions: { width: 6000, height: 100, depth: 50 }, // exceeds 5000 mm bound
        position: { x: 20, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const fixedStep2Json = makeStepJson(2);

  const initialStreamChunks = [
    makeStepJson(1) + '\n',
    JSON.stringify(badStep2) + '\n',
    makeStepJson(3) + '\n',
  ];
  const retryStreamChunks = [fixedStep2Json + '\n'];

  const client2 = new FakeModelClient([initialStreamChunks, retryStreamChunks]);
  const res2 = await generateScene('build with 1 bad step', client2);

  testResults.badStepFixedOnRetry = {
    success: res2.success,
    stepCount: res2.steps.length,
    retriesCount: res2.retriesLogged.length,
    retryStepNumber: res2.retriesLogged[0]?.stepNumber,
    retryContainsError: res2.retriesLogged[0]?.errors?.some((e) => e.includes('outside bounds')),
    retryPromptRecorded: client2.recordedPrompts[1]?.includes('outside bounds'),
    valid:
      res2.success &&
      res2.steps.length === 3 &&
      res2.retriesLogged.length === 1 &&
      res2.retriesLogged[0]?.stepNumber === 2 &&
      res2.retriesLogged[0]?.errors?.some((e) => e.includes('outside bounds')),
  };
  if (!testResults.badStepFixedOnRetry.valid) testResults.passed = false;

  // 4. Stream that never fixes a step stops at retry limit and returns error + passing steps
  const unfixableBadStep2 = {
    stepNumber: 2,
    title: 'Step 2: Unfixable',
    parts: [
      {
        id: 'bad_prim_2',
        name: 'Bad Primitive',
        primitive: 'invalid_shape',
        dimensions: { width: 50, height: 100, depth: 50 },
        position: { x: 20, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const badStepJson = JSON.stringify(unfixableBadStep2) + '\n';

  const client3 = new FakeModelClient([
    [makeStepJson(1) + '\n', badStepJson],
    [badStepJson], // retry 1
    [badStepJson], // retry 2
    [badStepJson], // retry 3
  ]);

  const res3 = await generateScene('never fixed build', client3, { maxRetriesPerStep: 3 });

  testResults.neverFixedExceedsRetries = {
    success: res3.success,
    stepCount: res3.steps.length,
    retriesCount: res3.retriesLogged.length,
    errorMessage: res3.error,
    valid:
      res3.success === false &&
      res3.steps.length === 1 &&
      res3.retriesLogged.length === 3 &&
      typeof res3.error === 'string' &&
      res3.error.includes('failed validation after 3 retries') &&
      res3.error.includes('unknown primitive type'),
  };
  if (!testResults.neverFixedExceedsRetries.valid) testResults.passed = false;

  // 5. Partial line split across chunks is parsed correctly
  const splitChunks = [
    '{"stepNumber": 1, "title": "Spl',
    'it Step", "parts": [',
    '{"id": "p1", "name": "Box", "primitive": "box", "dimensions": {"width": 10, "height": 10, "depth": 10}, ',
    '"position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}, "color": "tan", "material": "oak", "step": 1, "qty": 1}',
    ']}\n',
  ];

  const parsedSplitSteps = [];
  for await (const item of parseStreamedSteps(splitChunks)) {
    parsedSplitSteps.push(item);
  }

  testResults.partialLineSplitAcrossChunks = {
    count: parsedSplitSteps.length,
    hasStep: Boolean(parsedSplitSteps[0]?.step),
    stepTitle: parsedSplitSteps[0]?.step?.title,
    valid:
      parsedSplitSteps.length === 1 &&
      parsedSplitSteps[0]?.step?.stepNumber === 1 &&
      parsedSplitSteps[0]?.step?.title === 'Split Step',
  };
  if (!testResults.partialLineSplitAcrossChunks.valid) testResults.passed = false;

  // 6. Malformed JSON on one line is reported and remaining steps still arrive
  const malformedStream = [
    makeStepJson(1) + '\n',
    '{ THIS IS BROKEN MALFORMED JSON }\n',
    makeStepJson(2) + '\n',
  ];

  const parsedMalformedItems = [];
  for await (const item of parseStreamedSteps(malformedStream)) {
    parsedMalformedItems.push(item);
  }

  testResults.malformedJsonLinePreservesRemaining = {
    totalItems: parsedMalformedItems.length,
    firstStepNum: parsedMalformedItems[0]?.step?.stepNumber,
    secondItemIsError: Boolean(parsedMalformedItems[1]?.error),
    secondRawLine: parsedMalformedItems[1]?.rawLine,
    thirdStepNum: parsedMalformedItems[2]?.step?.stepNumber,
    valid:
      parsedMalformedItems.length === 3 &&
      parsedMalformedItems[0]?.step?.stepNumber === 1 &&
      typeof parsedMalformedItems[1]?.error === 'string' &&
      parsedMalformedItems[1]?.rawLine === '{ THIS IS BROKEN MALFORMED JSON }' &&
      parsedMalformedItems[2]?.step?.stepNumber === 2,
  };
  if (!testResults.malformedJsonLinePreservesRemaining.valid) testResults.passed = false;

  // 7. Fenced single-line output (with ```json and ```) parses cleanly
  const fencedStream = [
    '```json\n' + makeStepJson(1) + '\n' + makeStepJson(2) + '\n```\n',
  ];
  const fencedClient = new FakeModelClient([fencedStream]);
  const resFenced = await generateScene('fenced build', fencedClient);

  testResults.fencedSingleLineOutput = {
    success: resFenced.success,
    stepCount: resFenced.steps.length,
    valid: resFenced.success && resFenced.steps.length === 2,
  };
  if (!testResults.fencedSingleLineOutput.valid) testResults.passed = false;

  // 8. Fence split across chunks parses and preserves backticks inside JSON strings
  const stepWithBackticks = makeStepJson(1, {
    title: 'Step 1: Keep ``` inside string',
  });
  const splitFenceChunks = [
    '``',
    '`js',
    'on\n',
    stepWithBackticks.slice(0, 28),
    stepWithBackticks.slice(28, 60),
    stepWithBackticks.slice(60) + '\n',
    '``',
    '`\n',
  ];
  const splitFenceClient = new FakeModelClient([splitFenceChunks]);
  const resSplitFence = await generateScene('split fence build', splitFenceClient);

  testResults.fencedSplitAcrossChunks = {
    success: resSplitFence.success,
    stepCount: resSplitFence.steps.length,
    preservedTitle: resSplitFence.steps[0]?.title ?? '',
    valid:
      resSplitFence.success &&
      resSplitFence.steps.length === 1 &&
      resSplitFence.steps[0]?.title === 'Step 1: Keep ``` inside string',
  };
  if (!testResults.fencedSplitAcrossChunks.valid) testResults.passed = false;

  // 9. Unclosed fence fails with a clear error (no closing ```)
  const unclosedChunks = ['```json\n' + makeStepJson(1) + '\n'];
  const unclosedStreamItems = [];
  for await (const item of parseStreamedSteps(unclosedChunks)) {
    unclosedStreamItems.push(item);
  }
  const streamErr = unclosedStreamItems.find((i) => typeof i.error === 'string')?.error ?? '';

  const unclosedClient = new FakeModelClient([unclosedChunks]);
  const resUnclosed = await generateScene('unclosed fence build', unclosedClient, {
    maxRetriesPerStep: 0,
  });

  testResults.unclosedFenceFailsClearly = {
    success: resUnclosed.success,
    streamError: streamErr,
    pipelineError: resUnclosed.error ?? '',
    valid:
      resUnclosed.success === false &&
      streamErr.toLowerCase().includes('closing') &&
      (resUnclosed.error ?? '').toLowerCase().includes('closing'),
  };
  if (!testResults.unclosedFenceFailsClearly.valid) testResults.passed = false;

  // 10. Plain unfenced stream passes unchanged and leaves backticks in JSON strings intact
  const plainChunks = [
    makeStepJson(1, {
      description: 'Literal ```json and ``` inside JSON string field.',
    }) + '\n',
  ];
  const plainClient = new FakeModelClient([plainChunks]);
  const resPlain = await generateScene('plain unfenced build', plainClient);

  testResults.plainUnfencedWithBackticksInJsonString = {
    success: resPlain.success,
    stepCount: resPlain.steps.length,
    preservedDescription: resPlain.steps[0]?.description ?? '',
    valid:
      resPlain.success &&
      resPlain.steps.length === 1 &&
      resPlain.steps[0]?.description === 'Literal ```json and ``` inside JSON string field.',
  };
  if (!testResults.plainUnfencedWithBackticksInJsonString.valid) testResults.passed = false;

  // 11. Retry reusing part ID 'shelf-1' from failed step 2 is accepted
  const badShelfStep2 = {
    stepNumber: 2,
    title: 'Step 2: Shelf Board (Oversized)',
    parts: [
      {
        id: 'shelf-1',
        name: 'Shelf Board',
        primitive: 'box',
        dimensions: { width: 6000, height: 25, depth: 300 }, // exceeds 5000 mm bound
        position: { x: 0, y: 400, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const fixedShelfStep2 = {
    stepNumber: 2,
    title: 'Step 2: Shelf Board (Fixed)',
    parts: [
      {
        id: 'shelf-1',
        name: 'Shelf Board',
        primitive: 'box',
        dimensions: { width: 800, height: 25, depth: 300 },
        position: { x: 0, y: 400, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const reuseClient = new FakeModelClient([
    [makeStepJson(1) + '\n', JSON.stringify(badShelfStep2) + '\n'],
    [JSON.stringify(fixedShelfStep2) + '\n'],
  ]);
  const resReuse = await generateScene('bookcase reuse id on retry', reuseClient);

  testResults.retryReusesFailedStepPartId = {
    success: resReuse.success,
    stepCount: resReuse.steps.length,
    retriesCount: resReuse.retriesLogged.length,
    error: resReuse.error ?? '',
    valid:
      resReuse.success === true &&
      resReuse.steps.length === 2 &&
      resReuse.retriesLogged.length === 1 &&
      resReuse.steps[1]?.parts?.[0]?.id === 'shelf-1',
  };
  if (!testResults.retryReusesFailedStepPartId.valid) testResults.passed = false;

  // 12. Real duplicate part ID across two valid steps is still rejected with exact error text
  const validShelfStep1 = {
    stepNumber: 1,
    title: 'Step 1: First Shelf',
    parts: [
      {
        id: 'shelf-1',
        name: 'First Shelf',
        primitive: 'box',
        dimensions: { width: 800, height: 25, depth: 300 },
        position: { x: 0, y: 200, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 1,
        qty: 1,
      },
    ],
  };
  const validDuplicateShelfStep2 = {
    stepNumber: 2,
    title: 'Step 2: Duplicate Shelf',
    parts: [
      {
        id: 'shelf-1',
        name: 'Duplicate Shelf',
        primitive: 'box',
        dimensions: { width: 800, height: 25, depth: 300 },
        position: { x: 0, y: 600, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const dupClient = new FakeModelClient([
    [JSON.stringify(validShelfStep1) + '\n', JSON.stringify(validDuplicateShelfStep2) + '\n'],
  ]);
  const resDup = await generateScene('bookcase real duplicate id', dupClient, {
    maxRetriesPerStep: 0,
  });

  const expectedDupText =
    "Duplicate part ID 'shelf-1' already exists in an earlier step. Part IDs must be unique across the whole build.";
  testResults.realDuplicateAcrossValidStepsRejected = {
    success: resDup.success,
    stepCount: resDup.steps.length,
    error: resDup.error ?? '',
    valid:
      resDup.success === false &&
      resDup.steps.length === 1 &&
      typeof resDup.error === 'string' &&
      resDup.error.includes(expectedDupText),
  };
  if (!testResults.realDuplicateAcrossValidStepsRejected.valid) testResults.passed = false;

  // 13. Pretty-printed JSON step across ~20 lines parses
  const prettyStep1Obj = JSON.parse(makeStepJson(1, { title: 'Step 1: Pretty Multi-Line' }));
  const prettyText = JSON.stringify(prettyStep1Obj, null, 2);
  const prettyLineCount = prettyText.split('\n').length;
  const prettyChunks = [
    prettyText.slice(0, Math.floor(prettyText.length / 2)),
    prettyText.slice(Math.floor(prettyText.length / 2)) + '\n',
  ];
  const resPretty = await generateScene('pretty printed 20-line step', new FakeModelClient([prettyChunks]));

  testResults.prettyPrinted20Lines = {
    success: resPretty.success,
    lineCount: prettyLineCount,
    stepCount: resPretty.steps.length,
    stepTitle: resPretty.steps[0]?.title ?? '',
    valid:
      resPretty.success === true &&
      prettyLineCount >= 18 &&
      resPretty.steps.length === 1 &&
      resPretty.steps[0]?.title === 'Step 1: Pretty Multi-Line',
  };
  if (!testResults.prettyPrinted20Lines.valid) testResults.passed = false;

  // 14. Braces inside a string value ("{" and "}") do not end the object early
  const bracesStepJson = JSON.stringify(
    JSON.parse(
      makeStepJson(1, {
        title: 'Braces { open and } close inside {nested} value',
        description: '} leading close { and trailing {',
      })
    ),
    null,
    2
  );
  const parsedBracesItems = [];
  for await (const item of parseStreamedSteps([bracesStepJson])) {
    parsedBracesItems.push(item);
  }
  testResults.bracesInsideStringValue = {
    itemCount: parsedBracesItems.length,
    hasStep: Boolean(parsedBracesItems[0]?.step),
    title: parsedBracesItems[0]?.step?.title ?? '',
    description: parsedBracesItems[0]?.step?.description ?? '',
    valid:
      parsedBracesItems.length === 1 &&
      parsedBracesItems[0]?.step?.title === 'Braces { open and } close inside {nested} value' &&
      parsedBracesItems[0]?.step?.description === '} leading close { and trailing {',
  };
  if (!testResults.bracesInsideStringValue.valid) testResults.passed = false;

  // 15. Escaped quotes inside strings (and escaped backslashes) are handled
  const escapedStepJson = JSON.stringify(
    JSON.parse(
      makeStepJson(1, {
        title: 'Quote \\" } \\" and backslash \\\\"',
      })
    ),
    null,
    2
  );
  const parsedEscapedItems = [];
  for await (const item of parseStreamedSteps([escapedStepJson.slice(0, 35), escapedStepJson.slice(35)])) {
    parsedEscapedItems.push(item);
  }
  testResults.escapedQuotesInString = {
    itemCount: parsedEscapedItems.length,
    title: parsedEscapedItems[0]?.step?.title ?? '',
    valid:
      parsedEscapedItems.length === 1 &&
      parsedEscapedItems[0]?.step?.title === 'Quote \\" } \\" and backslash \\\\"',
  };
  if (!testResults.escapedQuotesInString.valid) testResults.passed = false;

  // 16. Missing closing brace produces an error at EOF and at the 64 KB cap
  const unclosedAtEofItems = [];
  for await (const item of parseStreamedSteps(['{\n  "stepNumber": 1,\n  "title": "No closing brace"'])) {
    unclosedAtEofItems.push(item);
  }
  const eofError = unclosedAtEofItems.find((i) => typeof i.error === 'string')?.error ?? '';

  const hugePadding = 'x'.repeat(65 * 1024);
  const overCapItems = [];
  for await (const item of parseStreamedSteps([`{"stepNumber": 1, "description": "${hugePadding}"`])) {
    overCapItems.push(item);
  }
  const capError = overCapItems.find((i) => typeof i.error === 'string')?.error ?? '';

  testResults.missingClosingBraceAtCapAndEof = {
    eofError,
    capError,
    valid:
      eofError.toLowerCase().includes('unclosed') &&
      capError.toLowerCase().includes('64 kb'),
  };
  if (!testResults.missingClosingBraceAtCapAndEof.valid) testResults.passed = false;

  // 17. One malformed pretty-printed object does not stop later objects from parsing
  const malformedPrettyStream = [
    JSON.stringify(JSON.parse(makeStepJson(1)), null, 2) + '\n',
    '{\n  THIS IS BROKEN,\n  "bad": true\n}\n',
    JSON.stringify(JSON.parse(makeStepJson(2)), null, 2) + '\n',
  ];
  const malformedPrettyItems = [];
  for await (const item of parseStreamedSteps(malformedPrettyStream)) {
    malformedPrettyItems.push(item);
  }
  testResults.malformedObjectPreservesLaterPrettyObjects = {
    itemCount: malformedPrettyItems.length,
    firstStepNum: malformedPrettyItems[0]?.step?.stepNumber,
    secondIsError: typeof malformedPrettyItems[1]?.error === 'string',
    thirdStepNum: malformedPrettyItems[2]?.step?.stepNumber,
    valid:
      malformedPrettyItems.length === 3 &&
      malformedPrettyItems[0]?.step?.stepNumber === 1 &&
      typeof malformedPrettyItems[1]?.error === 'string' &&
      malformedPrettyItems[2]?.step?.stepNumber === 2,
  };
  if (!testResults.malformedObjectPreservesLaterPrettyObjects.valid) testResults.passed = false;

  // 18. A fenced, pretty-printed stream parses end-to-end
  const fencedPrettyChunks = [
    '```json\n',
    JSON.stringify(JSON.parse(makeStepJson(1)), null, 2) + '\n',
    JSON.stringify(JSON.parse(makeStepJson(2)), null, 2) + '\n',
    '```\n',
  ];
  const resFencedPretty = await generateScene('fenced pretty build', new FakeModelClient([fencedPrettyChunks]));
  testResults.fencedPrettyPrintedStream = {
    success: resFencedPretty.success,
    stepCount: resFencedPretty.steps.length,
    valid: resFencedPretty.success === true && resFencedPretty.steps.length === 2,
  };
  if (!testResults.fencedPrettyPrintedStream.valid) testResults.passed = false;

  // 19. Back panel 800 x 1800 x 5 mm with cameraPreset.distance 2000 normalizes to 80 x 180 x 0.5 with distance 200
  const mmBackPanelScene = {
    schemaVersion: 1,
    name: 'bookcase-mm',
    steps: [
      {
        stepNumber: 3,
        title: 'Attach Back Panel',
        cameraPreset: { distance: 2000, phi: 1.05, theta: 0.72 },
        parts: [
          {
            id: 'back-panel-1',
            name: 'Bookcase Back Panel',
            primitive: 'box',
            dimensions: { width: 800, height: 1800, depth: 5 },
            position: { x: 0, y: 900, z: -147.5 },
            rotation: { x: 0, y: -90, z: 0 },
            color: 'tan',
            material: 'oak',
            step: 3,
            qty: 2,
          },
        ],
      },
    ],
  };
  const mmSnapshotBefore = JSON.stringify(mmBackPanelScene);
  const normalizedBackPanelScene = normalizeSceneToViewerUnits(mmBackPanelScene);
  const normStep = normalizedBackPanelScene.steps[0];
  const normPart = normStep.parts[0];

  testResults.normalizeBackPanelAndDistance = {
    factor: MM_PER_VIEWER_UNIT,
    dimensions: { ...normPart.dimensions },
    distance: normStep.cameraPreset?.distance,
    valid:
      MM_PER_VIEWER_UNIT === 10 &&
      normPart.dimensions.width === 80 &&
      normPart.dimensions.height === 180 &&
      normPart.dimensions.depth === 0.5 &&
      normStep.cameraPreset?.distance === 288,
  };
  if (!testResults.normalizeBackPanelAndDistance.valid) testResults.passed = false;

  // 20. Position and dimension values scale together; phi, theta, qty, rotation, and segment counts unchanged
  const multiGeomScene = {
    schemaVersion: 1,
    steps: [
      {
        stepNumber: 1,
        title: 'Multi-Primitive Step',
        cameraPreset: { distance: 1250, phi: 1.12, theta: 0.48 },
        parts: [
          {
            id: 'dowels-1',
            name: 'Support Rod',
            primitive: 'cylinder',
            dimensions: { radius: 12, height: 350, radialSegments: 24 },
            position: { x: -200, y: 175, z: 120 },
            rotation: { x: 0, y: 45, z: 90 },
            color: 'sun',
            material: 'brass',
            step: 1,
            qty: 4,
          },
        ],
      },
    ],
  };
  const normMulti = normalizeSceneToViewerUnits(multiGeomScene);
  const multiStep = normMulti.steps[0];
  const multiPart = multiStep.parts[0];

  testResults.scaleTogetherAndPreserveAnglesQty = {
    position: multiPart.position,
    dimensions: multiPart.dimensions,
    phi: multiStep.cameraPreset?.phi,
    theta: multiStep.cameraPreset?.theta,
    rotation: multiPart.rotation,
    qty: multiPart.qty,
    valid:
      normPart.position.x === 0 &&
      normPart.position.y === 90 &&
      normPart.position.z === -14.75 &&
      normStep.cameraPreset?.phi === 1.05 &&
      normStep.cameraPreset?.theta === 0.72 &&
      normPart.rotation.x === 0 &&
      normPart.rotation.y === -90 &&
      normPart.rotation.z === 0 &&
      normPart.qty === 2 &&
      multiPart.dimensions.radius === 1.2 &&
      multiPart.dimensions.height === 35 &&
      multiPart.dimensions.radialSegments === 24 &&
      multiPart.position.x === -20 &&
      multiPart.position.y === 17.5 &&
      multiPart.position.z === 12 &&
      multiPart.rotation.y === 45 &&
      multiPart.rotation.z === 90 &&
      multiPart.qty === 4 &&
      multiStep.cameraPreset?.distance === 125 &&
      multiStep.cameraPreset?.phi === 1.12 &&
      multiStep.cameraPreset?.theta === 0.48,
  };
  if (!testResults.scaleTogetherAndPreserveAnglesQty.valid) testResults.passed = false;

  // 21. normalizeSceneToViewerUnits does not mutate its input
  normPart.dimensions.width = 9999;
  normPart.position.y = 9999;
  normPart.rotation.y = 9999;
  if (normStep.cameraPreset) normStep.cameraPreset.distance = 9999;

  testResults.normalizeDoesNotMutateInput = {
    notSameRef: normalizedBackPanelScene !== mmBackPanelScene,
    inputUnchanged: JSON.stringify(mmBackPanelScene) === mmSnapshotBefore,
    valid:
      normalizedBackPanelScene !== mmBackPanelScene &&
      JSON.stringify(mmBackPanelScene) === mmSnapshotBefore &&
      mmBackPanelScene.steps[0].parts[0].dimensions.width === 800 &&
      mmBackPanelScene.steps[0].cameraPreset.distance === 2000,
  };
  if (!testResults.normalizeDoesNotMutateInput.valid) testResults.passed = false;

  // 22. End-to-end generateScene run with FakeModelClient returning mm output validates normalized numbers
  const bookcaseStep1 = {
    stepNumber: 1,
    title: 'Stand Side Uprights',
    cameraPreset: { distance: 1800, phi: 1.1, theta: 0.6 },
    parts: [
      {
        id: 'upright-left',
        name: 'Left Upright',
        primitive: 'box',
        dimensions: { width: 25, height: 1800, depth: 300 },
        position: { x: -387.5, y: 900, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 1,
        qty: 1,
      },
      {
        id: 'upright-right',
        name: 'Right Upright',
        primitive: 'box',
        dimensions: { width: 25, height: 1800, depth: 300 },
        position: { x: 387.5, y: 900, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 1,
        qty: 1,
      },
    ],
  };
  const bookcaseStep2 = {
    stepNumber: 2,
    title: 'Install Horizontal Shelves',
    cameraPreset: { distance: 1900, phi: 1.0, theta: 0.7 },
    parts: [
      {
        id: 'shelf-bottom',
        name: 'Bottom Shelf',
        primitive: 'box',
        dimensions: { width: 750, height: 25, depth: 295 },
        position: { x: 0, y: 50, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'tan',
        material: 'oak',
        step: 2,
        qty: 1,
      },
    ],
  };
  const bookcaseStep3 = {
    stepNumber: 3,
    title: 'Attach Back Panel',
    cameraPreset: { distance: 2000, phi: 1.05, theta: 0.55 },
    parts: [
      {
        id: 'back-panel',
        name: 'Back Panel',
        primitive: 'box',
        dimensions: { width: 800, height: 1800, depth: 5 },
        position: { x: 0, y: 900, z: -147.5 },
        rotation: { x: 0, y: 0, z: 0 },
        color: 'cream',
        material: 'plywood',
        step: 3,
        qty: 1,
      },
    ],
  };

  const e2eClient = new FakeModelClient([
    [
      JSON.stringify(bookcaseStep1) + '\n',
      JSON.stringify(bookcaseStep2) + '\n',
      JSON.stringify(bookcaseStep3) + '\n',
    ],
  ]);
  const streamedValidSteps = [];
  const resE2E = await generateScene('build a 4-shelf bookcase', e2eClient, {
    onStep: (step, status) => {
      if (status === 'valid' && step) streamedValidSteps.push(step);
    },
  });
  const e2eBackPanel = resE2E.steps[2]?.parts?.[0];
  const e2eStep3 = resE2E.steps[2];

  testResults.endToEndMmNormalizesAndValidates = {
    success: resE2E.success,
    stepCount: resE2E.steps.length,
    boxMaxCm: VIEWER_PRIMITIVE_BOUNDS.box.width.max,
    step3Dimensions: e2eBackPanel?.dimensions,
    step3Position: e2eBackPanel?.position,
    step3CameraPreset: e2eStep3?.cameraPreset,
    streamedBackPanelWidth: streamedValidSteps[2]?.parts?.[0]?.dimensions?.width,
    valid:
      resE2E.success === true &&
      resE2E.steps.length === 3 &&
      VIEWER_PRIMITIVE_BOUNDS.box.width.max === 500 &&
      e2eBackPanel?.dimensions.width === 80 &&
      e2eBackPanel?.dimensions.height === 180 &&
      e2eBackPanel?.dimensions.depth === 0.5 &&
      e2eBackPanel?.position.x === 0 &&
      e2eBackPanel?.position.y === 90 &&
      e2eBackPanel?.position.z === -14.75 &&
      e2eStep3?.cameraPreset?.distance === 288 &&
      e2eStep3?.cameraPreset?.phi === 1.05 &&
      e2eStep3?.cameraPreset?.theta === 0.55 &&
      streamedValidSteps[2]?.parts?.[0]?.dimensions?.width === 80,
  };
  if (!testResults.endToEndMmNormalizesAndValidates.valid) testResults.passed = false;

  // 23. Unit labels show "cm" for generated scenes while keeping "mm" for hand-built DESK_SCENE
  const generatedBuildStep = sceneStepToBuildStep(resE2E.steps[2]);
  const deskBuildStep = sceneStepToBuildStep(DESK_SCENE.steps[0]);

  testResults.unitLabelsCmForGeneratedDeskUnchanged = {
    generatedDimText: generatedBuildStep.parts[0]?.dimensions,
    deskDimText: deskBuildStep.parts[0]?.dimensions,
    valid:
      generatedBuildStep.parts[0]?.dimensions === '80 × 180 × 0.5 cm' &&
      deskBuildStep.parts[0]?.dimensions.endsWith(' mm'),
  };
  if (!testResults.unitLabelsCmForGeneratedDeskUnchanged.valid) testResults.passed = false;

  // 24. Regression: 1800 mm back panel normalizes once to 180 (not 18) end-to-end
  const regressionClient = new FakeModelClient([[JSON.stringify(mmBackPanelScene.steps[0]) + '\n']]);
  const resRegression = await generateScene('build a 4-shelf bookcase', regressionClient);
  const regPart = resRegression.steps[0]?.parts?.[0];
  const regDistance = resRegression.steps[0]?.cameraPreset?.distance;
  testResults.backPanel1800MmBecomes180Not18 = {
    success: resRegression.success,
    height: regPart?.dimensions?.height,
    width: regPart?.dimensions?.width,
    depth: regPart?.dimensions?.depth,
    distance: regDistance,
    valid:
      resRegression.success === true &&
      regPart?.dimensions?.height === 180 &&
      regPart?.dimensions?.height !== 18 &&
      regPart?.dimensions?.width === 80 &&
      regPart?.dimensions?.depth === 0.5 &&
      regDistance === 288 &&
      regDistance !== 20,
  };
  if (!testResults.backPanel1800MmBecomes180Not18.valid) testResults.passed = false;

  // 25. Regression: buildPrompt does not contain "centimeters" or "cm" in its dimension instructions
  const recordedPrompt = regressionClient.recordedPrompts[0] ?? '';
  const dimSectionStart = recordedPrompt.indexOf('=== DIMENSION');
  const dimSectionEnd = recordedPrompt.indexOf('=== ALLOWED PALETTE', dimSectionStart);
  const dimInstructions =
    dimSectionStart >= 0 && dimSectionEnd > dimSectionStart
      ? recordedPrompt.slice(dimSectionStart, dimSectionEnd)
      : recordedPrompt;

  testResults.promptDoesNotAskForCentimeters = {
    hasDimensionBoundsHeader: dimInstructions.includes('=== DIMENSION BOUNDS (MILLIMETERS & CONSTRAINTS) ==='),
    hasCentimetersWord: /centimeters?/i.test(dimInstructions),
    hasCmToken: /\bcm\b/i.test(dimInstructions),
    valid:
      dimInstructions.includes('=== DIMENSION BOUNDS (MILLIMETERS & CONSTRAINTS) ===') &&
      !/centimeters?/i.test(dimInstructions) &&
      !/\bcm\b/i.test(dimInstructions),
  };
  if (!testResults.promptDoesNotAskForCentimeters.valid) testResults.passed = false;

  // 26. Clamp test: 180 cm model with normalized distance 50 (raw 500 mm) clamps to 288 (including cumulative small step)
  const lowDistBookcaseStream = [
    JSON.stringify({
      stepNumber: 1,
      title: 'Frame',
      cameraPreset: { distance: 500, phi: 1.15, theta: 0.45 },
      parts: [
        {
          id: 'side_180',
          name: 'Side Panel',
          primitive: 'box',
          dimensions: { width: 20, height: 1800, depth: 300 },
          position: { x: -390, y: 900, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
    JSON.stringify({
      stepNumber: 2,
      title: 'Small Screw Step',
      cameraPreset: { distance: 500, phi: 1.25, theta: 0.55 },
      parts: [
        {
          id: 'screw_small',
          name: 'Wood Screw',
          primitive: 'cylinder',
          dimensions: { radius: 2, height: 30, radialSegments: 16 },
          position: { x: 0, y: 50, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'grey',
          material: 'steel',
          step: 2,
          qty: 8,
        },
      ],
    }) + '\n',
  ];
  const resLowDist = await generateScene(
    'build a 4-shelf bookcase',
    new FakeModelClient([lowDistBookcaseStream])
  );
  const step1Preset = resLowDist.steps[0]?.cameraPreset;
  const step2Preset = resLowDist.steps[1]?.cameraPreset;
  testResults.clampDistanceLowFor180CmModel = {
    step1Distance: step1Preset?.distance,
    step2Distance: step2Preset?.distance,
    phiPreserved: step1Preset?.phi === 1.15 && step2Preset?.phi === 1.25,
    thetaPreserved: step1Preset?.theta === 0.45 && step2Preset?.theta === 0.55,
    valid:
      resLowDist.success === true &&
      step1Preset?.distance === 288 &&
      step2Preset?.distance === 288 &&
      step1Preset?.phi === 1.15 &&
      step1Preset?.theta === 0.45 &&
      step2Preset?.phi === 1.25 &&
      step2Preset?.theta === 0.55,
  };
  if (!testResults.clampDistanceLowFor180CmModel.valid) testResults.passed = false;

  // 27. Distance unchanged when within [1.6 * maxExtent, 400] (distance 300 for 180 cm; distance 200 for 100 cm; max cap 400)
  const unchangedStream180 = [
    JSON.stringify({
      stepNumber: 1,
      title: 'Wide Shot 180cm',
      cameraPreset: { distance: 3000, phi: 1.1, theta: 0.6 },
      parts: [
        {
          id: 'panel_180_ok',
          name: 'Panel 180cm',
          primitive: 'box',
          dimensions: { width: 800, height: 1800, depth: 20 },
          position: { x: 0, y: 900, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
  ];
  const unchangedStream100 = [
    JSON.stringify({
      stepNumber: 1,
      title: 'Medium Model 100cm',
      cameraPreset: { distance: 2000, phi: 1.1, theta: 0.6 },
      parts: [
        {
          id: 'panel_100_ok',
          name: 'Panel 100cm',
          primitive: 'box',
          dimensions: { width: 600, height: 1000, depth: 20 },
          position: { x: 0, y: 500, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
  ];
  const overMaxStream = [
    JSON.stringify({
      stepNumber: 1,
      title: 'Over Max Cap',
      cameraPreset: { distance: 6000, phi: 1.1, theta: 0.6 },
      parts: [
        {
          id: 'panel_100_cap',
          name: 'Panel',
          primitive: 'box',
          dimensions: { width: 600, height: 1000, depth: 20 },
          position: { x: 0, y: 500, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
  ];
  const res300 = await generateScene('180cm at 300', new FakeModelClient([unchangedStream180]));
  const res200 = await generateScene('100cm at 200', new FakeModelClient([unchangedStream100]));
  const resOverMax = await generateScene('over max 400', new FakeModelClient([overMaxStream]));
  testResults.distanceUnchangedWhenWithinBounds = {
    dist180At300: res300.steps[0]?.cameraPreset?.distance,
    dist100At200: res200.steps[0]?.cameraPreset?.distance,
    distOverMaxClamped: resOverMax.steps[0]?.cameraPreset?.distance,
    valid:
      res300.steps[0]?.cameraPreset?.distance === 300 &&
      res200.steps[0]?.cameraPreset?.distance === 200 &&
      resOverMax.steps[0]?.cameraPreset?.distance === 400,
  };
  if (!testResults.distanceUnchangedWhenWithinBounds.valid) testResults.passed = false;

  // 28. Missing cameraPreset (or missing distance) fills default phi=1.0, theta=0.6 and clamped distance
  const missingPreset180Stream = [
    JSON.stringify({
      stepNumber: 1,
      title: 'No Preset 180cm',
      parts: [
        {
          id: 'panel_no_preset_180',
          name: 'Panel 180cm',
          primitive: 'box',
          dimensions: { width: 800, height: 1800, depth: 20 },
          position: { x: 0, y: 900, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
  ];
  const missingPreset100Stream = [
    JSON.stringify({
      stepNumber: 1,
      title: 'No Preset 100cm',
      parts: [
        {
          id: 'panel_no_preset_100',
          name: 'Panel 100cm',
          primitive: 'box',
          dimensions: { width: 600, height: 1000, depth: 20 },
          position: { x: 0, y: 500, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          color: 'tan',
          material: 'oak',
          step: 1,
          qty: 1,
        },
      ],
    }) + '\n',
  ];
  const resNoPreset180 = await generateScene(
    '180cm no preset',
    new FakeModelClient([missingPreset180Stream])
  );
  const resNoPreset100 = await generateScene(
    '100cm no preset',
    new FakeModelClient([missingPreset100Stream])
  );
  const preset180 = resNoPreset180.steps[0]?.cameraPreset;
  const preset100 = resNoPreset100.steps[0]?.cameraPreset;
  testResults.missingCameraPresetSetsDefaults = {
    preset180,
    preset100,
    valid:
      resNoPreset180.success === true &&
      resNoPreset100.success === true &&
      preset180?.distance === 288 &&
      preset180?.phi === 1.0 &&
      preset180?.theta === 0.6 &&
      preset100?.distance === 160 &&
      preset100?.phi === 1.0 &&
      preset100?.theta === 0.6,
  };
  if (!testResults.missingCameraPresetSetsDefaults.valid) testResults.passed = false;

  // 29. Desk fixture distances are never modified
  const deskDistances = DESK_SCENE.steps.map((s) => s.cameraPreset?.distance);
  const expectedDeskDistances = [90, 85, 95, 100, 75, 88];
  testResults.deskFixtureDistancesUntouched = {
    deskDistances,
    expectedDeskDistances,
    valid: JSON.stringify(deskDistances) === JSON.stringify(expectedDeskDistances),
  };
  if (!testResults.deskFixtureDistancesUntouched.valid) testResults.passed = false;

  process.stdout.write(JSON.stringify(testResults, null, 2));
}

runTests().catch((err) => {
  process.stderr.write(String(err));
  process.exit(1);
});
