# Restriction retirement regression tests

No third-party packages or DSH installation are required:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
```

To run the same expectations against an unmodified source snapshot, set
`DSH_PURGE_TEST_SOURCE_ROOT` to that snapshot's absolute directory. The tests
themselves still run from this checkout:

```sh
DSH_PURGE_TEST_SOURCE_ROOT=/absolute/path/to/original-source node --experimental-vm-modules --test tests/*.test.mjs
```

The harness evaluates the actual `lib/index.js`, exposing its existing
`applyHostHooks` function with one added in-memory export. It invokes the real
registration path, then dispatches the handlers and HTTP routes that path
registered. Any network or compatibility module imported by the entry point is
loaded from that source tree; the tests do not require `net-scope.js` to exist.

Filesystem, DNS, timers and unrelated host dependencies are isolated substitutes.
No real DSH client, tool, permission service, socket, install/apply action or DNS
request is invoked. Public-looking URLs and IP addresses are synthetic fixtures.

The assertions require the existing executor/next handler to run exactly once
and preserve its result or exception. They also preserve downstream host denials,
so returning a fabricated success cannot satisfy the suite. Compatibility-route
tests require read-only legacy GET, retired POST without consuming the body or
writing files, and the remaining allowed method in a 405 response.

This is an isolated registration/behavior regression suite, not a real Cordis or
DSH end-to-end compatibility test. Node may print its VM Modules experimental
warning when running it.

The identity tests separately execute the real `identity.js` and its pure prompt
dependencies. They preserve legacy prompt deduplication and ordinary custom text.
When comparing the upstream snapshot, only its already-empty `ownServerNote`
export is substituted to avoid importing client/filesystem dependencies.

Session permission tests use notification/broadcast semantics: every registered
`session/created` handler runs, followed by a microtask drain. These handlers do
not call middleware `next()`. The permission service implements `permissionState`
and `set` in memory; tests reject any automatic permission change, including for
unset presets, and preserve user-selected and subagent permissions. The harness
rejects using middleware dispatch for this broadcast event.

Official-host entry-point tests call the registered HTTP handlers and tools, plus
the real command and startup functions exposed only inside the VM. The policy
module is loaded from the source tree, not substituted. Recorded host-operation
calls must remain empty; requests must be rejected before their bodies are read.

Core guard tests evaluate the actual `core.js` and compatibility policy with
throwing filesystem, child-process, archive and desktop sentinels. Representative
patch, revert, shim, extraction/restart and hooks-setting entry points must throw
`OFFICIAL_HOST_READ_ONLY` before touching those boundaries. These sentinels also
make baseline comparison safe: an unguarded original cannot access the real host.
