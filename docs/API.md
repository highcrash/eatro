# API Reference

Full Swagger / OpenAPI documentation is auto-generated and served at:

```
https://yourdomain.com/api/docs
```

(Disabled when `NODE_ENV=production` for security; flip to
`development` momentarily if you need to browse the spec on a live
server, or run the API locally to inspect.)

## High-level surface

- **Auth** — `POST /api/v1/auth/login`, `/auth/refresh`. Returns
  JWT access + refresh tokens. Refresh expires in 30 days.
- **License gate** — `GET /api/v1/license/status`,
  `POST /api/v1/license/{activate,deactivate}`. All three are
  reachable even when the gate is locked.
- **Install wizard** — `GET /api/v1/install/status` always available;
  `/install/{system-check,branch,owner,finish}` 404 once the wizard
  is done.
- **Health** — `GET /api/v1/health` returns `{status:'ok',timestamp}`.
  Always public.
- **Public** — `GET /api/v1/public/*` for the marketing site
  (menu, branches, OG meta tags). No auth, no license check.
- All other modules require a valid JWT and an active (or grace)
  license. Mutations check the license inline as a defence-in-depth.

## Conventions

- Versioning via URI: every business endpoint lives under
  `/api/v1/...`.
- Errors are JSON: `{ statusCode, message, error }`. Specific
  domain failures may add extra fields (e.g. `result: 'LICENSE_LOCKED'`).
- Idempotency: mutating endpoints accept an `Idempotency-Key`
  header. Replays return the original cached response.

## Webhooks

Not implemented in v1. Roadmap; subscribe to the announcements
channel on the CodeCanyon item page for updates.
