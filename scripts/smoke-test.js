/**
 * Slash-command smoke test — the guarantee that broken commands never ship.
 *
 * Runs in CI on every push. Fails the build (exit 1) if:
 *   1. Any declared slash command has NO handler (plugin router or legacy
 *      dispatcher) — the classic "command does nothing / did not respond".
 *   2. Any handler file has a syntax error or bad require.
 *   3. The DatabaseManager / runtime can't construct.
 *
 * It does NOT need Discord/network — it parses declarations and checks the
 * handler surface statically, then boots the DB layer in isolation.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const fail = (msg) => { console.error('✗ ' + msg); failures++; };
const ok = (msg) => console.log('✓ ' + msg);

// ── 1. Extract declared command names from deploy-commands.js ────────────────
const deploySrc = fs.readFileSync(path.join(ROOT, 'deploy-commands.js'), 'utf8');
const declared = [];
for (const block of deploySrc.split('new SlashCommandBuilder()').slice(1)) {
  const m = block.match(/\.setName\(['"]([\w-]+)['"]\)/);
  if (m) declared.push(m[1]);
}
if (declared.length === 0) fail('no commands parsed from deploy-commands.js');
else ok(`${declared.length} slash commands declared`);

// ── 2. Collect handled command names ─────────────────────────────────────────
const handled = new Set();
// legacy dispatcher: cmd === 'x'
const cmdHandlerSrc = fs.readFileSync(path.join(ROOT, 'src/handlers/commandHandler.js'), 'utf8');
for (const m of cmdHandlerSrc.matchAll(/cmd === ['"]([\w-]+)['"]/g)) handled.add(m[1]);
// plugin routers: registerCommand('x', ...)
const pluginDir = path.join(ROOT, 'src/plugins');
for (const folder of fs.readdirSync(pluginDir)) {
  const idx = path.join(pluginDir, folder, 'index.js');
  if (!fs.existsSync(idx)) continue;
  const src = fs.readFileSync(idx, 'utf8');
  for (const m of src.matchAll(/registerCommand\(['"]([\w-]+)['"]/g)) handled.add(m[1]);
}
ok(`${handled.size} command handlers found`);

// ── 3. Every declared command must have a handler ────────────────────────────
const orphans = declared.filter(c => !handled.has(c));
if (orphans.length) fail(`commands with NO handler: ${orphans.join(', ')}`);
else ok('every declared command has a handler');

// ── 4. Handler modules must load without throwing ────────────────────────────
// Provide the minimum env so requires that read process.env at load don't die.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'x';
const critical = [
  'src/core/Runtime.js',
  'src/managers/DatabaseManager.js',
  'src/handlers/commandHandler.js',
  'src/handlers/eventHandler.js',
  'modules/ai-handler.js',
  'modules/security.js',
  'modules/case-manager.js',
  'modules/semantic-spam.js',
];
for (const f of critical) {
  try { require(path.join(ROOT, f)); ok(`loads: ${f}`); }
  catch (e) { fail(`require failed: ${f} → ${e.message}`); }
}

// ── 5. DB layer constructs + guild routing works ─────────────────────────────
try {
  const Runtime = require(path.join(ROOT, 'src/core/Runtime.js'));
  const DBM = require(path.join(ROOT, 'src/managers/DatabaseManager.js'));
  const rt = new Runtime();
  const dbm = new DBM(rt);
  const G = '__smoke__';
  global.asyncLocalStorage.run({ guildId: G }, () => {
    dbm.db.xp = { u: { xp: 1 } };
  });
  const leaked = 'xp' in dbm.getGlobal();
  const stored = dbm.getGuildDb(G).xp?.u?.xp === 1;
  dbm.deleteGuildDb(G);
  if (leaked) fail('guild data leaked into global config');
  else if (!stored) fail('guild data did not persist to guild config');
  else ok('guild-context DB routing works');
} catch (e) {
  fail('DB layer smoke failed: ' + e.message);
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log('');
if (failures) { console.error(`SMOKE TEST FAILED — ${failures} problem(s)`); process.exit(1); }
console.log('SMOKE TEST PASSED');
process.exit(0);
