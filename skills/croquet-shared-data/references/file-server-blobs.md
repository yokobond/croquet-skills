# Bytes on the file server, refs in the model

Worked example: STL meshes for player-made car parts in a Croquet game (tabletop-rc-arena: `src/runtime/meshStore.ts`, `src/net/model.ts`, `src/net/session.ts`, `src/aframe/components.ts`). Rename `mesh` to whatever your content is.

## Session helpers (view side)

The Croquet data API is on the session object, not on the view.

```ts
// session.ts
let session: Croquet.CroquetSession<MyView> | null = null;   // set after `await Session.join(...)`
export const currentView = () => session?.view ?? null;

export async function storeData(data: ArrayBuffer) {
  if (!session) throw new Error('not online');
  return session.data.toId(await session.data.store(data));  // a string the model can keep
}
export async function fetchData(ref: string) {
  if (!session) throw new Error('not online');
  return session.data.fetch(session.data.fromId(ref));       // ArrayBuffer
}

export const hooks = {
  design: (): Design | null => null,
  shareBlobs: (_d: Design | null) => {},   // filled in by the app: avoids an import cycle
  changed: () => {},
};

export class MyView extends Croquet.View {
  constructor(model: MyModel) {
    super(model);
    this.sendDesign(hooks.design());       // fine: publish works in the constructor
  }
  sendDesign(design: Design | null) {
    this.publish(SCOPE, 'design', { viewId: this.viewId, design });
    hooks.shareBlobs(design);              // a no-op here while `session` is still null…
  }
  sendMeshRef(id: string, ref: string) {
    this.publish(SCOPE, 'mesh-ref', { id, ref });
  }
}
// …so the app also calls shareBlobs(design) from hooks.changed, which runs after join resolves.
```

## Model side

```ts
const MESH_ID = /^m[0-9a-f]{16}$/;
const MAX_REFS = 256;

declare meshRefs: Record<string, string>;
init() {
  this.meshRefs = {};
  this.subscribe(SCOPE, 'mesh-ref', this.onMeshRef);
}
onMeshRef(msg: { id: unknown; ref: unknown }) {
  if (!msg || typeof msg.id !== 'string' || !MESH_ID.test(msg.id)) return;
  if (typeof msg.ref !== 'string' || !msg.ref || msg.ref.length > 2048) return;
  if (this.meshRefs[msg.id]) return;                  // first one wins, everywhere
  const ids = Object.keys(this.meshRefs);             // insertion order: ids start with a letter
  if (ids.length >= MAX_REFS) delete this.meshRefs[ids[0]];
  this.meshRefs[msg.id] = msg.ref;
}
```

The design that names the mesh is checked separately (`model-checks.md`). The model only validates that the id is well formed. It never fetches or decodes bytes.

## The view-side store

```ts
const bytesById = new Map<string, Uint8Array>();
const decoded = new Map<string, Look>();
const fetching = new Set<string>();
const uploaded = new Set<string>();       // `${sessionId}|${id}`
let version = 0;
export const blobVersion = () => version;

export function addBlob(bytes: Uint8Array) {          // made on this device
  const id = idOf(bytes);                             // 'm' + 64-bit hash, hex
  if (!bytesById.has(id)) bytesById.set(id, bytes);
  return id;
}
export function keepBlob(id: string) { /* write base64 to localStorage; false if it would not fit */ }

export function lookFor(id: string): Look | null {     // null: draw the stand-in
  const known = decoded.get(id);
  if (known) return known;
  const bytes = bytesById.get(id) ?? fromLocalStorage(id);
  const look = bytes && decode(bytes);
  if (look) { decoded.set(id, look); return look; }
  if (!bytes) fetchShared(id);
  return null;
}

function fetchShared(id: string) {
  const ref = currentView()?.model.meshRefs?.[id];
  if (!ref || fetching.has(id)) return;
  fetching.add(id);
  fetchData(ref)
    .then((data) => {
      const bytes = new Uint8Array(data);
      if (idOf(bytes) !== id || !decode(bytes)) throw new Error(`blob ${id} does not match`);
      bytesById.set(id, bytes);
      version++;
    })
    .catch(console.error)
    .finally(() => fetching.delete(id));
}

export function shareBlobs(design: Design | null) {
  const view = currentView();
  if (!view) return;                                  // not joined yet: hooks.changed will call again
  for (const id of new Set(idsIn(design))) {
    const key = `${view.model.sessionId}|${id}`;
    if (view.model.meshRefs?.[id] || uploaded.has(key)) continue;
    const bytes = bytesById.get(id) ?? fromLocalStorage(id);
    if (!bytes) continue;
    uploaded.add(key);
    storeData(bytes.slice().buffer)                   // slice: a view's buffer may be bigger than the view
      .then((ref) => currentView()?.sendMeshRef(id, ref))
      .catch((err) => { console.error(err); uploaded.delete(key); });
  }
}
```

The hash does not need to be cryptographic, because it is a content name and the model does not trust it for anything. A two-lane 32-bit mix (cyrb53 style, 64 bits out) is quick and stable across browsers. Unit-test that it is the same twice and differs after flipping one byte.

## Re-dressing when bytes arrive (render component)

```ts
dress(design) {
  // …build meshes; lookFor() returns null for missing ones and a stand-in is built instead
  this.waiting = idsIn(design).filter((id) => !lookFor(id));
  this.seen = blobVersion();
  this.poll = 0;
}
tick(_t, dtMs) {
  const design = engine.designs[this.player];
  if (design !== this.design || (this.waiting.length && blobVersion() !== this.seen)) this.dress(design);
  else if (this.waiting.length && (this.poll += dtMs / 1000) > 1) {
    this.poll = 0;
    for (const id of this.waiting) lookFor(id);       // the ref may have reached the model by now
  }
}
```

Cache decoded geometries by id, but evict them (keep the latest few dozen) if an editor makes a new one at every slider step.
