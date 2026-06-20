# BlockWorld — Publish & Visit Worlds Offline (Design)

**Date:** 2026-06-20
**Slug:** `blockworld`
**Status:** Design approved by user; spec under review before plan.
**Repos:** `GamesPlatform` (platform API + SDK) and `BlockWorld` (game).

## 1. Goal

Let anyone visit a creator's world **even when the creator is offline**. Today a world lives only in
the creator's private per-user cloud save and is reachable only while they're live-hosting (an
ephemeral relay). This adds a **public snapshot** path: worlds auto-publish a snapshot to a public
store, a gallery lists them, and visitors can explore a snapshot read-only and optionally copy it.

This is **separate from** the existing "Join a live world" (live, real-time co-building when the
creator is online). The gallery is the offline-visit path.

## 2. Confirmed model

- **Auto-publish on save.** Whenever the host autosaves a world, its snapshot is also pushed to the
  public store (throttled — see §4) — unless the world is Private.
- **Per-world privacy, 3 levels** (default Public):
  - **Public** — listed in the gallery, explorable read-only, **copyable**.
  - **View-only** — listed + explorable read-only, **not copyable**.
  - **Private** — **not published** (no public row; not listed, not visitable, not copyable).
- **Discovery:** a public **"Explore worlds"** gallery on the main menu.
- **Visiting:** opening a gallery world loads its snapshot in a **solo, read-only viewer** (walk/fly to
  look around; building disabled; no multiplayer room). If the world is copyable, a **"Make a copy"**
  button forks the snapshot into the visitor's own worlds (editable, owned by them; original
  untouched).

## 3. Platform (`GamesPlatform`)

### 3.1 Table `published_worlds`

| column | type | notes |
|---|---|---|
| `publish_id` | text, **PK** | random short id; the public URL key (avoids exposing `creator_id`) |
| `creator_id` | uuid | from the auth token |
| `slug` | text | `'blockworld'` |
| `world_id` | text | the creator's per-world id (e.g. `w3`) |
| `title` | text | world name |
| `creator_name` | text | denormalized for the gallery |
| `blob` | text | RLE-serialized world (same format `game_saves.value` already stores) |
| `copyable` | boolean | true = Public, false = View-only |
| `updated_at` | timestamptz | last publish |

`UNIQUE(creator_id, slug, world_id)` — one row per world; `publish_id` is stable across re-publishes.
Private worlds have **no row**.

### 3.2 Endpoints

- **`POST /api/worlds/publish`** (auth: Bearer token).
  Body `{ slug, worldId, title, blob, privacy }` where `privacy ∈ {public, viewonly, private}`.
  - `private` → **delete** the row for `(creator_id, slug, worldId)` (idempotent).
  - else → **upsert** by `(creator_id, slug, worldId)`: set `title`, `blob`, `creator_name` (from the
    user's profile), `copyable = (privacy === 'public')`, `updated_at = now()`; generate `publish_id`
    on first insert. Returns `{ publish_id }`.
  - Size guard (reuse the saves limit). Rate-limited like other mutations.
- **`GET /api/worlds?slug=blockworld`** (public, no auth).
  Returns `{ worlds: [{ publish_id, title, creator_name, copyable, updated_at }] }` — **metadata only,
  no blob** — ordered by `updated_at` desc, capped (e.g. 200). Lists Public + View-only (every row,
  since Private rows don't exist).
- **`GET /api/worlds/:publishId`** (public, no auth).
  Returns `{ publish_id, title, creator_name, copyable, blob }` or **404** if missing (e.g. the world
  went Private and its row was deleted).

Public reads are a deliberate exception to the per-user-private `game_saves` model and only ever
expose rows that exist (Public/View-only). RLS/policies must allow anonymous read of this table only.

### 3.3 SDK (`lib/play-sdk.js`)

Add one authed method (only the SDK holds the token):

- `PlaySDK.publishWorld({ worldId, title, blob, privacy })` → `POST /api/worlds/publish`, resolves
  `{ publish_id }` or rejects. (List/get are public, so the game fetches them directly — the injected
  CSP already allows `connect-src https://nitzan.games`.)

## 4. Game (`BlockWorld`)

- **Index entry gains `privacy`** (`'public' | 'viewonly' | 'private'`), default `'public'`; migrate
  existing entries with `privacy ??= 'public'`. (`lib/persist/worlds.js`.)
- **Auto-publish (host only).** A `makeWorldPublisher(sdk, ...)` alongside `makeWorldAutosaver`:
  after a successful private save, push to the public store via `sdk.publishWorld(...)`, **throttled
  to ≤ once / ~20s while editing, plus a final publish on leave** (so the 3s autosave doesn't hammer
  it). Best-effort: failures are swallowed and retried on the next tick (the private save remains the
  source of truth). Skips entirely when `privacy === 'private'` after sending one delete so the row
  is removed.
- **Privacy control** in the "Edit Existing" world list: a small cycle control per world
  (Public → View-only → Private) showing the current level. Changing it updates the index entry,
  saves the index, and triggers a publish (push new privacy / delete).
- **"Explore worlds" gallery** — a new entry on the main menu Home view → a sub-view that fetches the
  public list (`GET /api/worlds?slug=blockworld`) and shows rows (title · creator · last-edited).
  Tap a row → fetch its blob (`GET /api/worlds/:publishId`) and open it.
- **Solo read-only viewer.** Visiting a published world renders its snapshot with the existing
  camera/input/movement (walk + fly), **no multiplayer room, no session, no autosave/publish, building
  disabled** (the crosshair highlight hidden, `act()` is a no-op). A **"Make a copy"** button appears
  when `copyable` is true.
- **Make a copy** forks the snapshot into the visitor's own worlds: `newWorldId(index)`, deserialize
  the blob into a world, `saveWorld` + `upsertWorld(index, {privacy:'public'})` + save index, then
  reopen it as a normal owned world (editable; the visitor becomes its host).

## 5. Data flow

1. Host edits → `makeWorldAutosaver` writes the private save (unchanged) → `makeWorldPublisher`
   (throttled) calls `sdk.publishWorld({worldId, title, blob, privacy})`.
2. Platform upserts/deletes the `published_worlds` row.
3. A visitor opens the menu → "Explore worlds" → game fetches the public list → taps a world → fetches
   its blob → solo read-only viewer.
4. Visitor taps "Make a copy" (if copyable) → fork into their worlds → edit as owner.

## 6. Error handling

- **Publish failure** (network/auth/size): swallowed; retried on the next autosave/publish tick. The
  private save is authoritative, so the world is never at risk.
- **Gallery list failure:** show an empty/"couldn't load" state; retry on reopen.
- **Blob get 404** (world went Private / deleted): show "this world is no longer available" and return
  to the gallery.
- **Deserialize failure:** guard; show the same unavailable message rather than crashing.

## 7. Testing

**Platform** (Vitest in `GamesPlatform`): publish upserts a row and is idempotent; `privacy:private`
deletes the row; `copyable` reflects public vs viewonly; list returns metadata only (no blob) and is
ordered/capped; get returns the blob or 404; auth required for publish, public for list/get.

**Game** (Vitest in `BlockWorld`, pure logic): index `privacy` default + migration; the publish
throttle (≤ once per window + trailing/leave flush) using injected time; fork-from-blob
(`newWorldId` + deserialize + `upsertWorld`) produces a new owned world with the snapshot's contents.
Gallery/viewer/privacy-control UI is DOM — verified via the dev-server smoke test and on-device.

## 8. Sequencing

Platform first (table + 3 endpoints + `publishWorld` SDK method), **deployed** to Railway, then the
game changes (which depend on those endpoints), then deploy the game. The plan orders tasks
accordingly.

## 9. Out of scope (YAGNI for this build)

- Per-world thumbnails in the gallery (text rows for now).
- Content moderation / reporting of published worlds — a new public surface that should get
  report/takedown support, but later (noted, not built here).
- Always-on live hosting (the big backend option we rejected).
- Search/pagination beyond a simple capped, recency-ordered list.
