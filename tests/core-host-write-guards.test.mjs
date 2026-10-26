import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCore } from './helpers/core-harness.mjs';

// Representative public entry points for each host mutation family. Explicit
// synthetic paths avoid unrelated default-argument host discovery.
const cases = [
  ['applyPatches', ['/synthetic/official', [], {}]],
  ['applyPatchesAllHosts', [[], {}]],
  ['revertAll', ['/synthetic/official', {}]],
  ['backupAll', ['/synthetic/official']],
  ['patchShim', ['/synthetic/bin']],
  ['revertShim', ['/synthetic/bin', {}]],
  ['openSealedDesktopHost', [{}]],
  ['scheduleSealedDesktopRestart', [{ exe: '/synthetic/dsh', asar: '/synthetic/app.asar' }]],
  ['patchWatchedClientBundlesSync', ['/synthetic/official']],
  ['setHooksDenySettings', [{ hooksDenyBypass: true }]],
  ['sanitizeDesktopCommandRuntimes', []],
];

for (const [name, args] of cases) {
  test(`core ${name} rejects before filesystem, process or host access`, async () => {
    const { core, touches } = await loadCore();
    assert.equal(typeof core[name], 'function');
    await assert.rejects(Promise.resolve().then(() => core[name](...args)), { code: 'OFFICIAL_HOST_READ_ONLY' });
    assert.deepEqual(touches, [], 'guard must run before touching any external boundary');
  });
}

test('core hookDenyIo.saveText cannot write through the exposed callback', async () => {
  const { core, touches } = await loadCore();
  await assert.rejects(core.hookDenyIo.saveText('/synthetic/official/hooks.js', 'replacement'), { code: 'OFFICIAL_HOST_READ_ONLY' });
  assert.deepEqual(touches, []);
});
