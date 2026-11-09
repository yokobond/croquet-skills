---
name: croquet-multiplayer
license: MIT
description: "Turn a single-player browser game or app (A-Frame, three.js, canvas, React) into a real-time multiplayer one with Croquet replicated computation, Microverse-style: the shared state runs as a Croquet Model on every client, physics runs inside the model with Rapier (WASM, bit-identical) and is snapshotted with world.takeSnapshot(), and the view only sends inputs and renders. Use this whenever the user wants to make something multiplayer / online / shared / 'マルチプレイヤー対応' / 'オンライン対戦' / 'みんなで遊べる', mentions Croquet, Multisynq, Croquet-in-a-Box, reflector, Renkon/Croquetify, Microverse, or wants deterministic physics that syncs across browsers — even if they do not name Croquet."
---

# Croquet multiplayer (Microverse style, Rapier physics)

The idea (Ohshima et al., "Croquetify", Onward! '26; Croquet; Microverse): instead of a game server, a tiny **reflector** timestamps every view event and sends it to all clients in the same order. Every client runs the **same model code**, so the state transitions **bit-identically** everywhere. Late joiners load a **snapshot** and replay the events since. You write no server code.

Target layout:

```
[View (each browser)]  render / audio / input / HUD        ── reads the model, never writes it
     │ publish: input, start, pause, rules…                ▲ model publishes events locally
     ▼                                                     │ (sounds, sparks, banners)
[Reflector] ── timestamps, same order for everyone ──▶ [Model (replicated)]
                                                        SessionModel (seats, rules, pause)
                                                         └ Engine (game rules)
                                                            └ PhysicsWorld (Rapier World)
```

Keep **one** engine for single-player and online: the local mode steps the same engine from the render loop, the online mode steps it from the model's `future()` loop.

## Workflow

1. **Read the app first.** Find the simulation, the loop that steps it, every place the view reads its state, and where input is read. A DOM-free engine with `step(dt, inputs)` is the ideal split. If logic and rendering are mixed, separate them first.
2. **Ask the decisions that are really the user's:** which reflector (`box:` URL for Croquet-in-a-Box needs no API key; the Multisynq network needs one), how many drivers vs spectators, what an empty seat does (CPU or idle), and whether to keep or replace the physics. Do not guess these.
3. **Physics → Rapier in the model** (`references/physics-rapier.md`). Rapier is the source of truth for all bodies. JS objects only mirror it after each step.
4. **Snapshot = Rapier bytes + one JSON string** (`references/snapshot.md`). This is the part that breaks most easily; read it.
5. **Croquet model, view and session** (`references/croquet-model-view.md`).
6. **Wire the app**: a `getEngine()` that returns the model's engine while online; route start / pause / rules to `view.publish` while online; the render loop sends input instead of stepping; smooth pawns.
7. **Tests before the browser** (vitest, node). `@dimforge/rapier3d-compat` works in node.
   - Determinism: two engines, the same scripted inputs → `takeSnapshot()` bytes are equal.
   - Snapshot: restore a clone mid-run, run both on, bytes are equal.
   - Gameplay regressions with tolerances retuned for the new physics.
8. **Verify with two live clients** (below), then build.

## Rules that keep replicas identical

- The model may only read its own state and the events it receives: no `Date`, no `window`, no DOM, no async, no `performance.now()`. `Math.random()` inside the model is replicated by Croquet. Call it through a closure, `() => Math.random()`, not a stored reference.
- Never store functions in model state (they cannot be snapshotted). Example: a CPU controller with an `rng` field needs a custom `types()` serializer that drops it and adds it back on read.
- In `Croquet.Model` subclasses, declare fields with TypeScript `declare` and set them in `init()`. Field initialisers and constructors break restore.
- Fixed step only. Use `future(1000/60).tick()` and run N fixed substeps per tick. Never use the frame `dt`.
- Event payloads from views must carry the `viewId` (Croquet does not add the sender), and the model must validate and clamp them.
- Seats: assign on `view-join`, free on `view-exit`, hand the seat to a waiting spectator, and let an empty seat run CPU **inside the model** so it stays replicated.
- Model → view events: publish the engine's drained events once per tick. In the view, ignore them until the `synced` event is true, so a late joiner does not replay minutes of sounds.

## Verification that actually catches problems

- **Two clients that are both visible.** Background tabs stop `requestAnimationFrame`, and Croquet's `autoSleep` drops them after a few seconds (their seat frees up). Two tabs in the same browser pane are therefore not a real test. Use the in-app browser for client A and the Playwright browser (or another window) for client B.
- Drive both cars at the same time, pause (pause is shared), then hash `engine.physics.takeSnapshot()` in both clients. The hashes must be equal. Also test a late join while a match is running.
- When debugging from the console in Vite dev, import the module by the **exact URL the app loaded**, including the `?t=` stamp (take it from `performance.getEntriesByType('resource')`). A bare `import('/src/x.ts')` creates a second module instance. That instance can overwrite global handlers (keyboard capture, hooks) and fake bugs.
- The console tool keeps history across reloads. Log a marker before reading errors, or the stale errors will mislead you.
- Finally run `npm run build`, and if the app is deployed, check the deployed build too. A production build can fail where dev did not: for example, the camera became NaN on a cold load because the canvas aspect ratio was briefly 0.

## Report

Tell the user:
- what is replicated and what stays local;
- how a snapshot is made;
- how the two clients were verified, including the hash values;
- the limits: verified browser engines only (for example Chromium-only), input latency equals the round trip to the reflector, the bundle size increase from Rapier, and that sleeping tabs lose their seat.
