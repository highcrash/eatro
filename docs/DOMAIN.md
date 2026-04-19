# Domain + TLS

## DNS

You need at minimum one A record. If you want different subdomains
for the admin / POS / KDS / QR apps (recommended), point each at the
same VPS IP:

```
yourdomain.com         A    <VPS public IP>
www.yourdomain.com     A    <VPS public IP>
admin.yourdomain.com   A    <VPS public IP>     (optional)
pos.yourdomain.com     A    <VPS public IP>     (optional)
kds.yourdomain.com     A    <VPS public IP>     (optional)
qr.yourdomain.com      A    <VPS public IP>     (optional)
```

Wait for DNS to propagate (`dig yourdomain.com` should return your
IP) before starting Caddy or running certbot.

## TLS — three options

### A) Caddy (built-in to the Docker compose)

Edit `Caddyfile` to replace `yourdomain.com` with your real domain.
Caddy issues + renews Let's Encrypt certs automatically. No certbot,
no cron jobs.

### B) nginx + certbot

Use the `infra/nginx-example.conf` template. After nginx is serving
your site over HTTP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Renews are wired into systemd-timer automatically.

### C) Cloudflare in front

Set Cloudflare's SSL mode to **Full (strict)** and either:
- generate an Origin Certificate in Cloudflare and install it on your
  nginx (15-year validity, never needs renewal), or
- run Caddy / nginx+certbot on origin and let Cloudflare proxy.

Cloudflare's caching is fine for static SPA assets. Make sure
`/api/*` and `/socket.io/*` paths bypass cache (set a Cache Rule:
"Cache Eligibility — Bypass cache").

## License + domain

The license you bought from CodeCanyon binds to ONE domain. If you
want to change domains:

1. Settings → License → Deactivate (releases the seat).
2. DNS update + redeploy on the new domain.
3. Settings → License → enter purchase code + new domain.

Wildcard licenses (`*.example.com`) cover any subdomain depth — buy
one of those if you run multiple branded subdomains for franchises.
