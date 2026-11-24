# Architecture summary — Nexio CRM (run-1, standard, source-only)

Target `/Users/zzz/Desktop/nexio crm`, commit 5dd3183 (app source clean; founder/ docs dirty, out of scope).

## 1. Product, principals, protected resources
Multi-tenant SaaS CRM (Nexio Lab, UZ market). Principals: anonymous; `client_portal_user` (bound to one org+contact, path-confined to /portal and /auth); 13 tenant roles (`tenant_owner` all perms; `tenant_admin` team/roles/settings/integrations but not billing/finance; narrower roles; `read_only`); API keys `nxk_…`/OAuth client_credentials tokens (Laravel); platform admins (`is_platform_admin`, `platform_role` superadmin/support/finance); Telegram-linked chat identities; provider webhooks (Click, Payme, AI-voice, Telegram). Protected: cross-tenant CRM/finance data, sessions/credentials, billing/plan entitlements, platform provider secrets, AI spend, plugin secrets, backups.
Comparable: amoCRM-class SaaS CRMs (only filenames in docs/ — no source-grounded baseline); no severity dismissal based on it.

## 2. Stack and deployment (source-visible)
- SPA: React 18/TS/Vite (`src/`), Capacitor 8 Android/iOS wrapper (`capacitor.config.ts`, appId crm.nexiolab.uz).
- **Laravel 13/PHP 8.3 backend (`backend/`) = production path** per docs/ARCHITECTURE.md:7-8 and deploy.sh (CloudPanel, PM2, nginx/php-fpm; Docker: nginx SPA + api image, supervisord as root). Only middleware: `ApiContext`; auth is inside controllers via `H::requirePermission`/`$ctx->auth()`.
- **Cloudflare Worker + D1 (`api/*.ts`, `migrations/`, `wrangler.toml`) = documented legacy**, but deployable; `ENVIRONMENT="development"` is committed. Both stacks implement the same contract; audit both (divergences matter). `api/*.js`/`src/*.js` are stale compiled twins.
- Execution limits: php/composer absent, no network-namespace sandbox → **no target code is executed**; all decisive runtime/deployment facts become `needs_validation`.

## 3. Entry surfaces and key paths
HTTP /api/v1 (Laravel routes `backend/routes/api_v1.php`, `api.php`; Worker `api/worker.ts`). Public: auth (register/login/forgot/reset/verify/invites), `/billing/plans`, custom-plan quote, lead forms (`LeadFormController`), `/oauth/token`, webhooks click/payme/ai-voice/telegram. Session cookie or `X-Nexio-Session` header or API key. Plugins: first-party in-process PHP only (`backend/plugins/*`, `PluginRuntime::invoke`), third-party ZIPs stored inert (`PackageStore`). Outbound: tenant webhooks (`WebhookService`), plugin curl to tenant `api_url` guarded by `OutboundEndpoint::parse`, Groq/Telegram/FCM/Click/CBU/ImageGenerator. Files: attachments, CSV exports (`SalesController::exportCsv`, `ReportsController::export`, Worker `deals.ts` export). Admin CLI: backup/restore/failover/purge, `CreateSuperAdmin`. Seeds: `seed/generate.mjs`, migration promoting a superadmin.

## 4. Trust boundaries and strongest source-visible control
- Tenant scope: tenant id from session membership; Laravel `H::tenantRef/memberRef` for foreign ids; Worker does NOT validate many foreign ids and runs unfiltered child queries.
- RBAC: Rbac matrix identical both stacks; platform admins bypass `requirePermission` in Laravel; `platform_role` is unused in Laravel.
- Portal: path prefix confinement + (org_id, contact_id) joins.
- CSRF: Worker strict Origin on session mutations + `__Host-` SameSite=Strict; Laravel allows missing Origin, SameSite=Lax, header session token.
- Webhooks: Payme Basic hash_equals; Telegram secret header (Laravel only); AI-voice HMAC+timestamp+event dedupe (one global secret); Click md5 sign.
- SSRF: `OutboundEndpoint` (https, public IPv4 via gethostbyname, no redirects) with a suspect `isset(...)` userinfo/query check.
- Rate limits: Cache get/put non-atomic (Laravel), per-isolate memory (Worker).

## 5. Starting paths
`backend/app/Http/Middleware/ApiContext.php`, `backend/app/Support/{H,Rbac,OutboundEndpoint}.php`, `backend/app/Http/Controllers/**`, `backend/app/Services/**`, `backend/app/Plugins/**`, `backend/plugins/**`, `api/worker.ts`, `api/core.ts`, `api/routes/*.ts`, `src/lib/{api,native,hooks}.ts`, `deploy.sh`, `deploybot.sh`, `Dockerfile`, `backend/Dockerfile`, `docker/`, `.github/workflows/ci.yml`, `android/`, `ios/`.

## 6. Prior coverage
No prior ledger or findings exist for this repo (first run). Nothing is excluded. Unverified recon leads (to be proven or disproved by hunters, not facts): password-reset token returned in response when env≠production (both stacks, Laravel reset token no expiry check); `acceptInvite` issues a session for an existing user without credentials/MFA; Laravel sandbox payment provider default activating plans; Worker Telegram webhook without secret; weak `OutboundEndpoint` check; Worker unvalidated foreign ids; tenant_admin self-promotion to owner; plugin operation invoke lacking role check; Laravel suspended-tenant status not enforced; CSV formula injection in `SalesController::exportCsv`; `/ai/complete` client-chosen model/quota.

## 7. Companion selection
AI-AND-LLM (Groq completions, Telegram assistant, knowledge base prompts); WEB-PROTOCOL-AND-AUTH (sessions, CSRF, reset, invites, MFA, API keys); CLIENT-SIDE and DESKTOP-MOBILE-AND-LOCAL-IPC (SPA + Capacitor webview/secure storage/FileProvider); SUPPLY-CHAIN-AND-RELEASE and CLOUD-AND-DEPLOYMENT (CI, Dockerfiles, deploy scripts, wrangler); PROTOCOLS-RPC-AND-MESSAGING (webhook signing/replay); RESOURCE-EXHAUSTION-AND-AVAILABILITY (rate limits, AI spend, queues); DATA-ISOLATION-AND-LIFECYCLE (tenant isolation, export, backup, deletion).
