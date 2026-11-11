# systemd unit, data image and install script

## Deployment repository

Keep only the deployment config in a private repo and clone it to `/srv/croquet` on the server:

```
UPSTREAM_COMMIT            pinned croquet/croquet commit (SHA)
install.sh                 idempotent apply; --check shows drift and changes nothing
patches/*.patch            local fixes applied to the upstream checkout
nginx/croquet.conf, nginx/croquet-limits.conf
systemd/croquet-reflector.service
systemd/croquet-cleanup.service, systemd/croquet-cleanup.timer
systemd/journald@croquet.conf
scripts/croquet-cleanup.sh
www/                       apps served under /croquet/apps/
README.md                  staff runbook: update, logs, cleanup, rollback, risks
```

`.gitignore`: `/upstream/`, `node_modules/`, `*.log`. Changes go through PRs. A person with SSH and sudo runs `git pull` and `sudo ./install.sh` on the server.

## Data image

A 1 GiB ext4 image mounted at `/var/lib/croquet` keeps a full file store from filling `/`:

```bash
fallocate -l 1G /var/lib/croquet.img && chmod 600 /var/lib/croquet.img
mkfs.ext4 -q -m 0 /var/lib/croquet.img
echo "/var/lib/croquet.img /var/lib/croquet ext4 loop,nofail,noexec,nosuid,nodev 0 2" >> /etc/fstab
mount /var/lib/croquet
install -d -m 2775 -o croquet -g www-data /var/lib/croquet/files /var/lib/croquet/tmp
```

`nofail` lets the server boot even if the image is broken. `RequiresMountsFor=` in the units keeps the reflector from writing into the bare mount point.

## `croquet-reflector.service`

```ini
[Unit]
Description=Croquet reflector
After=network.target
RequiresMountsFor=/var/lib/croquet

[Service]
User=croquet
Group=www-data
UMask=0002
WorkingDirectory=/srv/croquet/upstream/packages/reflector
Environment=NODE_ENV=production
Environment=FILES_MOUNT_PATH=/var/lib/croquet/files
Environment=CLUSTER_LABEL=<site-name>
ExecStart=/usr/bin/node reflector.js --standalone --storage=file --no-loglatency --no-logtime
Restart=always
RestartSec=5

MemoryHigh=300M
MemoryMax=400M
LogNamespace=croquet

# Internet-facing, unauthenticated, writes files from client requests: confine it.
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectHome=yes
ProtectSystem=strict
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths=/var/lib/croquet/files
TemporaryFileSystem=/srv:ro
BindReadOnlyPaths=/srv/croquet
InaccessiblePaths=-/opt -/var/www -/var/lib/mysql -/etc/letsencrypt
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

# The reflector listens on all interfaces; allow localhost only.
IPAddressDeny=any
IPAddressAllow=localhost

[Install]
WantedBy=multi-user.target
```

- Adjust `InaccessiblePaths` to the other apps' directories on the server. `TemporaryFileSystem=/srv:ro` + `BindReadOnlyPaths=/srv/croquet` hides the other `/srv/*` apps.
- Standalone mode needs no outbound network, so `IPAddressDeny=any` is safe. Verify it with a client after starting.
- About 70–90 MB RSS was observed when idle or with a few sessions. Measure under real use before tightening the memory limits.

## `journald@croquet.conf` → `/etc/systemd/journald@croquet.conf`

```ini
[Journal]
Storage=persistent
SystemMaxUse=100M
MaxRetentionSec=14day
```

Read the logs with `journalctl --namespace=croquet -u croquet-reflector`. Other services' journald settings stay untouched.

## Cleanup timer

```ini
# croquet-cleanup.service
[Unit]
Description=Remove stale Croquet session data
RequiresMountsFor=/var/lib/croquet

[Service]
Type=oneshot
User=croquet
Group=www-data
UMask=0002
ExecStart=/srv/croquet/scripts/croquet-cleanup.sh --apply
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/croquet/files /var/lib/croquet/tmp

# croquet-cleanup.timer
[Unit]
Description=Daily cleanup of Croquet session data

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it only after a dry run on real data: `sudo -u croquet /srv/croquet/scripts/croquet-cleanup.sh`.

## `install.sh` essentials

- Refuse to run unless root and unless the repo is at the expected path.
- A `FILES` list `repo/path=/etc/path`. Install with `cmp -s || install -m 644`, and remember whether nginx or systemd files changed.
- Upstream checkout under `$REPO/upstream`, owned by `croquet`. Run `git fetch --depth 1 <url> <sha>`, `checkout --force --detach`, `git apply patches/*.patch`, then `npm ci --omit=dev` in `packages/reflector`. Run these **as the `croquet` user** with a throwaway `HOME` and npm cache, so no build script runs as root.
- Write a stamp file containing `sha256(UPSTREAM_COMMIT + patches)`. Rebuild and restart the reflector only when the stamp changes. If a patch fails, `set -e` stops before the restart and the running reflector stays up.
- Restart the reflector only when its unit or the upstream changed, or when it is not running. Reload nginx only after `nginx -t` passes.
- `--check`: `diff -u` each installed file against the repo, compare the upstream HEAD and the stamp, check the `include` line, the fstab line, the mount and the service/timer state, print `df -h`, and exit non-zero on any drift.
- Print a reminder when the `include` line is missing, instead of editing the other app's site config automatically.

## Rollback

1. Remove the `include` line, then run `nginx -t` and `systemctl reload nginx`.
2. Run `systemctl disable --now croquet-reflector croquet-cleanup.timer`.
3. Delete `/etc/nginx/conf.d/croquet-limits.conf` and reload nginx again.
4. Remove the fstab line and run `umount /var/lib/croquet`. Delete the image only if the data should go too.
