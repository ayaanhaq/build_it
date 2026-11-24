import {
  FakeModelClient,
  buildPrompt,
  parseStreamedSteps,
  generateScene,
  DEFAULT_MAX_RETRIES_PER_STEP,
  ALLOWED_PALETTE_NAMES,
} from '../src/generatePipeline.ts';
import { PRIMITIVE_BOUNDS } from '../src/sceneValidator.ts';

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
  const containsPalettes = ['tan', 'ink', 'sun', 'brown'].every((c) => prompt.includes(c));

  testResults.buildPrompt = {
    containsRequest,
    containsSchema,
    containsPrimitives,
    containsBounds,
    containsPalettes,
    valid: containsRequest && containsSchema && containsPrimitives && containsBounds && containsPalettes,
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

  process.stdout.write(JSON.stringify(testResults, null, 2));
}

runTests().catch((err) => {
  process.stderr.write(String(err));
  process.exit(1);
});
