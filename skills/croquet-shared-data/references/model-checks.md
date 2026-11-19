# Checking player-made content inside the model

Every replica runs the check, so it must be a pure function of the payload: no `Date`, no locale, no randomness, no async, and no decoding of bytes the model does not have. Write it as one `read…(raw: unknown): T | null` per kind of content, and call the same function wherever the content comes from outside: the model's event handler, device storage, imported files. The check in storage and files is the same code, so a bad saved item can never get into a session.

## Checklist

- **Type every field from `unknown`.** Use `typeof v === 'number' && Number.isFinite(v)`, and test arrays for their length and every element.
- **Round numbers to the precision the game works in** before anything uses them (`Math.round(v * 10000) / 10000 + 0` for 0.1 mm; the `+ 0` turns `-0` into `0`). Then the same design gives bit-identical physics, and two "equal" designs compare equal with `JSON.stringify`.
- **Check limits, then clamp or refuse.** Refuse a value that is out of range, rather than silently clamping it, when the player would not expect it to change. Clamp when it is a free choice: for example, an angle rounded to whole degrees within ±180.
- **Look kinds up with `Object.prototype.hasOwnProperty.call(TABLE, kind)`**, not `TABLE[kind]` or `kind in TABLE`. Otherwise `'toString'`, `'constructor'` and `'__proto__'` pass. Write a test for `kind: 'toString'`.
- **Check ids with a regex** (`/^m[0-9a-f]{16}$/`). Cap string lengths (names, refs) and counts (pieces, joints, refs).
- **Trim names and cut them by length** after trimming. Normalise colours (`/^#[0-9a-fA-F]{6}$/`, then upper case).
- **Drop fields that do not apply** (a tilt on a ball, a "lying" flag on a box). Do not carry them around; they make equal things look different.
- **Give optional fields a clear default** and write them only when they are not the default, so that old saves and new saves compare equal.

## Deterministic bookkeeping

- **Eviction order:** `Object.keys()` lists integer-like keys in numeric order first, then string keys in insertion order. Ids that start with a letter keep "oldest first" true. A `Map` is also fine in model state; Croquet snapshots it.
- **"First one wins"** for things several views may send at once (two players uploading the same bytes): ignore a second ref for an id that already has one. Every replica sees the same order, so they keep the same one.
- **Compare by value** (`JSON.stringify(a) !== JSON.stringify(b)`) before replacing derived state such as a car's design, so a re-sent design does not rebuild physics.

## What the view may trust after the model

Only what the model kept. A view that holds the bytes still checks them against the id (`hash(bytes) === id`) and decodes them defensively (lengths, index bounds). The model never saw the bytes, and a broken upload must not crash anybody's renderer.
