---
name: croquet-reflector-selfhost
license: MIT
description: "Self-host a Croquet reflector (croquet/croquet, the `files` branch with local file storage) on an existing Linux server that already runs nginx and other apps, without Docker: a sandboxed systemd service, a fixed-size disk image for snapshots, nginx locations for the WebSocket, the file store and static apps, a pinned upstream commit with local patches, daily cleanup, and verification with headless clients. Use this whenever the user wants to run their own reflector / Croquet-in-a-Box / 'reflector を自前で動かしたい' / 'サーバーに立てたい' / 'Croquet サーバーを運用', move off the Multisynq network, put a reflector behind an existing nginx or on a shared server, or harden, update, clean up, reboot-test or troubleshoot such a deployment."
---

# Self-hosting a Croquet reflector on a shared Linux server

The `files` branch of [croquet/croquet](https://github.com/croquet/croquet) can run the reflector standalone (`--standalone --storage=file`): no API key check, and snapshots and persistent data are stored on the local disk instead of a cloud bucket. Its README assumes Docker (Croquet-in-a-Box). On a server that already hosts other apps, a plain Node process under systemd behind the existing nginx is usually the better fit.

Target layout (paths are examples; keep them under one prefix):

```
https://<host>/croquet/
  ├─ apps/       static apps                  /srv/croquet/www/
  ├─ reflector/  WebSocket only               127.0.0.1:9090  (systemd: croquet-reflector)
  └─ files/      GET/PUT, CORS, no execution  /var/lib/croquet/files  (fixed-size image)
```

A client derives both URLs from one setting: `box: 'https://<host>/croquet/'` (or `box: '/croquet/'` for apps served from the same host), `apiKey: 'none'`.

## Workflow

1. **Survey the server read-only before designing** (`references/operations.md` → Survey). CPU, memory and swap, free space on `/` and what shares it, whether Docker exists, Node version, nginx version and modules (`dav` is needed for PUT), how existing apps are split (paths vs. subdomains, certificates), firewall policy, `worker_connections`, and the process managers already in use (pm2 per user, systemd).
2. **Ask the decisions that are the user's.** Do not guess these:
   - who may connect (the whole internet, or a campus/VPN range);
   - where the apps are served from (this host, other hosts, or both). Other hosts need CORS on the file store;
   - whether the deployment config is shared with other staff (then keep it in a private Git repo and apply it with a script; do not let CI hold sudo keys);
   - the disk budget for snapshots and the retention period.
3. **Pin the upstream.** Pin the reflector by commit SHA in an `UPSTREAM_COMMIT` file. Do not fork it. Check what other branches add before picking one; `files-with-existing-webserver`, for example, was only an older point of `files`. Use `files` at `2070310` or later: earlier commits do not validate JOIN arguments, so a single malformed JOIN can stop the whole reflector, and `appId` / `persistentId` / `developerId` containing `../` can reach outside the file store (fixed upstream in croquet/croquet#12). Keep local fixes as `patches/*.patch`; the install script applies them and stops without restarting the service if any patch no longer applies.
4. **Read the reflector before exposing it.** It is unauthenticated server code that writes files for anyone who connects. Review it as you would any internet-facing service before trusting it. Fix what you find in `patches/`, and confine the process anyway (step 5). Report real vulnerabilities to upstream privately, not in a public issue or a public repo. Once the maintainers have published the fix, offer the same patch as a pull request to the default branch (`dev`); they welcome contributors. If they already committed the fix themselves, branch from the parent of their commit so that the PR still has a commit to merge, and ask for a normal merge rather than a squash.
5. **Install** (`references/systemd-install.md`): a dedicated system user, a loopback ext4 image for the data, a hardened unit, a journald namespace, and an idempotent `install.sh` with a `--check` mode.
6. **Wire nginx** (`references/nginx.md`): include one file from the existing TLS server block, run `nginx -t`, then `reload` (never `restart` a shared nginx).
7. **Verify** with real clients and abuse cases (`references/operations.md` → Verification). Use `scripts/verify-client.js` for headless clients and `scripts/bad-join.js` for malformed JOINs.
8. **Enable cleanup** only after looking at the real file layout and a dry run (`scripts/croquet-cleanup.sh`).
9. **Reboot test** at a time agreed with the people who run the other apps (`references/operations.md` → Reboot test).

## Why not Docker or pm2 on a shared server

- Docker needs disk and memory the server may not have. Its published ports bypass `ufw`, and Croquet-in-a-Box wants ports 80/443, which the existing nginx already holds.
- Running the reflector under an admin user's pm2 gives the internet-facing process that user's rights (often including sudo-capable files). A new pm2 daemon also costs about 50 MB. systemd adds no daemon and provides sandboxing and memory limits.

## Risks to contain

| Risk | Containment |
|---|---|
| Anyone can PUT to the file store; a full disk stops every app on `/` | Fixed-size loopback image for both the files and nginx's PUT temp dir; `client_max_body_size`; PUT rate limit |
| Uploaded HTML/JS served from the same origin as other apps | File store returns everything as `application/octet-stream` with `CSP: sandbox` and `nosniff`, and no directory listing |
| Monitoring endpoints (`/metrics`, `/sessions`, `/users/*`) are unauthenticated | Proxy only requests with `Upgrade: websocket` to the reflector; 404 everything else |
| The reflector listens on all interfaces | `IPAddressDeny=any` + `IPAddressAllow=localhost` in the unit, besides the firewall |
| An internet-facing process writes files on behalf of anonymous clients | Run as its own user with `ProtectSystem=strict`, write access to the data dir only, other app dirs invisible |
| Session records (`*.json`) are written by the reflector itself | Deny `*.json` over HTTP so they cannot be overwritten. Known snapshot paths can still be overwritten by anyone, so the store is not for important data |
| Data grows forever (upstream does not delete snapshots) | Daily cleanup timer that keeps persistent data |
| Log level is fixed at debug (`LOG_LEVEL` is ignored) and logs contain IP addresses | Own journald namespace with a size and age cap |
| Connection exhaustion of the shared nginx (a WebSocket uses two connections) | `limit_conn` per IP and in total |
| Apps under `/croquet/apps/` share the origin with the other apps | Only put reviewed apps there; note that CDN imports run in that origin too |

## Client side

- `@croquet/croquet` 2.0.0 or later. The `box` URL ends with `/`; use `apiKey: 'none'`.
- `appId` must be dotted (`org.example.app`).
- Background tabs go dormant ("Going dormant"); this is Croquet's design, not an outage. Test with visible windows or headless clients.
- On the first join of a new session the reflector logs `fetch-latest-failed` and `fetch-saved-failed` (ENOENT) at error level. That is expected.

## Report

Tell the user:
- the URLs and the exact `Session.join()` settings for apps on this host and on other hosts;
- what was changed outside the deployment (the one `include` line, a `conf.d` file, `/etc/fstab`) and how to roll each back;
- what was verified (sync, late join, resume after all leave, resume after a reflector restart, persisted data, CORS, limits, full disk, reboot) and what was not;
- the remaining risks: no authentication, overwritable snapshots, the shared origin of `/apps/`, and the operational load (updating the pinned commit means re-checking the patches).
