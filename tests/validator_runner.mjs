import { validateScene, validateStep } from '../src/sceneValidator.ts';
import fs from 'fs';

try {
  const input = fs.readFileSync(0, 'utf8');
  let data = JSON.parse(input);

  // Revive test sentinels for NaN / Infinity
  const revive = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of Object.keys(obj)) {
      if (obj[key] === '__NAN__') {
        obj[key] = NaN;
      } else if (obj[key] === '__INFINITY__') {
        obj[key] = Infinity;
      } else if (obj[key] === '__NEG_INFINITY__') {
        obj[key] = -Infinity;
      } else if (typeof obj[key] === 'object') {
        revive(obj[key]);
      }
    }
    return obj;
  };

  data = revive(data);

  let errors = [];
  if (data && data._mode === 'step') {
    const context = data.context || {};
    if (Array.isArray(context.seenPartIds)) {
      context.seenPartIds = new Set(context.seenPartIds);
    }
    if (Array.isArray(context.validStepNumbers)) {
      context.validStepNumbers = new Set(context.validStepNumbers);
    }
    errors = validateStep(data.step, context);
  } else {
    errors = validateScene(data);
  }

  process.stdout.write(JSON.stringify(errors));
} catch (err) {
  process.stderr.write(String(err));
  process.exit(1);
}
