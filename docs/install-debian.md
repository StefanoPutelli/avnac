# Debian Install

Run as root in Bash. Replace `avnac.example.com` with your domain.
You will need systemd, PostgreSQL and Nginx.

```text
Browser -- HTTPS --> Nginx
                      |-- /       --> /var/www/avnac (static frontend)
                      |-- /api/*  --> 127.0.0.1:3001/* (backend systemd)
                                              |--> local PostgreSQL
```

## 1. Packages and Node.js

```bash
apt-get update
apt-get install -y ca-certificates curl xz-utils git openssl rsync build-essential postgresql postgresql-client nginx
systemctl enable --now postgresql nginx
```

Then, install Node.js **24 LTS** from their official binaries:

```bash
AVNAC_NODE_VERSION=24.22.3
case "$(dpkg --print-architecture)" in
  amd64) AVNAC_NODE_ARCH=x64 ;;
  arm64) AVNAC_NODE_ARCH=arm64 ;;
esac
AVNAC_NODE_ARCHIVE="node-v${AVNAC_NODE_VERSION}-linux-${AVNAC_NODE_ARCH}"
AVNAC_NODE_TMP=$(mktemp -d)
if ! (
  cd "$AVNAC_NODE_TMP" &&
  curl -fSLO "https://nodejs.org/dist/v${AVNAC_NODE_VERSION}/${AVNAC_NODE_ARCHIVE}.tar.xz" &&
  curl -fSLO "https://nodejs.org/dist/v${AVNAC_NODE_VERSION}/SHASUMS256.txt" &&
  awk -v file="${AVNAC_NODE_ARCHIVE}.tar.xz" '$2 == file { print }' SHASUMS256.txt | sha256sum --check --strict && tar -xJf "${AVNAC_NODE_ARCHIVE}.tar.xz" -C /opt --no-same-owner
); then
  echo 'Node install failed.'
  exit 1
fi
ln -sfn "/opt/${AVNAC_NODE_ARCHIVE}" /opt/avnac-node
rm -rf -- "$AVNAC_NODE_TMP"
/opt/avnac-node/bin/node --version
```

## 2. User and checkout

```bash
adduser --system --group --home /var/lib/avnac avnac
install -d -o avnac -g avnac -m 0750 /var/lib/avnac
install -d -o avnac -g avnac -m 0755 /opt/avnac
runuser -u avnac -- git clone https://github.com/StefanoPutelli/avnac.git /opt/avnac/app
install -d -o root -g root -m 0700 /etc/avnac
install -d -o root -g root -m 0755 /var/www/avnac
```

Define this helper for installation and updates:

```bash
avnac_npm() {
  runuser -u avnac -- env PATH=/opt/avnac-node/bin:/usr/bin:/bin \
    /opt/avnac-node/bin/npm --prefix "/opt/avnac/app/$1" "${@:2}"
}
```

## 3. PostgreSQL

First, generate a database password and save the output:

```bash
openssl rand -hex 32
```

Create the role and database. Reuse them if they already exist.

```bash
runuser -u postgres -- createuser --no-superuser --no-createdb --no-createrole avnac
runuser -u postgres -- createdb --owner=avnac avnac
```

Set the password:

```bash
runuser -u postgres -- psql -c '\password avnac'
```

Test the connection using the same generated password:

```bash
psql -h 127.0.0.1 -U avnac -d avnac -W -c 'SELECT current_user;'
```

Use this password in `DATABASE_URL` in step 4. Keep PostgreSQL local with password authentication.

## 4. Configuration

```bash
install -o root -g root -m 0600 \
  /opt/avnac/app/deploy/debian/backend.env.example /etc/avnac/backend.env
sensible-editor /etc/avnac/backend.env
```

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL with the password from step 3 |
| `BETTER_AUTH_SECRET` | Generate with `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Public HTTPS origin, without `/api` or a trailing slash |
| `CORS_ORIGIN` | Same public origin |
| `ADMIN_EMAIL` | Initial administrator email |
| `ADMIN_PASSWORD` | Initial administrator password |
| `LISTEN_HOST` | `127.0.0.1` |
| `PORT` | `3001` |

Leave optional keys blank. Use `NAME=value`, without `export` or shell substitutions. Keep this file outside the checkout.

## 5. Build and service

```bash
avnac_npm backend install --include=dev --no-audit --no-fund
avnac_npm backend run check
avnac_npm frontend ci --include=dev --no-audit --no-fund
avnac_npm frontend run build
```

After a successful build:

```bash
rsync -a --delete --chown=root:root /opt/avnac/app/frontend/dist/ /var/www/avnac/
find /var/www/avnac -type d -exec chmod 0755 {} +
find /var/www/avnac -type f -exec chmod 0644 {} +
install -o root -g root -m 0644 \
  /opt/avnac/app/deploy/debian/avnac.service /etc/systemd/system/avnac.service
systemctl daemon-reload
systemctl enable --now avnac
curl --fail http://127.0.0.1:3001/health
```

Migrations and administrator creation run automatically on startup. The frontend uses `/api`; leave `VITE_PUBLIC_API_URL` unset. Any `VITE_*` values are public and require rebuilding the frontend.

## 6. Nginx

```bash
install -o root -g root -m 0644 \
  /opt/avnac/app/deploy/debian/nginx.conf /etc/nginx/sites-available/avnac
sensible-editor /etc/nginx/sites-available/avnac
# Replace the domain in the configuration.
ln -s /etc/nginx/sites-available/avnac /etc/nginx/sites-enabled/avnac
nginx -t && systemctl reload nginx
```

The template serves HTTP. Configure HTTPS separately on your public reverse proxy, either here or on another machine. Browser encryption requires HTTPS. Point DNS to the public proxy and use its HTTPS origin for `BETTER_AUTH_URL` and `CORS_ORIGIN`.

Keep the trailing slash in `proxy_pass http://127.0.0.1:3001/;` to strip `/api`. Do not cache API responses.

For a separate edge proxy, bind this Nginx to a private IP/port accessible only by that proxy. Forward the public `Host` and `X-Forwarded-Proto`; on the internal Nginx, use `$http_x_forwarded_proto` instead of `$scheme`. Keep the backend on loopback and terminate HTTPS at the edge.

## 7. First login

```bash
curl --fail https://avnac.example.com/api/health
ss -ltnp | grep ':3001'
journalctl -u avnac -n 100 --no-pager
```

Port 3001 should listen on `127.0.0.1` only. Sign in at `/files` before inviting users through `/admin`: the first administrator login initializes recovery keys. Create a document and check it from another browser.

Then clear `ADMIN_PASSWORD` in `/etc/avnac/backend.env` and restart:

```bash
systemctl restart avnac
```

Keep `ADMIN_EMAIL`. Editing `ADMIN_PASSWORD` does not change an existing account's password.

## Updates

Back up first. Define `avnac_npm` from step 2 if using a new shell.

```bash
runuser -u avnac -- git -C /opt/avnac/app pull --ff-only
avnac_npm backend install --include=dev --no-audit --no-fund
avnac_npm backend run check
avnac_npm frontend ci --include=dev --no-audit --no-fund
avnac_npm frontend run build
```

If successful:

```bash
systemctl stop avnac
rsync -a --delete --chown=root:root /opt/avnac/app/frontend/dist/ /var/www/avnac/
find /var/www/avnac -type d -exec chmod 0755 {} +
find /var/www/avnac -type f -exec chmod 0644 {} +
systemctl start avnac
curl --fail http://127.0.0.1:3001/health
```

Recopy changed service templates and run `systemctl daemon-reload`. Validate Nginx changes with `nginx -t` before reloading.

## Backups

```bash
install -d -o postgres -g postgres -m 0700 /var/backups/avnac
runuser -u postgres -- sh -c 'umask 077; pg_dump -Fc avnac > "/var/backups/avnac/avnac-$(date +%Y%m%d-%H%M%S).dump"'
```

Save the full database, `/etc/avnac/backend.env` and Nginx configuration securely off-server. Unsynced browser files are not included. Test restores to a separate database; stop Avnac before restoring production with `pg_restore --no-owner --role=avnac` into an empty database owned by `avnac`.
