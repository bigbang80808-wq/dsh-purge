// This build never opts into mutating the official host, even from a CLI or
// updater child process that has not loaded the Cordis plugin configuration.
export const PRESERVE_OFFICIAL_HOST = true;

export const OFFICIAL_HOST_READ_ONLY_MESSAGE = 'This compatibility build preserves the official host, permissions, sandbox and approvals; host patching and upstream self-update are disabled.';

export function assertHostMutationAllowed() {
  const error = new Error(OFFICIAL_HOST_READ_ONLY_MESSAGE);
  error.code = 'OFFICIAL_HOST_READ_ONLY';
  throw error;
}

export function blockedHostOperation() {
  return {
    ok: false,
    code: 'OFFICIAL_HOST_READ_ONLY',
    error: OFFICIAL_HOST_READ_ONLY_MESSAGE,
  };
}
