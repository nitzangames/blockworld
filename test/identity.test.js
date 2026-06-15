import { describe, it, expect } from 'vitest';
import { resolveDisplayName, watchDisplayName } from '../lib/identity.js';

const immediate = () => Promise.resolve();
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('resolveDisplayName', () => {
  it('keeps polling until the token/profile handshake yields a name', async () => {
    // PlaySDK.getDisplayName() returns a snapshot that is null until the profile
    // fetch lands (up to ~2s after onReady). Simulate it appearing on the 3rd read.
    let calls = 0;
    const sdk = { getDisplayName: () => Promise.resolve(++calls >= 3 ? 'Ledniv' : null) };
    expect(await resolveDisplayName(sdk, { tries: 6, sleep: immediate })).toBe('Ledniv');
    expect(calls).toBe(3);
  });

  it('returns null for a genuinely anonymous user (name never appears)', async () => {
    const sdk = { getDisplayName: () => Promise.resolve(null) };
    expect(await resolveDisplayName(sdk, { tries: 3, sleep: immediate })).toBeNull();
  });
});

describe('watchDisplayName', () => {
  it('upgrades to the real name when sign-in lands after the initial read', async () => {
    let name = null; let signInCb = null;
    const sdk = { getDisplayName: () => Promise.resolve(name), signInChanged: (cb) => { signInCb = cb; } };
    const seen = [];
    watchDisplayName(sdk, (n) => seen.push(n), { tries: 1, sleep: immediate });
    await flush();
    expect(seen).toEqual([]);          // anonymous at boot — nothing reported yet

    name = 'Ledniv'; signInCb();        // token + profile arrive late
    await flush();
    expect(seen).toEqual(['Ledniv']);   // game gets the real name
  });

  it('does not report the same name twice', async () => {
    const sdk = { getDisplayName: () => Promise.resolve('Ledniv'), signInChanged: (cb) => { cb(); } };
    const seen = [];
    watchDisplayName(sdk, (n) => seen.push(n), { tries: 1, sleep: immediate });
    await flush();
    expect(seen).toEqual(['Ledniv']);
  });
});
