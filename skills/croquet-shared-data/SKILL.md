---
name: croquet-shared-data
license: MIT
description: 'Share player-made content and big data in a Croquet app: meshes, STL or 3D models, images, recordings, custom parts or levels, saved designs, anything over a few KB or any data a player made that has to reach the other browsers. Covers the 16 KB message limit, putting bytes on the session file server (session.data.store / fetch, Croquet-in-a-Box files) with only small content-addressed refs in the model, checking such content deterministically in the model, drawing a stand-in until the bytes arrive, and testing it on a phone or tablet on the LAN. Use when a Croquet publish carries user data or files, when the console says "Message with payload of N bytes exceeds maximum 16384", when adding user uploads / 画像やモデルを共有 / 自作データをオンラインで相手に見せる to a Croquet game, or when a late joiner or the other player does not see something a player made. Complements croquet-multiplayer (model/view split, Rapier, snapshots).'
---

# Sharing big data and player-made content in Croquet

Croquet replicates events, so everything a player makes (a part, a level, a picture) reaches the others only as an event payload or as bytes the model can name. Payloads are small, and whatever the model accepts must be accepted identically everywhere. This skill is about doing both right.

## The limit that decides the design

- `@croquet/croquet` refuses to send a message whose encoded payload is over **16384 bytes**. It logs `Message with payload of N bytes exceeds maximum 16384 and will not be sent` and **drops it silently**: nothing throws, and the other browsers simply never see it. Over 4096 bytes it logs once that the maximum recommended is 4096.
- The size is measured after Croquet encodes (and, with a password, encrypts) the payload, so plain JSON needs a margin.
- Count the **worst case**, not today's typical case: N pieces × the biggest piece. A design of 14 pieces that each carry a 20 KB mesh is 280 KB.

Rule of thumb: an event carries **what changed and names**; bytes go to the file server.

## The pattern: bytes on the file server, refs in the model

```
view A: bytes ──hash──▶ id "m3f75…"            design { …, mesh: "m3f75…" } ──publish──▶ model (small)
        └─ session.data.store(bytes) ─▶ handle ─ data.toId(handle) ─▶ publish 'mesh-ref' {id, ref} ─▶ model.meshRefs[id] = ref
view B: sees id in the design ─▶ model.meshRefs[id] ─▶ session.data.fetch(fromId(ref)) ─▶ check hash ─▶ draw
```

1. **Name content by its bytes** (a 64-bit hash, prefixed with a letter: `m` + 16 hex). The same bytes always get the same id, so duplicates collapse, a ref can be checked against what it fetched, and the design that names it stays tiny.
2. **The model keeps only `id → ref` strings** (`declare meshRefs: Record<string, string>`), never the bytes. The model never draws, so it needs nothing else. Refs are small, so snapshots stay small and late joiners get them.
3. **The design (or level, or part) carries only the id.** It is checked in the model like any other input (`references/model-checks.md`).
4. **Views keep the bytes** in a store: memory, then device storage, then the file server. They fetch on demand, check `hash(bytes) === id`, and bump a version counter when something arrives.
5. **Draw a stand-in until the bytes arrive** (the collision shape, a plain color, the default picture). Re-dress when the version counter moves. A ref can reach the model **after** the design that names it, so retry the lookup now and then (once a second is plenty) while something is missing.

Code for each piece: `references/file-server-blobs.md`.

## Traps this pattern has to step around

- **The view is built during `Session.join`, before `join()` resolves.** If the app keeps the session in a module variable set from `await Session.join(...)`, it is still `null` inside the view constructor, so `session.data.store` cannot be reached there. Sending the design from the constructor is fine; uploading the bytes is not. Start uploads from a hook that runs after join (the app's "changed" hook, for example) and make them idempotent.
- **Uploads belong to a session.** A file stored in one session cannot be fetched in another. Key "already uploaded" by `` `${model.sessionId}|${id}` `` and forget shared things when leaving. `View` has no `sessionId` in the TypeScript types: use `view.model.sessionId`.
- **Upload once.** Skip ids the model already has a ref for, and ids being uploaded right now. On failure, drop the "uploading" mark so a later call retries.
- **A changed model is a new session.** Croquet ties sessions to the model code, so after a change to model code an old invite link starts a fresh session. Old snapshots never meet new fields, so you do not need migrations for them. Do tell users that links from before the update start over.
- **Local copies.** Keep the bytes of things the player made in device storage (base64 in `localStorage` is fine up to a few hundred KB in total; use IndexedDB for images). Prune entries nothing refers to any more. Offline play must not depend on the file server.
- **Files carry the bytes inline.** When the player exports content to a file, put the bytes in it (base64). On import, ignore the id written in the file and **name the bytes again** from their hash. Then a file cannot claim one look and carry another.

## Checking content in the model

Anything a player made reaches the model as untrusted input, and every replica must reach the **same** verdict. See `references/model-checks.md`: rounding to fixed precision, `hasOwnProperty` for kind lookups (`'toString'` is a key of every object), regex-checked ids, caps on counts and string lengths, and deterministic eviction (object key order is insertion order **unless the key looks like an integer**, which is one more reason to prefix ids with a letter).

## Testing

- **Pure parts in vitest (node):** the file format round trip, `hash(bytes)` stability, the model-side check (accepts, rounds, rejects), and determinism (the same input gives the same output twice).
- **Two real clients:** a phone or tablet on the LAN plus a desktop browser. `references/device-testing.md` covers HTTPS on the LAN, what the agent's browser pane cannot open, iPad file pickers and downloads, and noise from Vite's hot reload in Croquet apps.
- Check that the second client sees the stand-in first and then the real content, and that a late joiner gets it too.

## Report

Tell the user what travels in events (and its worst-case size), what goes to the file server, and what the stand-in looks like. Say what was checked on two real clients and what was not.
