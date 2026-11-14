# Discord Data Fetcher

## Permanent Discord attachment links

Use the **Create permanent links** message action to create a stable link for
each attachment on a Discord message:

1. Open the message's context menu (right-click on desktop, or long-press on
   mobile).
2. Select **Apps** > **Create permanent links**.
3. Copy the returned URL or URLs into your private website.

The action is a Discord message context-menu command so it can reliably target
the exact message; it does not require the bot to read message content.

For example:

```html
<img src="http://raspberrypi:3000/file/your-generated-id">
<video controls src="http://raspberrypi:3000/file/your-generated-id"></video>
<audio controls src="http://raspberrypi:3000/file/your-generated-id"></audio>
```

Replace `raspberrypi` with the Raspberry Pi's actual Tailscale MagicDNS
hostname or Tailscale IP. The HTTP service looks up the original message in
Discord on every request and returns a non-cacheable redirect to the
attachment's current Discord CDN URL. It never saves signed CDN URLs or
downloads attachment contents. Discord must still have the original message
and attachment, and the bot must still be able to access them.

### Configuration

The bot reads the following optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HTTP_PORT` | `3000` | Port for the attachment endpoint. |
| `PUBLIC_BASE_URL` | Unset (link creation disabled) | Base URL included in links. Set this to the Pi's MagicDNS hostname or Tailscale IP, for example `http://raspberrypi:3000`. |
| `ATTACHMENT_DB_PATH` | `data/attachments.sqlite` | Location of the SQLite metadata database. |

`PUBLIC_BASE_URL` must be an HTTP URL without credentials, path, query, or
fragment. Until it is set, the bot will not create attachment links. If your
website is loaded over HTTPS, browsers may block HTTP media links as mixed
content; use an HTTP page on your private tailnet for these links.

The SQLite dependency requires Node.js 20 or newer. Use Node.js 22 LTS or newer
on the Raspberry Pi.

For a systemd service named `discord-data-fetcher`, add an override:

```sh
sudo systemctl edit discord-data-fetcher
```

```ini
[Service]
Environment="HTTP_PORT=3000"
Environment="PUBLIC_BASE_URL=http://<your-pi-magicdns-name>:3000"
Environment="ATTACHMENT_DB_PATH=/path/to/Discord-Data-Fetcher/data/attachments.sqlite"
```

Use the actual project path in `ATTACHMENT_DB_PATH`. Then restart and check the
existing service:

```sh
sudo systemctl daemon-reload
sudo systemctl restart discord-data-fetcher
sudo systemctl status discord-data-fetcher
journalctl -u discord-data-fetcher -f
```

The endpoint starts alongside the existing bot process and listens on
`0.0.0.0`, so Tailscale peers can connect. Requests are additionally restricted
to Tailscale IPv4 (`100.64.0.0/10`) or Tailscale IPv6 (`fd7a:115c:a1e0::/48`)
source addresses and rate-limited. Ensure the tailnet ACL permits only the
intended devices to reach the Pi on TCP port 3000. If UFW is enabled, allow the
port on the Tailscale interface, for example:

```sh
sudo ufw allow in on tailscale0 to any port 3000 proto tcp
```

Do not configure router port forwarding or otherwise expose this port to the
public internet. The service uses the existing bot client and bot token; it
does not create another bot instance.

### Development and tests

Install dependencies with `npm install`, configure the existing private
`config.json`, then start the bot with `node index.js`. Run the focused test
suite with `npm test`.
