# Snapshots: Rapier bytes + one JSON string

Croquet snapshots the model regularly and when the session starts (it performs an "initial snapshot resume" right away, so serialization bugs show up the moment you join). Non-Model objects need `static types()` entries on a Model class.

## The trap: Croquet fills nested objects lazily

In a custom `read(data)`, only **top-level primitives** and **top-level custom-typed values** (`$class` leaves) are complete when `read` runs. Plain nested objects and arrays are pushed onto a deferred queue and filled **after** `read` returns. So a reader such as `read: s => Engine.fromState(s)` that walks `s.physics.bodies` sees empty objects. The symptom is an error like `TypeError: state.propBodies is not iterable` in "Error during initial snapshot resume".

The default serializer (`"Name": Class`, which does `Object.assign(Object.create(proto), data)`) is safe, because it only copies references that get filled in later. Only readers that *inspect* nested data break.

## The pattern that works

Write exactly two flat fields: the Rapier world, as its own typed leaf, and one JSON string holding everything else (rule values plus body and collider handles).

```ts
// engine.ts
export interface EngineSnapshot { world: RAPIER.World; rules: string }

toSnapshot(): EngineSnapshot {
  const { physics, ...rules } = this.toState();      // rule values only, no derived mirrors
  const { world, ...handles } = physics;              // handles: body/collider ids, part ledger
  return { world, rules: encodeExact({ rules, handles }) };
}
static fromSnapshot(s: EngineSnapshot) {
  const { rules, handles } = decodeExact(s.rules);
  return Engine.fromState({ ...rules, physics: { ...handles, world: s.world } }); // then syncFromBodies()
}

// JSON turns -0 into 0, which can flip later float results; keep it exact.
const encodeExact = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'number' && Object.is(x, -0) ? '\u0000-0' : x));
const decodeExact = (t: string) => JSON.parse(t, (_k, x) => (x === '\u0000-0' ? -0 : x));
```

```ts
// model.ts
static types() {
  return {
    'RAPIER.World': {                               // Microverse PhysicsManager does the same
      cls: RAPIER.World,
      write: (w: RAPIER.World) => w.takeSnapshot(),  // Uint8Array; Croquet stores typed arrays
      read: (b: Uint8Array) => RAPIER.World.restoreSnapshot(b),
    },
    Engine: { cls: Engine, write: (e: Engine) => e.toSnapshot(), read: Engine.fromSnapshot },
    CpuController: {
      cls: CpuController,
      write: (c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'rng')),
      read: (d) => Object.assign(Object.create(CpuController.prototype), d, { rng: () => Math.random() }),
    },
  };
}
```

## What goes where

- **Rapier bytes**: everything physical — poses, velocities, contacts, sleep state, `timestep`, gravity, gravity scales, additional mass, and any debris bodies. Checked: `restoreSnapshot` keeps `timestep`, and after a restore the next steps are bit-identical.
- **JSON**: phase, scores, timers, boost gauges, seats and inputs (if they live on the engine), handles and ledgers.
- **Nowhere**: derived mirrors (x/y/z/q copied from the bodies, which are rebuilt by `syncFromBodies()` after a restore), the `EventQueue` (recreate it lazily in a `$queue` field), and caches.

## Test it like a late joiner

```ts
cloneViaSnapshot() {
  const { world, rules } = this.toSnapshot();
  return Engine.fromSnapshot({ rules, world: RAPIER.World.restoreSnapshot(world.takeSnapshot()) });
}
// test: run A 2s → B = A.cloneViaSnapshot() → run both 3s with the same inputs → bytes equal
```
