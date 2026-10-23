# Security

NTRX Health Check is a **single-user, read-only tool that runs on your own machine** and talks to Azure with *your*
`az login` identity. It has no user accounts, no database, no uploads and no webhooks. That decides which security
controls matter. The real exposure is **another website or another machine reaching the local server**, so the
protections target that. The table below goes through a standard hardening checklist item by item.

Re-check any time with `npm test` (backend) and `npm run e2e` (frontend, includes `security.spec.ts`).

| Checklist item | Applies? | What we do |
|---|---|---|
| **SQL injection** | No SQL database. | The only query language is Azure Resource Graph (Kusto). Values that come from configuration are escaped (`kqlString`) and name fragments are validated (`safeNameFragment`). Every query parameter the API accepts is checked against `^[A-Za-z0-9._-]{1,128}$` and rejected with 400 otherwise. |
| **Cross-site scripting (XSS)** | Yes | React escapes all text; there is no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `document.write` anywhere. A strict **Content-Security-Policy** (`script-src 'self'`, no inline script, no other origins) is sent with every response, and the one inline script was moved to `/boot.js`. Tests: markup stored in a group name renders as text; an inline script is blocked. |
| **CSRF** | Yes | Every mutating request (POST) must carry the `X-SAM-Request: 1` header, come from the same origin and not be `Sec-Fetch-Site: cross-site`. A web page on another site cannot add that header without a CORS preflight, which the server never approves. |
| **File uploads** | No uploads exist. | Nothing accepts a file or a request body. The `/api/files` route only *lists* blobs, and only for accounts the server discovered itself, a single folder name and a real date. |
| **Broken object-level authorization** | No users or per-user objects. | `/api/files` can only reach accounts in the server's own discovered list (unknown account → 404). Access to the whole API is limited to this machine (see "Network exposure"). |
| **Rate limiting** | Yes | In-memory limiter per client IP: restart 3/min, checks 40/min, files 300/min, everything else 900/min; answers `429` with `Retry-After`. |
| **JWT secrets** | We issue no JWTs. | The backend only *reads* the claims of the Azure token it already holds (to greet you by name); the token is never sent to the browser, never stored and never logged. |
| **Keep API secrets server side** | Yes | Storage keys are fetched at start-up with your identity (`listKeys`), kept only in memory and never put in a response. Tests scan every API answer for keys, SAS signatures, JWTs and passwords. `.env` is git-ignored (never tracked, not in history). |
| **Password hashing** | No passwords. | Sign-in is Azure's (`az login` / managed identity). The app stores no credentials. |
| **Multi-factor authentication** | Not applicable to the app itself. | There is no app login. MFA is enforced by your Azure account's own sign-in, which is what the backend uses. |
| **CORS** | Yes | **No CORS at all.** The dashboard is served by the same process, so no other site is allowed to read the API from a browser (tests confirm there is no `Access-Control-Allow-Origin`, and preflights are not approved). |
| **No auth tokens in local storage** | Yes | The browser stores only preferences (`sam.*` keys: theme, settings, saved groups, alert history). A test fails if anything token- or key-like appears. No cookies are set. |
| **Permissions enforced server side** | Yes, for what exists. | The server enforces the host/origin/CSRF/rate rules itself; the UI is not trusted. The only privileged action, *Restart backend*, is POST-only, CSRF-protected, rate-limited and local-origin only. |
| **Row-level security (RLS)** | No database. | — |
| **Verify webhook signatures** | No webhooks. | — |
| **SSRF** | Low | The server makes outgoing calls only to fixed Azure endpoints and a fixed public-IP lookup. No user-supplied URL is ever fetched. |
| **Exposed source maps** | Yes | The production build emits none, `.map` requests return 404 (test: *no source maps are published*), and the SPA fallback no longer answers file-like paths with the app page. |
| **Default credentials** | None exist. | No built-in user, password or key. `.env.example` contains only placeholders. |
| **Sensitive data out of logs** | Yes | Logs hold timings, account counts and friendly error text. Raw SDK errors (which can carry request headers) are no longer printed; only the sanitised message is. |
| **Vulnerable dependencies** | Yes | `npm audit`: frontend **0**, backend **0** (was 1 critical + 7 moderate; fixed by `npm audit fix` and upgrading `@azure/arm-resourcegraph` to 5.x). The unused `cors` package was removed. |

## Network exposure (the important one)

- The server listens on **127.0.0.1 only** by default (`HOST=127.0.0.1`). Another computer on your network cannot reach it.
- It answers only to the host names `localhost`, `127.0.0.1` and `[::1]` (plus anything in `ALLOWED_HOSTS`). This blocks
  **DNS-rebinding** pages that try to make your browser treat an attacker's domain as your local server.
- To share the dashboard deliberately, set `HOST=0.0.0.0` **and** `ALLOWED_HOSTS=your-host-name`, and put it behind
  something that authenticates people (a reverse proxy with SSO, a VPN). The tool itself has no login.

## Local cache

To show data straight after a restart, the backend keeps its last results in `backend/.cache` (git-ignored): the archive
snapshot and the last bot / database check results. It holds the same operational data the API already serves (account and
instance names, states, counts) and never a key, token or connection string. Delete the folder to clear it.

## Residual risks and recommendations

- Anyone who can use your logged-in browser or sit at your machine can use the dashboard: it is as trusted as your
  desktop session. Lock the screen.
- Your `az login` identity is what makes the data readable. Use an account with the least access that still works.
- Keep Node.js and the dependencies current: run `npm audit` in `backend` and `frontend` now and then.
- `STORAGE_CONN_n` connection strings (an optional fallback) put keys on disk; avoid them.
