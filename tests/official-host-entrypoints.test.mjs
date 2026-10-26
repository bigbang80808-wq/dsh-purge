import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlugin } from './helpers/plugin-harness.mjs';

const code = 'OFFICIAL_HOST_READ_ONLY';

for (const operation of ['apply', 'revert', 'restart', 'uninstall', 'hooks-deny']) {
  test(`HTTP ${operation} rejects before reading input or invoking host operations`, async () => {
    const plugin = await loadPlugin();
    let bodyReads = 0;
    const result = await plugin.request('POST', {
      path: `/dsh-purge/${operation}`, content: '{"hooksDenyBypass":true}', bodyRead: () => bodyReads++,
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, code);
    assert.equal(typeof result.body.error, 'string');
    assert.ok(result.body.error.length > 0);
    assert.equal(bodyReads, 0);
    assert.deepEqual(plugin.hostEffects, [], 'must reject before invoking patch/revert/restart/settings code');
    assert.deepEqual(plugin.writes, []);
  });
}

test('HTTP hooks-deny GET reports bypass disabled and locked without host writes', async () => {
  const plugin = await loadPlugin();
  const result = await plugin.request('GET', { path: '/dsh-purge/hooks-deny' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.hooksDenyBypass, false);
  assert.equal(result.body.locked, true);
  assert.deepEqual(plugin.hostEffects, []);
  assert.deepEqual(plugin.writes, []);
});

for (const name of ['purge_apply', 'purge_revert']) {
  test(`registered ${name} tool returns an explicit error without host operations`, async () => {
    const plugin = await loadPlugin();
    const tool = plugin.registeredTools.find((candidate) => candidate.name === name);
    assert.ok(tool, 'the existing tool contract must remain discoverable');
    const result = await tool.execute();
    assert.equal(result.kind, 'error');
    assert.equal(result.code, code);
    assert.equal(typeof result.text, 'string');
    assert.ok(result.text.length > 0);
    assert.deepEqual(plugin.hostEffects, []);
    assert.deepEqual(plugin.writes, []);
  });
}

for (const entrypoint of ['settle', 'autoApply']) {
  test(`${entrypoint} skips even when legacy automatic patch/update flags are enabled`, async () => {
    const plugin = await loadPlugin();
    const result = await plugin[entrypoint]({ enabled: true, autoApplyOnStart: true, autoUpdateOnStart: true, autoRevertOnMissing: true });
    assert.equal(result.skipped, true);
    assert.equal(result.code, code);
    assert.deepEqual(plugin.hostEffects, [], 'must skip before probing or mutating the official installation');
    assert.deepEqual(plugin.writes, []);
  });
}

for (const operation of ['apply', 'revert', 'uninstall']) {
  test(`purge ${operation} command rejects before host discovery or mutation`, async () => {
    const plugin = await loadPlugin();
    const result = await plugin.command(operation);
    assert.equal(result.kind, 'error');
    assert.equal(result.code, code);
    assert.deepEqual(plugin.hostEffects, []);
    assert.deepEqual(plugin.writes, []);
  });
}
