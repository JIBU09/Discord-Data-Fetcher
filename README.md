# Discord Data Fetcher

## Permanent Discord attachment links

Open the message's context menu (right-click on desktop, or long-press on
mobile), then select **Apps** > **Create permanent links**. The action returns
the existing links for attachments that already have them and creates links
immediately for attachments that do not. It shows one embed per attachment
with clickable local and Tailscale URLs and indicates whether the existing URL
was reused or a new one was generated. Image attachments also use the local
URL for the embed preview; that preview may not load when the Discord client
cannot reach the Pi's LAN address, but the Tailscale URL remains available.

To remove one, use `/delete-url` and enter its generated ID. This invalidates
the link on both local and Tailscale addresses; it does not delete the original
Discord message or attachment. Existing embeds using that ID will return 404.

Each attachment response includes a local URL and a Tailscale fallback URL.
The local address is detected from the Pi's network interfaces; set
`LOCAL_BASE_URL` if the detected address is not the one your website can reach.
The Tailscale address is detected automatically when possible, or can be set
to the Pi's MagicDNS hostname with `PUBLIC_BASE_URL`.

Browsers cannot be redirected by the server if the local IP is unreachable.
For automatic fallback, copy `attachment-fallback.js` into your website and
use both URLs as shown below. The helper tries the local URL first for images,
video, and audio, then switches to Tailscale on an error or after 2.5 seconds.
For CSS backgrounds, it layers both URLs so the Tailscale image is visible if
the local one cannot load.

For example:

```html
<script src="/js/attachment-fallback.js" defer></script>

<img
  data-local-src="http://192.168.1.25:3000/file/your-generated-id"
  data-remote-src="http://100.100.10.25:3000/file/your-generated-id"
  alt="">

<video controls
  data-local-src="http://192.168.1.25:3000/file/your-generated-id"
  data-remote-src="http://100.100.10.25:3000/file/your-generated-id"></video>

<audio controls
  data-local-src="http://192.168.1.25:3000/file/your-generated-id"
  data-remote-src="http://100.100.10.25:3000/file/your-generated-id"></audio>

<div data-attachment-background
  data-local-src="http://192.168.1.25:3000/file/your-generated-id"
  data-remote-src="http://100.100.10.25:3000/file/your-generated-id"></div>
```

Replace the example addresses with the two addresses returned by the bot.
You can still use a single URL directly in `src` if you do not need automatic
fallback. The HTTP service looks up the original message in Discord on every
request and returns a non-cacheable redirect to the current Discord CDN URL.
It never saves signed CDN URLs or downloads attachment contents. Discord must
still have the original message and attachment, and the bot must still be able
to access them.

### Configuration

The bot reads the following optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HTTP_PORT` | `3000` | Port for the attachment endpoint. |
| `LOCAL_BASE_URL` | Detected LAN IPv4 plus port | Override the local URL, for example `http://192.168.1.25:3000`. |
| `PUBLIC_BASE_URL` | Detected Tailscale IPv4 plus port | Override the remote URL with the Pi's MagicDNS hostname or Tailscale IP, for example `http://raspberrypi:3000`. |
| `ATTACHMENT_DB_PATH` | `data/attachments.sqlite` | Location of the SQLite metadata database. |

Set the base URL overrides to HTTP origins without credentials, path, query,
or fragment. If your website is loaded over HTTPS, browsers may block HTTP
media links as mixed content; use an HTTP page on your private network.

The SQLite dependency requires Node.js 20 or newer. Use Node.js 22 LTS or newer
on the Raspberry Pi.

For a systemd service named `discord-data-fetcher`, add an override:

```sh
sudo systemctl edit discord-data-fetcher
```

```ini
[Service]
Environment="HTTP_PORT=3000"
Environment="LOCAL_BASE_URL=http://<your-pi-lan-ipv4>:3000"
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
`0.0.0.0`. Requests are rate-limited and accepted only from private LAN IPv4
addresses or Tailscale IPv4 (`100.64.0.0/10`) / IPv6
(`fd7a:115c:a1e0::/48`) addresses. Ensure your firewall allows TCP port 3000
only on the LAN and Tailscale interfaces you use. For UFW, replace `eth0`
with your Pi's LAN interface (often `wlan0` on Wi-Fi):

```sh
sudo ufw allow in on eth0 to any port 3000 proto tcp
sudo ufw allow in on tailscale0 to any port 3000 proto tcp
```

Do not configure router port forwarding or otherwise expose this port to the
public internet. The service uses the existing bot client and bot token; it
does not create another bot instance.

### Development and tests

Install dependencies with `npm install`, configure the existing private
`config.json`, then start the bot with `node index.js`. Run the focused test
suite with `npm test`.
