# Survey, verification, cleanup and reboot test

## Survey (read-only)

```bash
nproc; free -m; df -h / /boot; swapon --show
node -v; command -v docker
nginx -V 2>&1 | tr ' ' '\n' | grep -E 'dav|version'
grep -R "server_name\|listen\|include" /etc/nginx/sites-enabled/
grep worker_connections /etc/nginx/nginx.conf
sudo ufw status
ss -ltn
systemctl list-units --type=service --state=running --no-legend
ps -eo user,rss,cmd | grep -E "PM2|node|python|next" | grep -v grep
```

Write down what the plan depends on: free space on `/` (and who else uses it, e.g. MySQL), spare memory, which ports are public, and how the other apps are started.

## File layout (`--storage=file`)

Observed under `FILES_MOUNT_PATH`:

```
<sessionId>/latest.json, <sessionId>/*.json                session records (reflector)
apps/<appId>/snap/<codeHash>/<persistentId>.<sessionId>/   snapshots
snapshots/<sessionId>/                                     snapshots of clients without an API key
apps/<appId>/<persistentId>/save/<hash>                    persistent data (persistSession)
reflector/u/<developerId>/<appId>/<persistentId>/saved.json   pointer to persistent data
dispatcher/testing/<sessionId>.json                        session registration
```

Session ids are base64url (about 43 characters), not hex. Look at the real tree before writing cleanup rules.

## Cleanup

`scripts/croquet-cleanup.sh` (dry run by default, `--apply` deletes):
- deletes a snapshot dir only when neither it nor its session's records changed within the retention period, so a snapshot that `latest.json` still points to is kept;
- keeps `apps/*/*/save` and `reflector/` (persistent data);
- deletes stale files anywhere else, because anyone can PUT anything;
- removes old PUT temp files and empty dirs, and warns at 80 % usage.

Override the paths and retention with `CROQUET_FILES`, `CROQUET_TMP` and `CROQUET_RETENTION_DAYS`.

## Verification

Headless clients are the reliable test. A browser tab in the background goes dormant, and an in-app browser pane that is hidden counts as a background tab. Install the client library once in a scratch dir (`npm i @croquet/croquet ws`), then use `scripts/verify-client.js`:

```bash
export BOX=https://<host>/croquet/
# A and B in the same session, A stays longer
node verify-client.js A s1 pw v1 30 & node verify-client.js B s1 pw v1 20 & wait
sleep 15          # everyone has left; the session must resume from the snapshot
node verify-client.js C s1 pw v1 10        # expect "joined n=" close to A's last n
node verify-client.js D s2 pw v1 20 save   # persistSession
node verify-client.js E s2 pw v2 10        # new code version: expect restored=true
```

Checklist:

- [ ] A and B see the same `n`. C joins with `n` close to A's `before-leave`, which shows the snapshot was uploaded and the session resumed.
- [ ] After `systemctl restart croquet-reflector`, a client resumes the session.
- [ ] Persisted data: a new code version (`v2`) starts with `restored=true`.
- [ ] Apps on another host: the browser console shows no CORS errors on PUT/GET of `/files/`.
- [ ] `:9090` is unreachable from outside, over IPv4 and IPv6 (`nc -z host 9090` fails, `:443` succeeds).
- [ ] `/croquet/reflector/metrics` and `/croquet/reflector/sessions` return 404, and `*.json` under `/files/` returns 403.
- [ ] An `.html` PUT to `/files/` comes back as `application/octet-stream` with `CSP: sandbox`.
- [ ] A 21 MB PUT returns 413, and a burst of PUTs is rate limited.
- [ ] Malformed JOINs are rejected: `REFLECTOR=wss://<host>/croquet/reflector/v1/ node bad-join.js` prints `4100` for every case, and `systemctl show -p NRestarts croquet-reflector` stays at 0. **Confirm that the running build has the fix (`files` at `2070310` or later, or your patch) before you send bad input**, or you take the production reflector down. `reject-join` appears in the log for each rejected JOIN (except `null-args`, which the version check closes without logging).
- [ ] Full disk: fill the image with a file (`fallocate -l <free> /var/lib/croquet/files/zz-fill`). PUT then returns 500, while `/` and the other apps keep working. The reflector must survive. Delete the file afterwards.
- [ ] The other apps on the host answer exactly as before (record their HTTP codes before you change nginx).
- [ ] After about an hour of real use, check the memory (`MemoryCurrent`) and the journal size (`journalctl --namespace=croquet --disk-usage`), then adjust the limits.

Note: when the file store is full, the Node client from `verify-client.js` crashes on the failed snapshot upload. Browser behaviour in that case has not been checked.

## Reboot test

It stops every app on the host. Agree on the time first.

Before:
- `uptime` and `/var/run/reboot-required.pkgs`. A long uptime means that a reboot also boots a new kernel and libc. Make sure an older kernel stays installed and someone has console access (`GRUB_TIMEOUT=0` hides the menu).
- For every user's pm2: the saved `dump.pm2` must list the same apps as `pm2 jlist`. An app started but never `pm2 save`d will not come back. Print only names and status, because dumps contain environment variables.
- `systemctl list-unit-files --state=enabled` covers nginx, the database, `pm2-<user>`, `croquet-reflector` and the timer.
- `nginx -t`, `findmnt --verify`, `install.sh --check`.
- Record the HTTP status of every app path.

After:
- `systemctl --failed` is empty. `uname -r` shows the expected kernel. `findmnt /var/lib/croquet` shows the image with the expected options and the data is still there.
- Each pm2 app process is running. Every app path returns the same status as before.
- `systemctl list-timers croquet-cleanup.timer`, `ufw status`, the `:9090` check from outside.
- Run headless clients again (sync + resume). `NRestarts=0`.

## Updating upstream

1. Read `https://github.com/croquet/croquet/compare/<pinned>...files`.
2. Open a PR that changes `UPSTREAM_COMMIT`, and record what you reviewed in it.
3. If a patch no longer applies, `install.sh` stops before the restart. Rebase the patch, and drop it once upstream has an equivalent fix. To confirm that upstream merged the same change, compare the blob hash of the patched file (`index <old>..<new>` in the patch) with the file at the new commit.
4. Before applying, check `ss -tn state established "( sport = :9090 )"`. Applying the update restarts the reflector. Clients reconnect and resume from `latest.json`.
5. Pull on the server with `git merge --ff-only`. Apps deployed into `www/` outside Git (uncommitted files) survive as long as the merged commits do not touch them.
6. Afterwards run `install.sh --check`, the headless clients and `bad-join.js` again.
