# BlockWorld — Public Worlds + Restructured Main Menu (Design)

**Date:** 2026-06-15
**Slug:** `blockworld`
**Status:** Design approved by user; spec under review before plan.

## 1. Goal

Make shared worlds discoverable. Today every world is hosted `visibility:'private'` and is
reachable only by typing a 6-char code. We want worlds to be **public by default** and the main
menu to show a live list of joinable worlds, while keeping the existing per-person edit-grant model.

User-stated requirements:

- Creating or editing a world defaults to **public** — anyone can join.
- The main page shows a **list of available rooms to join**.
- Menu actions: **Create New** → start a new public world; **Edit Existing** → list of the user's
  saved worlds to open.
- Joining someone else's world is **view-only by default**; the owner enables editing per-user from
  the in-world options menu (already the current behavior — unchanged).

## 2. Platform constraints (verified against the live SDK + multiplayer server)

Confirmed by reading `GamesPlatform/lib/play-sdk.js` and `GamesPlatform/multiplayer/src/`:

- `PlaySDK.multiplayer.createRoom({ maxPlayers, visibility })` — `visibility` defaults to
  `"public"`. Accepts **no** name/metadata field.
- `PlaySDK.multiplayer.listRooms()` → resolves to an array of rooms for **this slug only**. Each
  entry is exactly `{ code, slug, playerCount, maxPlayers }`. **No world name, no owner name, no
  hostId.**
- Server `room-manager.listRooms(slug)` only returns rooms where
  `visibility === "public" && state === "lobby"`. BlockWorld never calls `room.start()`, so a hosted
  room stays in `lobby` for its whole life and remains listable. The host is counted in
  `playerCount` (≥ 1 while hosting).
- The relay is ephemeral and host-authoritative (per the Build-1 design): a world is joinable only
  while its owner is online hosting it.

**Consequence / accepted scope decision:** the join list can only display **join code + player
count**. Friendly world/owner names in the list would require extending the platform server + SDK;
the user chose to keep this change **BlockWorld-only**. World identity is instead surfaced *after*
joining (see §6).

## 3. Confirmed decisions

| Topic | Decision |
|---|---|
| Visibility | All hosted worlds are **public**. No private option (simplest). |
| Discovery | In-menu live list via `listRooms()`, polled while the Home view is open. |
| List contents | `Room <CODE> · <n>/<max>` + Join. Code-join input kept as a fallback. |
| Create New | Prompt with a name field **pre-filled with a default** (e.g. `World 5`), then host public. |
| Edit Existing | Sub-view showing the user's saved worlds (Open / rename / delete), reusing current list. |
| Edit rights | Unchanged — visitors view-only by default; owner grants per-user from ☰ menu. |
| World name after join | Host sends its real world name in `WELCOME`; visitor's ☰ header shows `In: <name>`. |

**Out of scope (YAGNI):** friendly names/owner in the list itself; per-world private toggle;
`quickMatch`; host migration; any change to persistence, rendering, or the permission model.

## 4. Behavior flow

```
Main menu (Home)
 ├─ [+ Create New World] → inline name field (default-filled) → onNew(name)
 │                         → createWorld + fillFloor + save + startHost(public)
 ├─ [Edit Existing →]     → My Worlds sub-view
 │        ├─ [← Back]
 │        ├─ Open  → startHost(id, public)
 │        ├─ ✎     → rename in index
 │        └─ 🗑     → delete world
 └─ Join a live world
          ├─ live list (polled ~4s): Room <CODE> · n/max → onJoin(code) → startVisitor
          └─ CODE input + Join → onJoin(code)

startHost  : createRoom({ maxPlayers:8, visibility:'public' }) → runGame(host:true, worldName)
startVisitor(code): joinRoom(code) → runGame(host:false); visitor view-only until granted
```

## 5. Components & changes

### 5.1 `lib/ui/menus.js` — `showMainMenu` (main change)

Add an internal `view` state (`'home' | 'worlds'`) rendered into the same overlay.

- **Home view:**
  - `+ Create New World` primary button → toggles an inline name field, pre-filled with a default
    name supplied by the caller (`defaultName`), plus Create/Cancel. Create calls `onNew(name)`
    (trimmed, non-empty).
  - `Edit Existing →` button → `view='worlds'`, re-render.
  - **Join a live world** section: a `#mm-rooms` container rendered from a `rooms` array, plus the
    existing `CODE` input + Join. Empty state: "No live worlds right now."
- **My Worlds sub-view:** `← Back` (→ `view='home'`) and the existing saved-worlds list (Open /
  rename ✎ / delete 🗑), reused verbatim.
- **Room polling:** new option `onListRooms: () => Promise<rooms>`. On entering/rendering the Home
  view, fetch once and start a `setInterval` (~4000ms) that calls `onListRooms()` and updates the
  list via an internal `setRooms`. Stop the interval when leaving Home, on `close()`. A rejected
  promise renders the empty state (no error spam). `setRooms` diffs are not required — full
  re-render of `#mm-rooms` only.
- **New/changed options:** `defaultName` (string), `onListRooms` (async fn). Existing options
  (`worlds`, `displayName`, `onOpen`, `onNew`, `onRename`, `onDelete`, `onJoin`, returned
  `setStatus`/`setWorlds`/`close`) preserved. The caller may call `setWorlds` to refresh saved
  worlds; the menu owns room polling itself.

### 5.2 `lib/ui/menus.js` — `createInWorldMenu`

- `getState()` may include `worldName` (string, optional). For a **visitor** (`!isHost`), render a
  header line `In: <worldName>` when present. Host view unchanged (still shows the share code).

### 5.3 `main.js`

- `startHost`: `createRoom({ maxPlayers: 8, visibility: 'public' })`. Pass the world's display name
  (looked up from `index` by `worldId`, falling back to a default) through to `runGame` as
  `worldName`.
- `boot`: build the menu with `defaultName: defaultWorldName(index)` and
  `onListRooms: () => (sdk?.multiplayer?.listRooms ? sdk.multiplayer.listRooms() : Promise.resolve([]))`.
  `onNew` keeps generating the id and pre-seeding the world; the name comes from the (default-filled)
  field.
- `runGame`: accept `worldName`; pass it to `createSession` as `hooks.worldName` (replacing the
  hardcoded `'World'`) and expose it to the in-world menu `getState()`.
- Helper `defaultWorldName(index)`: next `World N` where N avoids collisions with existing names
  (simple count-based default; the user can edit before creating).

### 5.4 `lib/net/session.js`

- On `T.WELCOME`, capture `p.name` into a `joinedWorldName` variable and invoke a new optional hook
  `hooks.onWelcome?.(p.name)` so the visitor can update its ☰ header. Host path already sets
  `worldName` when sending `WELCOME`. Expose `worldName()` getter returning `joinedWorldName` (for
  visitor) or `hooks.worldName` (for host) so `getState()` can read it without extra plumbing.
- No protocol/version change: `WELCOME` already carries `name`; we now send a real value and read it.

## 6. Showing world identity after joining

Because the list is name-less, the joiner learns the world's name from the `WELCOME` message the
host already sends on join (`{ t: WELCOME, name: <worldName> }`). The visitor stores it and the ☰
menu shows `In: <worldName>`. Owner/other-player identity is already visible via floating avatar
names and the players list — no change needed.

## 7. Testing

- **`lib/net/session.js`** (`test/session.test.js`): host sends `WELCOME` with the provided
  `worldName`; visitor captures `p.name` and `worldName()` returns it; `onWelcome` hook fires.
  Existing session assertions must still pass.
- **Manual / smoke:** `menus.js` is DOM-only and untested by unit tests; verify via the dev server
  (`scripts/dev-server.mjs`): Home shows Create/Edit/Join; Create pre-fills a default name; Edit
  Existing navigates to the saved list and back; the live list polls and a code-join still works;
  a second client sees the first's room in the list and joins view-only; the host grants edit and
  the visitor can build; the visitor's ☰ header shows the world name.
- No new persistence or rendering logic, so those suites are unaffected.

## 8. Risks / notes

- **Empty/own room in list:** while on the main menu the user is not hosting, so their own room is
  absent. Rooms with only a host (playerCount 1) still list — desirable (they're joinable).
- **Poll churn:** 4s interval is light; ensure it is cleared on `close()` and when leaving Home to
  avoid leaks after entering a world.
- **Guest/no-SDK:** if `sdk.multiplayer.listRooms` is missing (older SDK / offline), `onListRooms`
  resolves `[]` and the list shows the empty state; create/edit/code-join still function.
- **Default-name collisions:** the default is a convenience only; `onNew` does not enforce
  uniqueness (consistent with today).
