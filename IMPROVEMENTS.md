# NTRX AppOps — Improvements

From the original `health-check` prototype → the current **NTRX AppOps** SRD
Archive Monitor. This documents what changed and why.

> **In one line:** it went from a key-in-plaintext, 8-account, inline-styled JS
> prototype that blocked on slow calls → a secretless, auto-discovering,
> 96-account, TypeScript, cached, auto-starting monitor with a professional
> themed UI and full docs.

---

## 🔐 Security (the biggest change)

| Original | Now |
|---|---|
| 8 storage **account keys in plaintext** `backend/.env`, sitting in a Downloads folder | **Zero secrets on disk** — each key is fetched at runtime via your `az login` identity (management-plane `listKeys`), exactly like the Azure Portal |
| Account keys were the *only* auth path | Identity-based by default; connection strings kept only as a discouraged fallback |
| `.env` with real keys was committable | `.gitignore` added + a secret-free `.env.example` |
| Firewall errors were opaque | Errors now name the **exact blocked IP** to whitelist; automatic firewall-opening was deliberately **not** built (audit/compliance-safe) |

---

## ⚡ Reliability & performance

| Original | Now |
|---|---|
| Every reload re-ran all checks — **60–120 s** with many accounts | Background scan + in-memory cache → reloads in **8–148 ms** |
| One slow/hung account could **stall the entire dashboard** | **Bounded per-account timeout** (AbortSignal) isolates failures |
| Raw Azure error strings (even a full HTML page dumped into a card) | **Friendly, actionable errors**: firewall vs RBAC role vs shared-key-disabled vs no-container vs proxy-interception |

---

## 🏗️ Architecture & code quality

| Original | Now |
|---|---|
| Plain JS, all logic in one route file | **TypeScript** end-to-end, split into `config` / `azure` / `checker` / `server` |
| No tests | **6 unit tests** on the pure check logic + passing `typecheck` |
| **Manual list of 8 accounts** in `.env` | **Auto-discovery** of every `*srd01` account via Azure Resource Graph — found **96 across 77/84 subscriptions** |
| Docs described features that didn't exist (SQL DTU, `SUBSCRIPTIONS`) | Docs match reality; dead **LoginPage / useAuth** device-code code removed |
| Hardcoded `C:\Users\sarveshd\…` paths | Config/env-driven |

---

## ✨ Features added

- **Categories:** PROD / UAT / DEV **plus a dedicated "No SRD"** category for
  locations with no archive container — split out from real errors.
- **"PRD at risk"** metric — now **excludes No-SRD** so it counts only genuine
  problems.
- **Fast search** with **prefix-first ranking** (type `db` → names starting with
  `db` first, then names containing `db`), working inside any active tab.
- **Slide-over detail drawer** on card click — replaced the inline expand that
  resized every card in the row.
- Auto-refresh + manual refresh, and a "warming up" state during the first scan.

---

## 🎨 UI / UX

| Original | Now |
|---|---|
| 500+ lines of **inline styles** | **Design-token system** (CSS variables) |
| Generic dark theme | Polished **HR-dashboard (Crextio) look** — black + butter + cream, glass header, pill nav, health ring, KPI tiles, large radii |
| Default system font | **Plus Jakarta Sans**, self-hosted (works offline) |
| — | **"NTRX AppOps"** title; profile avatar removed; persistent light/dark toggle |

---

## 🖥️ Ops & setup

| Original | Now |
|---|---|
| Two dev servers, ran inside **WSL**, machine-specific | Runs **natively on Windows**; **single process** serves API + UI on one port (`:3001`) |
| Manual start every time | **Auto-starts at every logon** via a Scheduled Task ("NTRX AppOps"), verified end-to-end |
| Sparse setup notes | Full **`SETUP.md`** — prerequisites, install, config reference, deployment, troubleshooting, autostart |
| Node not installed | Installed Node LTS 24; stopped the old WSL instance |

---

## 🐞 Bugs fixed along the way

- `useMemo` misused for a fetch side-effect (original `BlobPanel`) — eliminated
  in the drawer redesign.
- Hung-account stall → bounded per-account timeout.
- Raw HTML error body dumped into a card → clean "a proxy is intercepting"
  message.
- CSS cascade bug where a fallback `:root` rule overrode every accent theme.

---

## Known limitations / next steps

- **Firewall:** many `srd01` accounts restrict network access; run the monitor
  on the corporate VPN or inside Azure (`USE_MANAGED_IDENTITY=true`) to clear the
  "firewall / IP not allowlisted" errors the right way.
- **Secrets/certificates expiry** (Key Vault) was scoped out; those vaults are
  also firewalled and would need network access first.
- **7 subscriptions have no `*srd01` account** (BOE, BOM2, CIBC, CIC, EFG,
  RESERVATIONS, UAT-BOM2) so there's nothing to monitor there.
- The account keys that were previously exposed in plaintext should be
  **rotated**.
