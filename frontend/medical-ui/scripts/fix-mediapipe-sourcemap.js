const fs = require('fs');
const path = require('path');

const mapPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'vision_bundle_mjs.js.map'
);

const mapDir = path.dirname(mapPath);

const minimalMap = {
  version: 3,
  file: 'vision_bundle.mjs',
  sources: ['vision_bundle.mjs'],
  names: [],
  mappings: ''
};

try {
  if (!fs.existsSync(mapDir)) {
    console.log('[fix-mediapipe-sourcemap] MediaPipe package not installed yet. Skipping.');
    process.exit(0);
  }

  if (!fs.existsSync(mapPath)) {
    fs.writeFileSync(mapPath, JSON.stringify(minimalMap), 'utf8');
    console.log('[fix-mediapipe-sourcemap] Created missing sourcemap file.');
  } else {
    console.log('[fix-mediapipe-sourcemap] Sourcemap already present.');
  }
} catch (error) {
  console.warn('[fix-mediapipe-sourcemap] Could not repair sourcemap:', error.message);
  process.exit(0);
}
