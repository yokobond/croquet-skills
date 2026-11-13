// Send malformed JOINs to a reflector and print the close code of each (4100 = BAD_PROTOCOL expected).
//   npm i ws   (in the directory you run this from)
//   REFLECTOR=wss://<host>/croquet/reflector/v1/ node bad-join.js
// Only run it against a build that has the JOIN validation, or it stops the reflector.
const { createRequire } = require("node:module");
const WebSocket = createRequire(process.cwd() + "/")("ws");
const crypto = require("node:crypto");
const base = process.env.REFLECTOR;
if (!base) { console.error("set REFLECTOR, e.g. REFLECTOR=wss://example.org/croquet/reflector/v1/"); process.exit(1); }
const cases = {
    "no-ticks": { version: 1, name: "x" },
    "null-args": null,
    "dotdot-appId": { version: 1, name: "x", ticks: { tick: 1000 }, appId: "../../x", persistentId: "p" },
    "dotdot-persistentId": { version: 1, name: "x", ticks: { tick: 1000 }, appId: "a.b", persistentId: "../../p" },
};
(async () => {
    for (const [label, args] of Object.entries(cases)) {
        const id = crypto.randomBytes(32).toString("base64url");
        const code = await new Promise(resolve => {
            const ws = new WebSocket(base + id);
            const t = setTimeout(() => { ws.terminate(); resolve("timeout"); }, 10000);
            ws.on("open", () => ws.send(JSON.stringify({ action: "JOIN", args })));
            ws.on("close", c => { clearTimeout(t); resolve(c); });
            ws.on("error", e => { clearTimeout(t); resolve("error " + e.message); });
        });
        console.log(label, code);
    }
})();
