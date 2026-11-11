// Headless Croquet client for checking a self-hosted reflector.
//   npm i @croquet/croquet ws   (in the directory you run this from)
//   BOX=https://<host>/croquet/ node verify-client.js <tag> <sessionName> <password> <codeVersion> <seconds> [save]
// Prints "joined n=… restored=…" and, when it leaves, "before-leave n=…".
// A client that joins after everyone left should start near the last n (the snapshot was resumed).
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/");

const BOX = process.env.BOX;
if (!BOX) { console.error("set BOX, e.g. BOX=https://example.org/croquet/"); process.exit(1); }
// the client library reads window.location; it must have the origin of the box
globalThis.window = { location: new URL(BOX).origin + "/" };
const Croquet = req("@croquet/croquet");

const [, , tag, name, password, variant, secs, doSave] = process.argv;
// changing the code version gives a new session for the same name, which restores persisted data
Croquet.Constants.VARIANT = variant;
setTimeout(() => { console.log(tag, "WATCHDOG exit"); process.exit(2); }, (+secs + 25) * 1000);

class M extends Croquet.Model {
    init(options, persisted) {
        this.n = persisted ? persisted.n : 0;
        this.restored = !!persisted;
        this.subscribe("m", "save", this.save);
        this.loop();
    }
    save() { this.persistSession(() => ({ n: this.n })); }
    loop() {
        // burn some CPU so that the client takes and uploads snapshots
        let x = 0; for (let i = 0; i < 2e7; i++) x += i % 7; this.x = x;
        this.n++;
        this.future(50).loop();
    }
}
M.register("M");

class V extends Croquet.View {
    constructor(m) {
        super(m);
        console.log(tag, "joined n=", m.n, "restored=", m.restored);
        if (doSave) setTimeout(() => this.publish("m", "save"), secs * 500);
        setTimeout(() => { console.log(tag, "before-leave n=", m.n); process.exit(0); }, secs * 1000);
    }
}

Croquet.Session.join({
    box: BOX, apiKey: "none", appId: "org.example.reflector.verify",
    name, password, model: M, view: V,
    step: "manual", // no requestAnimationFrame in node
})
    .then(session => setInterval(() => session.step(), 30))
    .catch(e => { console.log(tag, "ERR", e.message); process.exit(1); });
