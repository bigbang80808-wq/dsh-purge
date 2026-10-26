# Compatibility scope

- Base: `bde36403e909e4cf288e447de11f7a390c337480`, six admission restrictions removed.
- Build: `1.1.78-compat.1`, `official-permissions-20261027`.
- Target: official DeepSeek Harness desktop `0.2.1-rc.3`, bundled Cordis 4.0.5.
- Attribution: [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge).

The compatibility policy is fixed in the package. UI, HTTP, commands, tools, core mutation APIs, updater, reapply and legacy uninstall cannot opt back into host patching. Official application files and session permission presets are not rewritten. Existing DSH_PERMISSION_MODE values are inherited. Upstream updates are disabled to prevent replacement of these protections.

The prompt pipeline, prompt files, role presets, retry/continue and output behavior remain unchanged. Custom prompts containing legacy default markers may be reseeded. This is not a prompt-control fix. Remote model decisions, official tool approvals and network failures remain possible.

## Verification

Run `node --experimental-vm-modules --test tests/*.test.mjs`. The 63 isolated tests cover the six gate removals, session permission preservation, HTTP/command/tool/startup guards and representative core write entry points. Real desktop loading, remote model responses and tool execution require separate live verification. See `tests/README.md` for isolated boundaries.

## Installation and rollback

Identify the real application, DSH_HOME and profile. Back up the profile manifest and patches, currently installed plugin, existing prompt files/plugin state, and relevant desktop settings. Record absent files too. Preserve sessions and credentials.

Use a verified immutable commit of this branch. Register only its package and bundle in the selected profile; do not run upstream host Apply/Revert or modify the official application. Keep hooksDenyBypass false. Retain official access mode and approve only specific benign test actions needed.

For rollback, quit DSH, remove the newly registered bundle/package using the install manifest, restore backed-up profile files and prior plugin/prompt state, then restart. Preserve new sessions. Do not use the disabled legacy uninstall or overwrite unrelated newer settings with a whole-profile backup without comparing them first.
