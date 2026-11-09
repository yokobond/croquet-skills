# Rapier inside the model (arcade feel on top of rigid bodies)

Package: `@dimforge/rapier3d-compat`. The WASM is inlined, so it works in Vite and in vitest/node. Call `await RAPIER.init()` once, before creating any world and before `Session.join` (Microverse's `asyncStart`). In the app, render only after it resolves.

## PhysicsWorld wrapper (src/game/physics.ts)

- `new RAPIER.World({x:0, y:-g, z:0})` and `world.timestep = FIXED_STEP`.
- Keep **handles**, not body objects. Get bodies with `world.getRigidBody(handle)`; that call is cheap. Any cache must live in a `$` field.
- Keep `colliders: Map<handle, {kind, owner?, part?, prop?}>`, so that collision events can be turned into game meaning (car/mug/books/floor/prop/debris).
- Collision groups are `(membership << 16) | filter`. To make a respawning "ghost" pass through its rival, change only the ghost's filter. An interaction needs both sides to accept it.
- `EventQueue(true)` → `world.step(queue)` → `drainCollisionEvents((h1, h2, started) => …)` and `drainContactForceEvents(e => e.totalForceMagnitude())`.
- Kill plane: a big floor collider below the scene, plus a reset for anything that falls further. Bodies that go to infinity break Rapier.

## Keeping a hand-tuned arcade feel

Rewriting a tuned game as "pure physics" loses its feel. Keep the old velocity-space math and let Rapier do the contacts:

- Grounded: cast rays down from the wheel positions (`world.castRay(new RAPIER.Ray(o, {x:0,y:-1,z:0}), maxToi, true, QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, ownBody)`). Count the car as grounded when at least 2 rays hit.
- When grounded: compute forward and lateral speed from `linvel` and the heading, apply the old acceleration, drag and grip, then `setLinvel` (keep `vy`). Set the yaw rate with `setAngvel({x: w.x, y: yaw, z: w.z})`. Rotate the velocity by `yaw*dt` so it follows the nose, as the arcade model did.
- Wheel colliders with `friction 0` (the code supplies the grip) and a low centre of mass. Use `setAdditionalMass` for temporary mass, such as boost.
- Hit strength: record each car's velocity **before** `world.step`. After the step, contact resolution has already changed the velocities, so read impact strength from the pre-step copy, also for "hit the floor hard" events.
- Arcade extras (knockback, bumper kick, hit stun) go in collision-start handlers on top of the solver's result.
- Self-righting: if the car is upside down and nearly still on the table for about 0.7 s, set it back on its wheels.

## Parts that can break off later

- Build the car as one chassis body with a **compound collider**, one collider per part (`CAR_PARTS`: shape, offset, mass, `breakImpulse: Infinity`).
- Keep a ledger: `{owner, partId, colliderHandle, bodyHandle, attached}`.
- `detachPart(handle, impulse)`: read the collider's world pose, the chassis `linvel` and the `angvel × r` at that point. Then `removeCollider`, and create a dynamic body with the same shape, pose and velocity. Update the ledger.
- `rebuildCar(owner, pose)`: remove the debris bodies and the chassis, then create a complete car. Use it for respawning, so detached parts come back.
- Turn on `ActiveEvents.CONTACT_FORCE_EVENTS` with a threshold now, and compare `force*dt > breakImpulse`. Breaking parts then needs only data changes later.
- In the view, give every part its own entity whose origin is the car origin. Attached parts stay at identity. A detached part gets `inverse(rootWorld) * partWorld * T(-offset)`, so the rendering needs no change when parts start breaking.

## Mirrors for AI and views

After each step, copy pose and velocity from the bodies into plain objects (x, y, z, vx…, qx…qw, heading = atan2 of the flattened forward vector). Code that used to write `car.x = …` (tests, tools) now goes through `placeCar(id, {x, z, heading, vx…})`, which sets the body and resyncs.
