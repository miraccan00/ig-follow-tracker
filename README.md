# follower · self-hosted Instagram follow tracker

A small **Go + JSON** web panel. No Node.js, npm, SQLite server, background timer or external Go modules. Mobile responsive, manual live checks, admin password, account-ID-based history, CSV export and browser Print to PDF.

> **Unofficial and experimental.** Instagram's private web login and followers endpoints change without notice; Instagram may refuse login from datacenter IPs, demand checkpoints / 2FA, rate-limit or restrict accounts. Never claim a scan succeeded until Instagram returned both complete lists. No Instagram password is written to disk. Instagram sessions live in RAM and are lost on process restart; JSON history is preserved.

## Docker (HTTP, publicly reachable)

Create an admin password in a local file on the server. **Never commit it to Git.**

```sh
sudo mkdir -p /opt/follower/data
sudo chown -R 1000:1000 /opt/follower/data
printf 'ADMIN_PASSWORD=' | sudo tee /opt/follower/.env >/dev/null
sudo chmod 600 /opt/follower/.env
sudo nano /opt/follower/.env  # set your own strong 12+ character admin password

docker build -t follower-go .
docker run -d --name follower-go --restart unless-stopped \
  --env-file /opt/follower/.env \
  -p 3100:3100 -v /opt/follower/data:/data follower-go
```

Open `http://YOUR_SERVER_IP:3100`, enter the separate admin password, log in to your Instagram account, then click **Şimdi tara**. On the next completed scan you get unfollowed, newly following, who you unfollowed, newly followed and not-following-back comparisons. Historical lists and account names are matched by numeric Instagram **ID**, not username. No periodic scanning.

**HTTP warning:** A mobile data connection **does not encrypt HTTP**. On this deployment **admin and Instagram credentials, session cookies and results can be intercepted on the network**. This mode is provided by request, not recommended for general public use. For practical safety, use HTTPS, even self-signed or free reverse-proxy TLS where appropriate. Protect your server firewall and admin password. No protection against Instagram account limitations is guaranteed.

## Updating an existing installation

The original Node.js/SQLite image is **not** replaced automatically. Back up its `/data` directory first. The Go application reads existing `snapshots/<username>/*.json` exports and imports complete records into `accounts/<instagram-id>/snapshots/*.json` on startup without editing the original files. If the previous SQLite database has data but the JSON snapshots are missing, export them before switching images. Use a different container name while testing; stop and remove the old one only after validating this version.

Docker file ownership: the app runs as UID/GID `1000:1000`, compatible with the old project's `node` user and the previous `/opt/ig-follow-tracker/data` permissions after `chown 1000:1000`.

## Data

```
data/
  admin.json                       # salted PBKDF2-SHA256 password hash (no plaintext)
  accounts/<instagram-user-id>/
    profile.json                   # latest username and numeric id
    snapshots/<UTC-timestamp>.json # complete follower/following lists
```

All JSON writes use temporary files + `fsync` + atomic rename and 0600 permissions. Completed scans append snapshots; interrupted, incomplete or rate-limited scans do not replace history. A user changing their Instagram username does not lose history. Original data is never deleted automatically. The app stores no Instagram password or session cookies on disk. Admin sessions last 12 hours and are reset when the process restarts.

## Features

- Admin password protects all data APIs and scans, with login attempt throttling and strict same-site session cookie.
- Instagram username/password and optional 2FA code login (experimental unofficial web API; checkpoint required cases need official Instagram verification).
- Manual live scan only. No cron, timers or auto checks.
- Multi-account history by stable numeric Instagram account ID, followed users compared by ID.
- Not following back, newly followed/unfollowed, new/lost followers, timestamped history.
- Searchable lists, responsive mobile UI, dark theme, CSV export, print-to-PDF.
- Incomplete scan fails closed if follower/following count mismatches the Instagram profile counts.

**Not included in this initial build:** automated unfollow/soft-block, ghost/bot scoring, 16 language translations, and guaranteed Instagram login compatibility. These are not safe to describe as tested or complete.

## Development

Requires Go 1.23+ (no external dependencies):

```sh
go test ./...
ADMIN_PASSWORD='your-unique-password-12chars' go run .
```

`PORT=3100 HOST=0.0.0.0 DATA_DIR=./data` are configurable. Open `http://127.0.0.1:3100` on the same machine. Real Instagram connection testing needs an account you control and must be done manually.

## License

MIT. This is an independently modified fork inspired by [miraccan00/ig-follow-tracker](https://github.com/miraccan00/ig-follow-tracker). InstagramUnfollowers by EdvinCodes has been considered for feature ideas; no third-party source code is copied.

