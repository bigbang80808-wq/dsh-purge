import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlugin } from './helpers/plugin-harness.mjs';

const cases = [
  { name: 'workspace-write with no permission history', preset: 'workspace-write', pins: 0 },
  { name: 'read-only with no permission history', preset: 'read-only', pins: 0 },
  { name: 'unset preset with no permission history', preset: undefined, pins: 0 },
  { name: 'workspace-write selected once', preset: 'workspace-write', pins: 1 },
  { name: 'read-only selected once', preset: 'read-only', pins: 1 },
  { name: 'unset preset with one permission record', preset: undefined, pins: 1 },
  { name: 'user-selected auto', preset: 'auto', pins: 1 },
  { name: 'user-selected custom', preset: 'custom', pins: 1 },
  { name: 'user-selected full access', preset: 'danger-full-access', pins: 1 },
  { name: 'read-only subagent', preset: 'read-only', pins: 0, origin: 'subagent' },
  { name: 'workspace-write subagent', preset: 'workspace-write', pins: 0, origin: 'subagent' },
  { name: 'unset subagent preset', preset: undefined, pins: 0, origin: 'subagent' },
];

for (const { name, preset, pins, origin = 'user' } of cases) {
  test(`session creation preserves official permissions: ${name}`, async () => {
    const plugin = await loadPlugin();
    const state = preset === undefined ? {} : { preset };
    const setCalls = [];
    const session = {
      header: { origin },
      snapshotEvents: () => Array.from({ length: pins }, () => ({ type: 'permission/preset', data: { preset } })),
    };
    plugin.ctx.permissionPresets = {
      permissionState: () => state,
      set: (targetSession, selectedPreset) => {
        setCalls.push({ session: targetSession, preset: selectedPreset });
        state.preset = selectedPreset;
      },
    };

    await plugin.broadcast('session/created', session);

    assert.deepEqual(setCalls, [], 'plugin must leave permission selection to the official host/user');
    assert.equal(state.preset, preset, 'session creation must not silently upgrade or replace the selected preset');
  });
}

test('session creation also preserves permissions when the service is resolved through ctx.get', async () => {
  const plugin = await loadPlugin();
  const calls = [];
  const service = {
    permissionState: () => ({ preset: 'read-only' }),
    set: (session, preset) => calls.push({ session, preset }),
  };
  const originalGet = plugin.ctx.get;
  plugin.ctx.get = (name) => name === 'permissionPresets' ? service : originalGet(name);

  await plugin.broadcast('session/created', { header: { origin: 'user' }, snapshotEvents: () => [] });

  assert.deepEqual(calls, [], 'the service fallback must not introduce an automatic permission upgrade');
});
