// Resolves the signed-in display name from PlaySDK, tolerating the auth handshake.
//
// PlaySDK.getDisplayName() returns a *snapshot* of the cached name. On a fresh load the
// name is null until the parent posts the auth token (up to ~2s later) and the SDK's chained
// saves→profile fetch completes. The SDK can also fire `onReady` as "anonymous" via a 2s
// timeout before the token arrives, so reading the name once at onReady can miss it. These
// helpers poll for the name and listen for a late sign-in so the UI can update when it lands.

// Polls getDisplayName() until it yields a non-empty name or the attempts run out.
// `sleep` is injectable so tests can run without real timers.
export async function resolveDisplayName(sdk, opts = {}) {
  if (!sdk || !sdk.getDisplayName) return null;
  const tries = opts.tries ?? 15;
  const intervalMs = opts.intervalMs ?? 300;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i <= tries; i++) {
    let name = null;
    try { name = await sdk.getDisplayName(); } catch {}
    if (name) return name;
    if (i < tries) await sleep(intervalMs);
  }
  return null;
}

// Calls cb(name) once a non-empty display name is known, and again only if it changes.
// Runs immediately (covers the name already being cached) and re-runs on `signInChanged`
// (covers the token arriving after the SDK already reported ready as anonymous).
export function watchDisplayName(sdk, cb, opts = {}) {
  if (!sdk || !sdk.getDisplayName) return;
  let last = null;
  const run = () => resolveDisplayName(sdk, opts).then((name) => {
    if (name && name !== last) { last = name; cb(name); }
  }).catch(() => {});
  if (sdk.signInChanged) sdk.signInChanged(run);
  run();
}
