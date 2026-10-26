import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = process.env.DSH_PURGE_TEST_SOURCE_ROOT
  ? path.resolve(process.env.DSH_PURGE_TEST_SOURCE_ROOT)
  : fileURLToPath(new URL('../../', import.meta.url));
const noop = () => {};
const identity = (value) => value;

// The real index registration code and any network/compatibility modules run
// inside this VM. Host modules, filesystem, DNS and timers cannot affect DSH.
// Only an extra export is appended to index; no production logic is replaced.
export async function loadPlugin({ allowText = 'owned.example\n' } = {}) {
  const dnsCalls = [];
  const writes = [];
  const reads = [];
  const dns = { lookup: async (hostname) => {
    dnsCalls.push(hostname);
    if (hostname === 'missing.example') throw new Error('synthetic DNS failure');
    return (hostname === 'mixed.example' ? ['10.0.0.2', '203.0.113.10'] : ['203.0.113.10'])
      .map((address) => ({ address }));
  } };
  const fakeFs = {
    readFileSync(filename) {
      reads.push(filename);
      if (filename === '/synthetic/dsh/net-scope-allow.txt' && allowText !== null) return allowText;
      throw Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' });
    },
    statSync: () => ({ mtimeMs: 1, size: 0 }),
    existsSync: () => false,
    appendFileSync: (...args) => writes.push(['appendFileSync', ...args]),
    writeFileSync: (...args) => writes.push(['writeFileSync', ...args]),
    unlinkSync: (...args) => writes.push(['unlinkSync', ...args]),
    renameSync: (...args) => writes.push(['renameSync', ...args]),
  };
  const timer = () => ({ unref: noop });
  const context = vm.createContext({
    console, Buffer, URL, setTimeout: timer, clearTimeout: noop,
    setInterval: timer, clearInterval: noop, queueMicrotask,
  });
  const stubs = {
    'node:fs': { default: fakeFs, ...fakeFs },
    'node:os': { default: { tmpdir: () => '/synthetic/tmp' } },
    'node:path': { default: path, ...path },
    'node:crypto': { randomUUID: () => 'synthetic-assistant-message' },
    'node:dns/promises': { default: dns, ...dns },
    './extract-asar.js': { fsFor: () => fakeFs },
    './core.js': {
      ALL_PATCHES: [], findDshHome: () => '/synthetic/dsh', pinDshHome: () => '/synthetic/dsh',
      findOverrideFile: () => '/synthetic/dsh/prompt-inject.md',
      syncPromptInjectOnDiskSync: noop, normalizeOverride: identity,
      defaultOverrideText: () => '', hangOperatorPrompt: noop, rememberCommittedOverride: noop,
    },
    './host.js': { currentSurface: () => 'test' },
    './rules.js': { resolveInjectText: () => ({ text: '' }), writeLastCwd: noop },
    './skills.js': {}, './update.js': {}, './reapply.js': {}, './official-update.js': {},
    './identity.js': {
      GLOBAL_PROMPT_ORDER: 5000, adaptInjectForMinimalPreset: identity,
      isMnemonPluginMessage: () => false, isRedteamSession: () => false,
      installAssembleGuard: noop, modePromptText: identity, peelChatmlEnvelope: identity,
      escapeDshInterpolation: identity, rewritePromptAssembly: identity,
    },
    './capability-protocol.js': { capabilityProtocolText: () => '', CAPABILITY_SECTION: 'capability' },
    './redteam/role-section.js': { installSubagentRoleCapture: noop, resolveSubagentRoleText: () => '' },
    './rewind.js': { wrapSessionDeriveMessages: noop },
    './continue-retry.js': { loadSettings: () => ({}), installContinueRetry: () => ({ dispose: noop }), mergeConfig: identity },
    './uninstall.js': {}, './drill-grant.js': { readDrillGrant: noop, writeDrillGrant: noop },
    './preset-default.js': {
      cancelClearOwnedSelectedDefault: noop, clearOwnedSelectedDefault: noop,
      removeStaleAgentPresetDir: noop, scheduleClearOwnedSelectedDefault: noop,
    },
    './settle-policy.js': {
      applyShouldRestart: noop, isInactiveContextError: () => false, settleDelayMs: () => 0,
      settleMayReapply: () => false, settleMayRestart: () => false, watchContextLife: () => ({ alive: true }),
    },
  };
  const modules = new Map();
  const stubByPath = new Map(Object.entries(stubs).filter(([key]) => key.startsWith('.'))
    .map(([key, value]) => [path.resolve(root, 'lib', key), value]));
  async function load(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    const values = stubs[identifier] ?? stubByPath.get(identifier);
    let module;
    if (values) {
      module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context, identifier });
    } else {
      if (!identifier.startsWith(path.join(root, 'lib') + path.sep)) {
        throw new Error(`Unstubbed external dependency: ${identifier}`);
      }
      let source = await readFile(identifier, 'utf8');
      if (identifier === path.join(root, 'lib/index.js')) source += '\nexport { applyHostHooks as testApplyHostHooks };\n';
      module = new vm.SourceTextModule(source, {
        context, identifier,
        importModuleDynamically: () => { throw new Error('Host dynamic imports disabled in tests'); },
      });
    }
    modules.set(identifier, module);
    return module;
  }
  const entry = await load(path.join(root, 'lib/index.js'));
  await entry.link((specifier, parent) => load(specifier.startsWith('.')
    ? path.resolve(path.dirname(parent.identifier), specifier) : specifier));
  await entry.evaluate();

  const hooks = new Map();
  const routes = new Map();
  const sections = [];
  const registeredTools = [];
  const ctx = {
    systemPrompt: { section: (section) => { sections.push(section); return noop; } },
    tools: { register: (tool) => registeredTools.push(tool) },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return noop; } },
    get: () => undefined,
    effect: (setup) => setup(),
    inject: (_services, setup) => setup(ctx),
    on(event, handler, options = {}) {
      const list = hooks.get(event) ?? [];
      if (options.prepend) list.unshift({ handler, options });
      else list.push({ handler, options });
      hooks.set(event, list);
      return noop;
    },
  };
  entry.namespace.testApplyHostHooks(ctx, { enabled: true, stripMnemon: true, capabilityProtocol: false });
  async function dispatch(event, payload, terminal) {
    const handlers = hooks.get(event) ?? [];
    const run = (index) => index < handlers.length
      ? handlers[index].handler(payload, () => run(index + 1)) : terminal();
    return run(0);
  }
  async function request(method, { content = '', bodyRead = noop } = {}) {
    const request = {
      method, url: '/dsh-purge/own-servers', headers: {},
      async *[Symbol.asyncIterator]() { bodyRead(); yield Buffer.from(content); },
    };
    let status;
    let body;
    let headers;
    const response = { writeHead: (code, values) => { status = code; headers = values; }, end: (text) => { body = text; } };
    const handler = routes.get('/dsh-purge/own-servers');
    if (!handler) throw new Error('Compatibility route was not registered');
    await handler(request, response);
    return { status, headers, body: body ? JSON.parse(body) : undefined };
  }
  // Ignore startup logging in per-request no-write assertions.
  writes.length = 0;
  reads.length = 0;
  return { ctx, hooks, routes, sections, registeredTools, dispatch, request, dnsCalls, writes, reads };
}
