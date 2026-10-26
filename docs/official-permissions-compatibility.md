# Compatibility scope

- Base: `bde36403e909e4cf288e447de11f7a390c337480`, six admission restrictions removed.
- Build: `1.1.78-compat.2`, `official-permissions-prompt-save-20261027`.
- Target: official DeepSeek Harness desktop `0.2.1-rc.3`, bundled Cordis 4.0.5.
- Attribution: [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge).

The compatibility policy is fixed in the package. UI, HTTP, commands, tools, core mutation APIs, updater, reapply and legacy uninstall cannot opt back into host patching. Official application files and session permission presets are not rewritten. Existing DSH_PERMISSION_MODE values are inherited. Upstream updates are disabled to prevent replacement of these protections.

Explicitly saved prompt text now takes precedence over legacy default-template fingerprints. The editor and HTTP responses preserve the stored string, including whitespace. A persistent explicit-save marker protects it across refresh and restart. Existing matching `customized: true` records are also respected. The Restore Default button explicitly releases that marker; unsaved old defaults still migrate. Deleted prompt files are seeded again.

This change is limited to prompt storage and editor round trips. Model-injection normalization, built-in prompt text, role presets, retry/continue and output behavior remain unchanged. A browser textarea may normalize typed/pasted CRLF to LF before submission; the server preserves the submitted string. Remote model decisions, official tool approvals and network failures remain possible.

## Verification

Run `node --experimental-vm-modules --test tests/*.test.mjs`. Tests cover the six gate removals, session permission preservation, HTTP/command/tool/startup guards, representative core write entry points, and prompt save/read/refresh/restart/default-reset behavior. Prompt persistence tests use independent temporary directories and fresh module instances; they do not touch the real DSH profile. Real desktop loading, remote model responses and tool execution require separate live verification. See `tests/README.md` for isolated boundaries.

## Installation and rollback

Identify the real application, DSH_HOME and profile. Back up the profile manifest and patches, currently installed plugin, existing prompt files/plugin state, and relevant desktop settings. Record absent files too. Preserve sessions and credentials.

Use a verified immutable commit of this branch. Register only its package and bundle in the selected profile; do not run upstream host Apply/Revert or modify the official application. Keep hooksDenyBypass false. Retain official access mode and approve only specific benign test actions needed.

For rollback, quit DSH, remove the newly registered bundle/package using the install manifest, restore backed-up profile files and prior plugin/prompt state, then restart. Preserve new sessions. Do not use the disabled legacy uninstall or overwrite unrelated newer settings with a whole-profile backup without comparing them first.
