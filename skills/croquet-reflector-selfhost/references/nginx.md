# nginx: one include in the existing TLS server block

Keep everything for Croquet in two files, so the only edit to the existing site config is one `include` line.

- `/etc/nginx/croquet.conf`: locations, included from the `server { listen 443 ... }` block of the existing site.
- `/etc/nginx/conf.d/croquet-limits.conf`: `limit_*_zone` and `map` (http context; `conf.d/*.conf` is usually included there already).

Check first:
- `nginx -V 2>&1 | grep -o with-http_dav_module`. PUT needs the dav module.
- If the existing site already proxies something under `/croquet/`, pick another prefix.
- Put the `include` after any other `include` of a location file that might match the same prefix.

Apply with `nginx -t && systemctl reload nginx`. Never `restart` a shared nginx.

## `croquet-limits.conf`

```nginx
# Rate-limit PUT only. Requests whose key is empty are not limited.
map $request_method $croquet_put_key {
    PUT     $binary_remote_addr;
    default "";
}
limit_req_zone  $croquet_put_key    zone=croquet_put:5m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=croquet_ws_ip:5m;
limit_conn_zone $server_name        zone=croquet_ws_total:1m;
```

## `croquet.conf`

```nginx
location = /croquet  { return 302 /croquet/apps/; }
location = /croquet/ { return 302 /croquet/apps/; }

# Static apps. Same origin as the other apps on this host: only reviewed apps.
location ^~ /croquet/apps/ {
    alias /srv/croquet/www/;
    index index.html;
}

# Reflector: WebSocket only, so /metrics, /sessions etc. stay unreachable.
location ^~ /croquet/reflector/ {
    if ($http_upgrade !~* ^websocket$) {
        return 404;
    }

    limit_conn croquet_ws_ip 20;
    limit_conn croquet_ws_total 200;

    proxy_pass http://127.0.0.1:9090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# Snapshots and persistent data. Anyone can PUT, so the browser must never
# interpret the content, and the size stays inside the fixed-size image.
location ^~ /croquet/files/ {
    alias /var/lib/croquet/files/;

    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, PUT, OPTIONS" always;
        add_header Access-Control-Allow-Headers "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,X-Croquet-App,X-Croquet-Id,X-Croquet-Session,X-Croquet-Version,X-Croquet-Path" always;
        add_header Access-Control-Max-Age 1728000 always;
        return 204;
    }

    limit_except GET PUT OPTIONS {
        deny all;
    }

    dav_methods PUT;
    dav_access group:rw all:r;
    create_full_put_path on;
    client_max_body_size 20m;
    client_body_temp_path /var/lib/croquet/tmp;   # inside the image, not on /
    limit_req zone=croquet_put burst=20 nodelay;

    types { }
    default_type application/octet-stream;

    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Expose-Headers "Content-Length,Content-Range" always;
    add_header Content-Security-Policy "sandbox; default-src 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Robots-Tag "noindex" always;

    # latest.json etc. are read and written by the reflector directly.
    location ~* \.json$ {
        return 403;
    }
}
```

Notes:
- Upstream's own config accepts 100 MB per PUT. 20 MB has been enough for typical snapshots. Raise it only after you measure.
- `add_header` inside `if` and in the location do not merge. That is why the OPTIONS branch repeats the CORS headers.
- `Access-Control-Allow-Origin "*"` is needed when apps on other hosts use this reflector. If all apps are on this host, drop the CORS headers.
- nginx (www-data) creates files by PUT and the reflector reads and writes them too. So the data dirs are `croquet:www-data 2775` and both sides use umask 002.
