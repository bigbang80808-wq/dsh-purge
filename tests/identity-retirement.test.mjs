import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.DSH_PURGE_TEST_SOURCE_ROOT
  ? path.resolve(process.env.DSH_PURGE_TEST_SOURCE_ROOT)
  : fileURLToPath(new URL('../', import.meta.url));

async function loadIdentity() {
  const context = vm.createContext({ process: { env: {} } });
  const modules = new Map();
  async function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    let module;
    if (filename === path.join(root, 'lib/net-scope.js')) {
      // Baseline compatibility only: upstream ownServerNote already returned ''.
      // Do not import the legacy network module's client/filesystem dependencies.
      module = new vm.SyntheticModule(['ownServerNote'], function () {
        this.setExport('ownServerNote', () => '');
      }, { context, identifier: filename });
    } else {
      assert.ok(['identity.js', 'capability-protocol.js', 'phase1-keep.js']
        .some((name) => filename === path.join(root, 'lib', name)), 'unexpected dependency');
      module = new vm.SourceTextModule(await readFile(filename, 'utf8'), { context, identifier: filename });
    }
    modules.set(filename, module);
    return module;
  }
  const module = await load(path.join(root, 'lib/identity.js'));
  await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  await module.evaluate();
  return module.namespace;
}

test('retiring the allowlist preserves deduplication of existing legacy prompts', async () => {
  const { rewritePromptAssembly } = await loadIdentity();
  const base = 'Distinctive existing custom prompt.';
  const inject = `${base}\n\nOWN SERVERS — EXACT LIST ONLY\nlegacy.example`;
  const initial = { sections: [{ name: 'deployment:persona-prefix', text: base, order: 0 }], contexts: [], tools: [] };
  const snapshot = structuredClone(initial);
  const result = rewritePromptAssembly(initial, inject, { capabilityProtocol: false });
  assert.equal(result.sections.map((section) => section.text).join('\n').split(base).length - 1, 1);
  assert.equal(result.sections.find((section) => section.name === 'dsh-purge').text, inject);
  assert.deepEqual(initial, snapshot, 'must not mutate the host assembly');
  const repeated = rewritePromptAssembly(result, inject, { capabilityProtocol: false });
  assert.equal(repeated.sections.map((section) => section.text).join('\n').split(base).length - 1, 1);
  assert.equal(repeated.sections.find((section) => section.name === 'dsh-purge').text, inject);
});

test('ordinary custom text containing the retired gate keywords survives assembly', async () => {
  const { rewritePromptAssembly } = await loadIdentity();
  const inject = '讨论渗透测试与 anti-cheat 原理。参考 https://public.example/docs。';
  const result = rewritePromptAssembly({ sections: [], contexts: [], tools: [] }, inject, { capabilityProtocol: false });
  assert.equal(result.sections.find((section) => section.name === 'dsh-purge').text, inject);
});
