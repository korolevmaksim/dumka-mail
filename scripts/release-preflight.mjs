import fs from 'fs';
import path from 'path';
import process from 'process';

const root = process.cwd();
const mode = process.argv[2] || 'local';

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function hasEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const packageJson = readJson('package.json');
const build = packageJson.build || {};
const missingFiles = [
  'assets/icon.icns',
  'assets/icon.png',
  'build/electron-builder.signed.cjs',
  'build/entitlements.mac.plist',
  'build/entitlements.mac.inherit.plist',
].filter(file => !exists(file));

if (missingFiles.length > 0) {
  fail('Release preflight failed: required release files are missing.', missingFiles);
}

const requiredScripts = [
  'package:mac',
  'dist:mac',
  'dist:mac:signed',
  'package:win',
  'dist:win',
  'package:linux',
  'dist:linux',
];
const missingScripts = requiredScripts.filter(script => !packageJson.scripts?.[script]);
if (missingScripts.length > 0) {
  fail('Release preflight failed: required package scripts are missing.', missingScripts);
}

if (build.mac?.identity === null || build.mac?.sign === null) {
  fail('Release preflight failed: package.json disables macOS signing globally.', [
    'Use CSC_IDENTITY_AUTO_DISCOVERY=false only in local unsigned scripts.',
  ]);
}

if (mode === 'mac-signed') {
  const missing = [];

  if (process.platform !== 'darwin') {
    missing.push('Run signed/notarized macOS builds on macOS.');
  }

  if (!hasEnv('CSC_LINK') && !hasEnv('CSC_NAME')) {
    missing.push('Set CSC_LINK or CSC_NAME for the Developer ID Application certificate.');
  }
  if (hasEnv('CSC_LINK') && !hasEnv('CSC_KEY_PASSWORD')) {
    missing.push('Set CSC_KEY_PASSWORD for the CSC_LINK certificate.');
  }

  const hasAppleIdCredentials = hasEnv('APPLE_ID') &&
    hasEnv('APPLE_APP_SPECIFIC_PASSWORD') &&
    hasEnv('APPLE_TEAM_ID');
  const hasApiKeyCredentials = hasEnv('APPLE_API_KEY') &&
    hasEnv('APPLE_API_KEY_ID') &&
    hasEnv('APPLE_API_ISSUER');

  if (!hasAppleIdCredentials && !hasApiKeyCredentials) {
    missing.push('Set Apple notarization credentials: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER.');
  }

  if (missing.length > 0) {
    fail('Signed macOS release preflight failed.', missing);
  }
}

console.log(`Release preflight passed (${mode}).`);
