import { readFile } from 'node:fs/promises';
import realFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = process.env.DSH_PURGE_TEST_SOURCE_ROOT
  ? path.resolve(process.env.DSH_PURGE_TEST_SOURCE_ROOT)
  : fileURLToPath(new URL('../../', import.meta.url));

// Evaluate real core and policy only. Every filesystem/process/host dependency
// is a throwing sentinel; even an unguarded baseline cannot reach the machine.
export async function loadCore({ persistenceRoot, defaultPrompt } = {}) {
  const touches = [];
  const unexpected = (name) => (...args) => {
    touches.push({ name, args });
    throw Object.assign(new Error(`Unexpected isolated boundary call: ${name}`), { code: 'TEST_BOUNDARY_TOUCHED' });
  };
  const persistence = persistenceRoot ? realFs.realpathSync(persistenceRoot) : null;
  const checkPath = (candidate) => {
    const resolved = typeof candidate === 'string' ? path.resolve(candidate) : '';
    if (!persistence || (resolved !== persistence && !resolved.startsWith(persistence + path.sep))) {
      return unexpected('fs.outsidePersistenceRoot')(candidate);
    }
    return candidate;
  };
  const confined = (owner, key, pathCount = 1) => (...args) => {
    for (let i = 0; i < pathCount; i++) checkPath(args[i]);
    return owner[key](...args);
  };
  const asyncMethods = persistence ? Object.fromEntries(
    ['readFile', 'writeFile', 'mkdir', 'unlink', 'rm', 'stat'].map((key) => [key, confined(realFs.promises, key)]),
  ) : {};
  if (persistence) {
    asyncMethods.rename = confined(realFs.promises, 'rename', 2);
    asyncMethods.open = async (...args) => {
      checkPath(args[0]);
      const handle = await realFs.promises.open(...args);
      return { writeFile: (...values) => handle.writeFile(...values), sync: () => handle.sync(), close: () => handle.close() };
    };
  }
  const fsMethods = new Proxy(asyncMethods, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key] : unexpected(`fs.${String(key)}`) });
  const syncMethods = persistence ? Object.fromEntries(
    ['existsSync', 'readFileSync', 'writeFileSync', 'mkdirSync', 'unlinkSync', 'statSync', 'chmodSync'].map((key) => [key, confined(realFs, key)]),
  ) : {};
  if (persistence) syncMethods.renameSync = confined(realFs, 'renameSync', 2);
  const fakeFs = new Proxy({ ...syncMethods, promises: fsMethods, constants: {} }, {
    get: (target, key) => key in target ? target[key] : unexpected(`fs.${String(key)}`),
  });
  const filename = path.join(root, 'lib/core.js');
  const source = await readFile(filename, 'utf8');
  const namespaceSentinels = (name) => Object.fromEntries(
    [...new Set([...source.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))].map((match) => match[1]))]
      .map((key) => [key, unexpected(`${name}.${key}`)]),
  );
  const symbols = (names, namespace) => Object.fromEntries(names.split(' ').map((name) => [name, unexpected(`${namespace}.${name}`)]));
  const stubs = {
    'node:fs': { default: fakeFs },
    'node:os': { default: { homedir: () => '/synthetic/home', tmpdir: () => '/synthetic/tmp' } },
    'node:path': { default: path },
    'node:crypto': { createHash },
    'node:child_process': { execFileSync: unexpected('process.execFileSync'), spawn: unexpected('process.spawn') },
    'node:module': { createRequire: unexpected('module.createRequire') },
    'node:url': { fileURLToPath },
    './hide-console.js': symbols('installHideConsole installHideConsoleIntoBin resolveDshBinRoot revertHideConsoleFromBin', 'hideConsole'),
    './desktop.js': namespaceSentinels('desktop'),
    './extract-asar.js': {
      ...symbols('asarArchiveIsFile asarFileIdentity commitExtractedDir extractAsarToSide shouldExtractAsar sameAsarIdentity newestPreservedDir overlayAsarUnpacked renameAsarAside restoreExtractedDir withFsProbeCache', 'asar'),
      hostFs: fakeFs,
    },
    './surface.js': { adapterFor: () => 'web', detectSurface: () => 'web' },
    './host-clean.js': { hostPromptKeepsInject: unexpected('hostPromptKeepsInject') },
    './phase1-keep.js': { PHASE1_KEEP_EXPR: '', widenPhase1KeepFilter: unexpected('widenPhase1KeepFilter') },
    './table-read.js': { openSlot: typeof defaultPrompt === 'string' ? () => defaultPrompt : unexpected('openSlot') },
    './hooks-deny.js': namespaceSentinels('hooksDeny'),
  };
  const context = vm.createContext({
    console, Buffer, URL,
    process: { platform: 'linux', pid: 1, env: {}, argv: [], execPath: '/synthetic/node', cwd: () => '/synthetic/cwd' },
    setTimeout: unexpected('timer.setTimeout'), clearTimeout: unexpected('timer.clearTimeout'),
  });
  const modules = new Map();
  async function moduleFor(specifier) {
    if (modules.has(specifier)) return modules.get(specifier);
    let module;
    const values = stubs[specifier];
    if (values) {
      module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context, identifier: specifier });
    } else if (specifier === './compatibility-policy.js') {
      const policyPath = path.join(root, 'lib/compatibility-policy.js');
      module = new vm.SourceTextModule(await readFile(policyPath, 'utf8'), { context, identifier: policyPath });
    } else {
      throw new Error(`Unstubbed core dependency: ${specifier}`);
    }
    modules.set(specifier, module);
    return module;
  }
  const core = new vm.SourceTextModule(source, {
    context, identifier: filename,
    initializeImportMeta: (meta) => { meta.url = pathToFileURL(filename).href; },
    importModuleDynamically: unexpected('dynamic import'),
  });
  await core.link(moduleFor);
  await core.evaluate();
  return { core: core.namespace, touches };
}
