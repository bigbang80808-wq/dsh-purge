import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlugin } from './helpers/plugin-harness.mjs';

// Run with: node --experimental-vm-modules --test tests/*.test.mjs
// All URLs/IPs are fixtures. No network, host client or real tools are used.
const toolCases = [
  ['ordinary browsing', { name: 'browse', args: { url: 'https://public.example/docs' } }],
  ['ordinary downloading', { name: 'download', args: { url: 'https://public.example/file.zip' } }],
  ['local document containing a URL', { name: 'write_file', args: { path: '/tmp/notes.md', content: 'Reference https://public.example/' } }],
  ['explicitly authorized example target', { name: 'shell', args: { command: 'inspect 203.0.113.10', authorization: 'Explicitly authorized synthetic test target' } }],
  ['DNS failure does not become a plugin refusal', { name: 'browse', args: { url: 'https://missing.example/' } }],
  ['mixed DNS does not become a plugin refusal', { name: 'browse', args: { url: 'https://mixed.example/' } }],
  ['game terminology in a local document', { name: 'write_file', args: { path: '/tmp/game.md', content: 'anti-cheat research; https://public.example/' } }],
];

for (const [name, exec] of toolCases) {
  test(`tool chain reaches its existing executor: ${name}`, async () => {
    const plugin = await loadPlugin();
    const payload = structuredClone(exec);
    const original = structuredClone(payload);
    const result = { content: [{ type: 'text', text: 'result from existing executor' }], token: {} };
    let downstreamCalls = 0;
    // A separately installed host hook must still run after this plugin.
    plugin.ctx.on('tools/pre-execute', async (_exec, next) => {
      downstreamCalls++;
      return next();
    });
    let executions = 0;
    const actual = await plugin.dispatch('tools/pre-execute', payload, () => { executions++; return result; });
    assert.equal(executions, 1, 'must invoke the existing executor exactly once, not synthesize success/refusal');
    assert.equal(downstreamCalls, 1, 'must preserve other tools/pre-execute hooks');
    assert.equal(actual, result, 'must preserve the executor result object');
    assert.deepEqual(payload, original, 'must not set blocked/error on tool input');
    assert.deepEqual(plugin.dnsCalls, [], 'the retired plugin gate must not resolve tool text');
  });
}

const promptCases = [
  ['attack theory without a target', '解释 attack 的中文含义', false],
  ['pentest theory without a target', '仅讨论渗透测试的定义，不对任何目标操作', false],
  ['red team theory without a target', '讨论红队的概念，不执行任何操作', false],
  ['authorized public example', '明确授权对示例目标 203.0.113.10 做渗透测试', false],
  ['unresolved domain in discussion', '讨论对 missing.example 的渗透测试方案', false],
  ['mixed DNS domain in discussion', '讨论对 mixed.example 的渗透测试方案', false],
  ['game keyword discussion', '介绍游戏外挂、anti-cheat 与内存修改的区别', false],
  ['redteam preset ordinary reading', '阅读 https://public.example/docs', true],
];

for (const [name, text, redteam] of promptCases) {
  test(`pre-step chain preserves the actual decision: ${name}`, async () => {
    const plugin = await loadPlugin();
    const appended = [];
    const session = { agentPreset: redteam ? 'redteam' : 'default', append: (...args) => appended.push(args) };
    const messages = [{ role: 'user', content: text }];
    const decision = { kind: 'enter', messages, token: {} };
    let executions = 0;
    const actual = await plugin.dispatch('agent/pre-step', { step: 1, turn: 1, agent: { session }, messages },
      () => { executions++; return decision; });
    assert.equal(executions, 1, 'must reach the next pre-step handler');
    assert.equal(actual, decision, 'must preserve real downstream decisions');
    assert.deepEqual(appended, [], 'must not manufacture a local assistant refusal');
    assert.deepEqual(plugin.dnsCalls, [], 'must not resolve domains mentioned in discussions');
  });
}

test('downstream tool denial remains a denial', async () => {
  const plugin = await loadPlugin();
  const refusal = { isError: true, content: 'Host permission denied' };
  let calls = 0;
  plugin.ctx.on('tools/pre-execute', () => { calls++; return refusal; });
  const actual = await plugin.dispatch('tools/pre-execute', { name: 'browse', args: { url: 'https://public.example/' } },
    () => assert.fail('executor must not run after the host denies'));
  assert.equal(calls, 1, 'the host permission hook must run');
  assert.equal(actual, refusal, 'must not replace host permissions with success');
});

test('a later local-task step is not blocked by a public URL in old tool history', async () => {
  const plugin = await loadPlugin();
  const appended = [];
  const session = { append: (...args) => appended.push(args) };
  const history = [
    { role: 'assistant', toolCalls: [{ arguments: { url: 'https://public.example/' } }] },
    { role: 'user', content: '讨论渗透测试本地靶场 http://127.0.0.1/' },
  ];
  let executions = 0;
  const first = { kind: 'enter', messages: history };
  assert.equal(await plugin.dispatch('agent/pre-step', { step: 1, turn: 2, agent: { session }, messages: history },
    () => { executions++; return first; }), first);
  const messages = [...history, { role: 'assistant', content: '处理当前本地任务' }];
  const second = { kind: 'enter', messages };
  assert.equal(await plugin.dispatch('agent/pre-step', { step: 2, turn: 2, agent: { session }, messages },
    () => { executions++; return second; }), second);
  assert.equal(executions, 2);
  assert.deepEqual(appended, []);
});

test('downstream tool exceptions propagate unchanged', async () => {
  const plugin = await loadPlugin();
  const error = new Error('synthetic executor failure');
  await assert.rejects(plugin.dispatch('tools/pre-execute', { name: 'download', args: { url: 'https://public.example/file' } },
    () => { throw error; }), (caught) => caught === error);
});

test('other plugin registrations remain available', async () => {
  const plugin = await loadPlugin();
  assert.ok(plugin.sections.some((section) => section.name === 'dsh-purge'));
  assert.ok(plugin.hooks.has('system-prompt/assemble'));
  assert.ok(plugin.registeredTools.some((tool) => tool.name === 'purge_status'));
});

test('retired allowlist GET reads legacy content and clearly reports inactive/read-only', async () => {
  const plugin = await loadPlugin({ allowText: 'user@owned.example\n203.0.113.10\n' });
  const result = await plugin.request('GET');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, active: false, readOnly: true, content: 'user@owned.example\n203.0.113.10\n' });
  assert.deepEqual(plugin.writes, []);
});

test('retired allowlist GET tolerates a missing legacy file', async () => {
  const plugin = await loadPlugin({ allowText: null });
  const result = await plugin.request('GET');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, active: false, readOnly: true, content: '' });
  assert.deepEqual(plugin.writes, []);
});

test('retired allowlist POST rejects without consuming input or writing files', async () => {
  const plugin = await loadPlugin();
  let bodyReads = 0;
  const result = await plugin.request('POST', { content: '{"content":"new.example"}', bodyRead: () => bodyReads++ });
  assert.equal(result.status, 410);
  assert.deepEqual(result.body, {
    ok: false, code: 'NET_SCOPE_RETIRED',
    error: 'The network allowlist has been retired; no changes were saved.',
  });
  assert.equal(bodyReads, 0);
  assert.deepEqual(plugin.reads, []);
  assert.deepEqual(plugin.writes, []);
});

test('retired allowlist preserves method rejection', async () => {
  const plugin = await loadPlugin();
  const result = await plugin.request('DELETE');
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'GET');
  assert.deepEqual(plugin.writes, []);
});
