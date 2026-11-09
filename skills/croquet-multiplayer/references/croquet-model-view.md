# Croquet model, view and session

Package: `@croquet/croquet` (2.x). Its `browser` field resolves in Vite without an alias. The Croquet-in-a-Box join looks like this (no API key):

```ts
session = await Croquet.Session.join({
  box: 'https://<host>/croquet/',      // = reflector <box>reflector + files <box>files; absolute works cross-origin
  apiKey: 'none',
  appId: 'jp.example.my-app',
  name: await Croquet.App.autoSession(),     // ?q=… in the URL
  password: await Croquet.App.autoPassword(), // #pw=… (end-to-end key; never hard-code it)
  model: SessionModel, view: SessionView,
  tps: 60,                                     // reflector ticks/s; the default 20 makes motion choppy
});
```

Before you rely on a box, check it from a shell: `curl -I` on `<box>files/x` with an `Origin` header should return CORS `*`, and a WebSocket upgrade to `<box>reflector/` should return `101`.

## Model

```ts
export class SessionModel extends Croquet.Model {
  declare engine: Engine; declare seats: Record<PlayerId, string | null>;
  declare inputs: Record<PlayerId, Input>; declare viewers: string[]; declare paused: boolean;
  static types() { /* see snapshot.md */ }
  init() {
    this.engine = new Engine(); this.seats = { p1: null, p2: null }; /* … */
    this.subscribe(this.sessionId, 'view-join', this.viewJoined);
    this.subscribe(this.sessionId, 'view-exit', this.viewExited);
    this.subscribe('game', 'input', this.onInput);   // {viewId, throttle, steer, boost}
    this.subscribe('game', 'start', this.onStart);   // also: pause, title, rules
    this.future(1000 / 60).tick();
  }
  tick() {
    if (!this.paused) {
      for (let i = 0; i < SUBSTEPS; i++) this.engine.step(FIXED_STEP, this.collectInputs()); // CPU for empty seats
      const ev = this.engine.drainEvents();
      if (ev.length) this.publish('game', 'events', ev);
    }
    this.future(1000 / 60).tick();
  }
}
SessionModel.register('SessionModel');
```

## View

```ts
export class SessionView extends Croquet.View {
  synced = false;
  constructor(public model: SessionModel) {
    super(model);
    this.subscribe('game', 'events', (ev) => this.synced && hooks.events(ev));
    this.subscribe(this.viewId, 'synced', (s: boolean) => { this.synced = s; hooks.changed(); });
  }
  get seat() { return this.model.seatOf(this.viewId); }
  sendInput(i: Input) { this.publish('game', 'input', { viewId: this.viewId, ...i }); }
}
```

- Croquet may tear down and rebuild the root view after a reconnect, so always ask `session.view` for it. Never cache the view object.
- Avoid import cycles (store → session → view → store) with a small `hooks` object that the app fills in.

## App wiring

- `getEngine()` returns `currentModel()?.engine` while online, and the local engine otherwise. Replace every direct `engine.` reference in the view code with it.
- In the render loop, while online: do not step. If this client has a seat and is synced, read the local input and send it **on change** (at most 30/s) plus a 1 s keep-alive. Mirror the model into the UI store about 20 times a second, even when idle or paused.
- Start, pause, back-to-title and rule changes call `view.publish` while online. Camera and sound stay local.
- Pawn smoothing (Microverse `PM_Smoothed`): lerp the position and slerp the quaternion toward the model pose at about 0.45 per frame, and snap when the distance is over about 0.5 (respawns).
- UI: an "online" button, the invite URL with a copy button, the seat label (1P / 2P / spectator), a player count and a leave button. Auto-join when the page URL already has `?q=`. Do not pause on `visibilitychange` while online. Show "YOU" or "CPU" in the HUD names.
- `leave()` should also strip `?q` and `#pw` with `history.replaceState`, so a reload starts offline.
