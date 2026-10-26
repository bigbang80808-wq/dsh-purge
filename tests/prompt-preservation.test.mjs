import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, unlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCore } from './helpers/core-harness.mjs';
import { loadPlugin } from './helpers/plugin-harness.mjs';

const markers = '<|im_start|>system:\n<project_instructions>\nLittle Code Sauce';
const defaultV1 = `${markers}\nBundled default one.\n`;
const defaultV2 = `${markers}\nBundled default two.\n`;
const customMarker = `  ${markers}\nThis is my explicitly saved draft.\n\n`;

async function fixture(t, defaultPrompt = defaultV1) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-purge-prompt-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const loaded = await loadCore({ persistenceRoot: home, defaultPrompt });
  return { home, ...loaded, file: path.join(home, 'prompt-inject.md') };
}

const savedCases = [
  ['legacy template markers', customMarker],
  ['CRLF and trailing newlines', '  A saved line\r\nA second line\r\n\r\n'],
  ['leading and trailing whitespace', '\t  A saved draft \t\n\n'],
  ['whitespace only', ' \t\r\n  \n'],
  ['empty string', ''],
  ['text identical to the bundled default', defaultV1],
];

for (const [label, content] of savedCases) {
  test(`explicit save preserves ${label} across refresh and a fresh module restart`, async (t) => {
    const { core, touches, home, file } = await fixture(t);
    const saved = await core.saveOverrideContent(home, content);
    assert.equal(saved.content, content);
    assert.equal(await readFile(file, 'utf8'), content, 'save must write the exact submitted string');
    assert.equal((await core.readOverrideForUi(home)).content, content, 'editor read must preserve bytes');
    core.syncPromptInjectOnDiskSync(home);
    assert.equal(await readFile(file, 'utf8'), content, 'refresh must not replace an explicit save');
    const restarted = await loadCore({ persistenceRoot: home, defaultPrompt: defaultV2 });
    restarted.core.seedPromptInjectAtBoot(home);
    assert.equal(await readFile(file, 'utf8'), content, 'restart must preserve saved content even if bundled default changes');
    assert.equal((await restarted.core.readOverrideForUi(home)).content, content);
    await restarted.core.installOverride(home, false);
    assert.equal(await readFile(file, 'utf8'), content, 'non-forced install must also retain an explicit save');
    assert.deepEqual([...touches, ...restarted.touches], [], 'no filesystem access outside this test home or other host boundary');
  });
}

test('a legacy customized=true state preserves its matching marker-containing draft', async (t) => {
  const { core, touches, home, file } = await fixture(t);
  await writeFile(file, customMarker, 'utf8');
  await core.writeOverrideState(home, {
    customized: true, hash: core.hashOverride(customMarker), seedHash: core.defaultOverrideHash(),
  });
  core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), customMarker);
  assert.deepEqual(touches, []);
});

test('an old default without an explicit save still migrates', async (t) => {
  const { core, touches, home, file } = await fixture(t);
  core.seedPromptInjectAtBoot(home);
  const updated = await loadCore({ persistenceRoot: home, defaultPrompt: defaultV2 });
  updated.core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV2);
  assert.deepEqual([...touches, ...updated.touches], []);
});

test('an unmarked old template is still treated as an old default', async (t) => {
  const { core, touches, home, file } = await fixture(t, defaultV2);
  await writeFile(file, defaultV1, 'utf8');
  core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV2);
  assert.deepEqual(touches, []);
});

test('legacy customized state does not protect a different old template', async (t) => {
  const { core, touches, home, file } = await fixture(t, defaultV2);
  await writeFile(file, defaultV1, 'utf8');
  await core.writeOverrideState(home, {
    customized: true, hash: core.hashOverride(customMarker), seedHash: core.hashOverride(defaultV1),
  });
  core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV2);
  assert.deepEqual(touches, []);
});

test('a saved empty file that is deleted is seeded again instead of protected by stale metadata', async (t) => {
  const { core, touches, home, file } = await fixture(t);
  await core.saveOverrideContent(home, '');
  await unlink(file);
  core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV1);
  assert.deepEqual(touches, []);
});

test('explicit restore-default uses the current bundle and allows future default migration', async (t) => {
  const { core, touches, home, file } = await fixture(t);
  await core.saveOverrideContent(home, customMarker);
  await core.saveOverrideContent(home, 'A stale editor preview must not become the default.', { resetDefault: true });
  assert.equal(await readFile(file, 'utf8'), defaultV1);
  assert.notEqual(core.readOverrideStateSync(home).explicitSave, true);
  const updated = await loadCore({ persistenceRoot: home, defaultPrompt: defaultV2 });
  updated.core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV2);
  assert.deepEqual([...touches, ...updated.touches], []);
});

async function pluginFor(core, home) {
  const coreNames = [
    'findOverrideFile', 'syncPromptInjectOnDiskSync', 'normalizeOverride', 'defaultOverrideText',
    'rememberCommittedOverride', 'seedPromptInjectAtBoot', 'saveOverrideContent', 'readOverrideForUi', 'installOverride',
  ];
  return loadPlugin({
    coreOverrides: {
      ...Object.fromEntries(coreNames.map((key) => [key, core[key]])),
      findDshHome: () => home, pinDshHome: () => home,
    },
    rulesOverrides: {
      resolveInjectText: () => ({
        text: core.normalizeOverride(core.readPromptInjectFileSync(home)) || core.normalizeOverride(core.defaultOverrideText()),
        source: 'prompt',
      }),
    },
  });
}

for (const content of [customMarker, '  CRLF draft\r\n\r\n', ' \t\n', '']) {
  test(`HTTP save and GET echo exact submitted content ${JSON.stringify(content.slice(0, 24))}`, async (t) => {
    const { core, touches, home, file } = await fixture(t);
    const plugin = await pluginFor(core, home);
    const saved = await plugin.request('POST', { path: '/dsh-purge/override', content: JSON.stringify({ content }) });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.content, content, 'POST must echo saved editor text rather than normalized model injection');
    const refreshed = await plugin.request('GET', { path: '/dsh-purge/override' });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.content, content);
    assert.equal(await readFile(file, 'utf8'), content);
    assert.deepEqual(touches, []);
    assert.deepEqual(plugin.hostEffects, []);
  });
}

test('HTTP restore-default clears explicit ownership so a later default can migrate', async (t) => {
  const { core, touches, home, file } = await fixture(t);
  await core.saveOverrideContent(home, customMarker);
  const plugin = await pluginFor(core, home);
  const restored = await plugin.request('POST', {
    path: '/dsh-purge/override', content: JSON.stringify({ content: defaultV1, resetDefault: true }),
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.content, defaultV1);
  assert.notEqual(core.readOverrideStateSync(home).explicitSave, true);
  const updated = await loadCore({ persistenceRoot: home, defaultPrompt: defaultV2 });
  updated.core.seedPromptInjectAtBoot(home);
  assert.equal(await readFile(file, 'utf8'), defaultV2);
  assert.deepEqual([...touches, ...updated.touches], []);
  assert.deepEqual(plugin.hostEffects, []);
});

test('optional persistence is confined to the independent temporary home', async (t) => {
  const { core, touches, home } = await fixture(t);
  await assert.rejects(core.saveOverrideContent(`${home}-outside`, 'must not be written'), { code: 'TEST_BOUNDARY_TOUCHED' });
  assert.equal(touches.length, 1);
  assert.equal(touches[0].name, 'fs.outsidePersistenceRoot');
});
