import { validateScene } from '../src/sceneValidator.ts';
import fs from 'fs';

try {
  const input = fs.readFileSync(0, 'utf8');
  let scene = JSON.parse(input);

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

  scene = revive(scene);
  const errors = validateScene(scene);
  process.stdout.write(JSON.stringify(errors));
} catch (err) {
  process.stderr.write(String(err));
  process.exit(1);
}
