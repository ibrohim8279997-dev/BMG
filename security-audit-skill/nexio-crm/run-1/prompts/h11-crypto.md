# Hunter prompt for agent `h11-crypto`

## 1. Role
Your goal is to find source-grounded security invariant failures in your assigned coverage units. You must return exactly one JSON object matching the structured-result contract at the end of this prompt (no surrounding prose).

## 2. architecture.md (verbatim)

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


## 3. Assigned coverage units

### coverage_id: backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAuthController.php%23tokens-hashes-secrets::backend%2Fapp%2FSupport%2FH.php%23password-hashing-and-token-generation::backend%2Fapp::ATTACK-CLASSES.md%23Cryptography%20and%20secrets
- surface: backend/app/Http/Controllers/Api/V1/AuthController.php#tokens-hashes-secrets
- boundary: backend/app/Support/H.php#password-hashing-and-token-generation
- subsystem: backend/app
- attack_class: Cryptography and secrets
- starting_paths: backend/app/Support/H.php, backend/app/Plugins/SecretsVault.php, backend/app/Http/Controllers/Api/V1/PlatformController.php, backend/app/Http/Controllers/Api/V1/IntegrationsController.php, api/core.ts, seed/generate.mjs, seed/seed.sql, backend/database, backend/.env.example, .env.example
- ordinary_attack_class_block: ATTACK-CLASSES.md#Cryptography and secrets
- selected_companion_blocks: WEB-PROTOCOL-AND-AUTH.md#Core discipline, WEB-PROTOCOL-AND-AUTH.md#API-key and mTLS attack classes, WEB-PROTOCOL-AND-AUTH.md#Universal moves, WEB-PROTOCOL-AND-AUTH.md#Validation rules
- excluded_blocks:
  - WEB-PROTOCOL-AND-AUTH.md#Browser-session attack classes: not the primary boundary of this unit; owned by a peer unit or not source-visible here
  - WEB-PROTOCOL-AND-AUTH.md#MFA, passkey, and account-transition attack classes: not the primary boundary of this unit; owned by a peer unit or not source-visible here
  - AI-AND-LLM.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - CLIENT-SIDE.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - SUPPLY-CHAIN-AND-RELEASE.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - CLOUD-AND-DEPLOYMENT.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - PROTOCOLS-RPC-AND-MESSAGING.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - DATA-ISOLATION-AND-LIFECYCLE.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - DESKTOP-MOBILE-AND-LOCAL-IPC.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
- parent focus hints (unverified recon leads, prove or disprove each, never assume): Crypto/secrets: plaintext session ids and invite/reset tokens at rest, PBKDF2 params, key derivation without KDF, hash_equals uses, random sources, demo superadmin seeds and promote-superadmin migration, committed secrets, md5 Click, APP_KEY/Crypt usage.

## 4. Selected blocks (verbatim)

### ATTACK-CLASSES.md#Cryptography and secrets

**Cryptography and secrets** (subagent_type: `general`)
- Weak randomness for security-critical values (tokens, keys, nonces)
- Hardcoded secrets, secrets in logs, error messages, URLs, or client-visible responses
- Broken key derivation, missing HMAC verification, nonce reuse
- Timing side-channels on secret comparison
- Misuse of crypto primitives (ECB mode, unauthenticated encryption, static IVs, etc.)
- What happens when crypto operations fail? Does the error path fall back to no-crypto?


### WEB-PROTOCOL-AND-AUTH.md

## Core discipline (include in every agent prompt for this domain)

```
- Framing and cache findings require two interpretations of the same request, response, or key. Name both components and the exact normalized value on each side.
- For every credential, find the signature or secret verification and every binding required for its role: issuer, audience, origin, RP, client, session, principal, resource, assurance, expiry, and one-time state.
- Host, Forwarded, X-Forwarded-*, Origin, Referer, redirect targets, callback state, and request-derived URLs are trust decisions. Trace each to the affected identity or response.
- A missing header, cookie attribute, MFA prompt, or rate limit is not a finding alone. Require an accepted invalid request, cross-principal impact, assurance downgrade, or credential disclosure.
- Classify `confirmed` only from complete source evidence and bounded local request/token tests. Use `needs_validation` when proxy, IdP, browser, certificate, secret, or deployed configuration is required but not visible.
```


## API-key and mTLS attack classes (subagent_type: `general`)

**API-key scope and resource binding**
A key authenticates to broader tenants, resources, actions, or environments than its server-side record grants, or request parameters override those bindings. Review key lookup, prefix/full-secret verification, type confusion between publishable and secret keys, scope checks, rotation, revocation caches, and bulk endpoints.

**API-key exposure and unsafe transport**
Keys appear in client bundles, URLs, redirects, logs, error paths, build artifacts, or responses accessible to a lower-trust principal. A public identifier called a key is not a secret. Confirm key type and the authority gained by disclosure.

**mTLS peer and application-identity confusion**
A process trusts client-certificate identity headers from any network peer, verifies a chain but maps attacker-influenceable subject text to an account incorrectly, or accepts a certificate for the wrong trust domain, extended usage, audience, or validity policy. Where a trusted proxy terminates mTLS, verify only that proxy can connect, it removes incoming identity headers, and the backend binds the sanitized identity to the request.

**Certificate lifecycle fallback**
Expired, revoked, missing, or renewal-failed certificates cause silent fallback to bearer-only or anonymous operation, or long-lived pooled connections retain authorization after revocation. Missing deployment revocation data makes the result `needs_validation`; an in-repo fail-open branch is source-confirmable.


## Universal moves (apply across the above)

- Walk issue → store → transmit → consume → refresh → revoke for every credential and challenge. Compare normal, error, retry, migration, legacy, and account-switch paths.
- Enumerate every door to the same identity and every route to the same sensitive operation. The effective policy is the weakest parallel path, not the most polished UI.
- Diff parser, proxy, router, cache, and application normalization side by side. For local validation, feed identical bounded request fixtures into each component rather than sending traffic to a live deployment.
- For recovery and linking, draw the account before/after graph. Each edge must name the current principal, proof of the new identity, required assurance, callback/session binding, and revocation effect.


## Validation rules (apply before reporting ANY finding here)

1. Apply a source-visibility gate. Proxy chains, edge cache keys, IdP policy, certificate trust, browser cookie behavior, secrets, and deployed auth modes may be outside the repository. Record a precise `needs_validation` candidate instead of asserting missing infrastructure behavior.
2. For framing and cache findings, name both components and the divergent parse/key. Confirm cross-request, cross-user, or private-response impact with bounded local fixtures.
3. For token, MFA, passkey, account-link, recovery, API-key, and mTLS findings, cite the verification line and missing principal/session/resource/origin/audience/action/assurance binding. Prove the server accepts the invalid transition or credential.
4. For CSRF, name the ambient credential, state-changing route, accepted cross-site request shape, browser cookie policy, and missing effective check. Read-only actions and routes requiring a non-ambient bearer token do not qualify.
5. Verify framework and library defaults. If version or configuration is unknown, use `needs_validation`; do not turn an unverified critical claim into a lower-severity confirmed finding.
6. Return `confirmed` only with a complete source trace and observable unauthorized identity, state, or disclosure. For `needs_validation`, name the missing fact and safe local or owner-observed check that resolves it.


## 5. Excluded blocks
Listed per unit in section 3 with reasons.

## 6. Core hunting method

## Defensive vulnerability-finding method

Your goal is to find source-grounded security invariant failures and the smallest fix,
not to expand harm beyond the boundary result. Stay within source review and bounded local execution.
Do not contact deployed endpoints, provider APIs, registries, identity systems,
message brokers, shared services, or other users. Use local dummy data only.

READ THE CODE AT DEPTH. Follow each assigned input through parsing, identity,
authorization, normalization, state, derived copies, and the final sink. Read sibling,
legacy, batch, retry, cancellation, migration, and error paths that produce the same
effect. Compare sibling controls for equivalence, not only presence, and compare what
one component guarantees with what the next component assumes.

WORK FROM A CONCRETE INVARIANT:
1. Name the lower-trust principal and starting capability.
2. Name the accepted value, action, state transition, or resource selector.
3. Locate the control that should reject, bind, isolate, limit, or revoke it.
4. Trace the exact source path after that decision.
5. Stop at the smallest affected dummy record, wrong return value, process-integrity
   effect, or locally observable shared-resource effect.
6. State a source-level change and regression case that enforce the invariant.

DEPTH BOUND: trace only paths that can reach your assigned boundary or whose
guarantees that boundary relies on. Stop a line of investigation as soon as the
invariant is settled either way, and record the result in your structured output —
a covered, candidate, or blocked disposition, or an `uncovered` entry — instead of
continuing to search.

TEST SAD PATHS AND DISAGREEMENTS. Check absent, empty, zero, negative, maximum,
over-limit, duplicate, mixed encoding, stale, revoked, reordered, concurrent,
partially migrated, failed dependency, and rollback state only where the interface
accepts them. Compare canonicalization and units at every parser or policy handoff.
For multi-step issues, treat each output as a prerequisite and do not assume a later
boundary. If any prerequisite is not established, record a blocker.

When a proposed high or critical candidate reveals a reusable root cause, search paths
owned by the assigned coverage IDs for lexical, structural, and logical variants.
Consolidate the same root cause, but establish each variant's conditions and impact
independently. Do not investigate peer-owned units. Return a variant with no current
coverage unit as `uncovered`.

USE THE NARROWEST LOCAL CHECK THAT SETTLES THE CLAIM. Target-controlled builds,
tests, processes, browsers, emulators, fuzzers, and fixture processing may run only
inside the parent-approved OS-enforced sandbox. It must disable external networking,
start from an empty allowlisted environment, expose target and tools read-only, permit
writes only to your scratch directory, and apply low CPU, memory, process, file-size,
disk, and wall-clock limits. Isolated loopback is allowed only for a local fixture.
If any control is unavailable, do not execute: return needs_validation with that exact
blocker. Prefer an existing unit test, minimal function harness, dummy-tenant service
call, small malformed fixture, deterministic race schedule, or locally rendered policy.
Do not install or fetch tools.

Record the exact input, command, limits, and minimum result. For the environment,
record only allowlisted variable names and safe non-secret values needed to reproduce
the check. Never capture the ambient environment, inherited variables, credentials,
authentication state, or unrelated host paths. The target-controlled process writes
only in scratch. After the sandbox and all its processes terminate, only trusted
parent-side code may promote predeclared scratch-relative files, following the
promotion procedure block included verbatim in this prompt. You and target code never
write retained artifacts. If promotion is unavailable or fails for decisive evidence,
return needs_validation with the exact promotion blocker.
Never stress availability, invoke a live target, use a real credential, publish an
artifact, or continue past the minimum observed effect.

A deployment, browser, provider, broker, OS, proxy, package, secret, or identity fact
outside source is not proof either way. If one such fact is decisive, return a
needs_validation record with the exact missing observation and safe owner-observed check.

### Promotion procedure (reference only; the parent performs it)

Artifact promotion procedure (trusted parent-side code only):
Reference only for you: the parent performs these steps; you never perform them.

Before execution, the parent opens and retains trusted, non-inheritable directory
descriptors for the agent's scratch/ and artifacts/ roots, and records an allowlist
of expected scratch-relative artifact files plus explicit per-file and cumulative
byte limits. Never pass those descriptors to the agent or sandbox. After the sandbox
and all its processes terminate, trusted parent-side code promotes each allowlisted
file separately:

1. Validate the declared relative path: reject absolute, empty, `.`, `..`, or
   symlinked components.
2. Walk each parent component from the retained scratch-root descriptor with
   no-follow directory-relative operations; never reopen by path.
3. Open the leaf no-follow and nonblocking.
4. Verify with `fstat` that it is a regular file with link count exactly one and
   within the recorded per-file and cumulative byte limits.
5. Enforce those limits again while reading from that descriptor.
6. Copy exactly the verified size, repeat `fstat`, and reject a changed identity,
   type, link count, or size.
7. For the destination, walk every parent component from the retained
   artifacts-root descriptor with no-follow directory-relative operations; require
   each existing component to be a real directory, and create any missing directory
   exclusively before reopening and verifying it no-follow.
8. Create the leaf exclusively without following links, verify that the opened
   destination is a regular file with link count exactly one, and copy from the
   verified source descriptor without reopening either path.
9. Use equivalent race-safe APIs on non-POSIX systems.
10. Never recursively copy or glob scratch, extract an archive into artifacts, or
    open or promote a symlink, FIFO, socket, device, directory, hard-linked file,
    changing file, or file that exceeds its bound.
11. If any check is unavailable, cannot be enforced, or fails, discard the scratch
    entry; if it is decisive evidence, retain `needs_validation` with the exact
    promotion blocker.

## 7. Core validation rules

## Candidate gate

1. A candidate needs a complete repository-relative source trace and evidence for the
   claimed root cause, including the strongest source-visible control.
2. A proposed confirmed record needs a bounded local observed result, meaningful impact
   across a stated boundary, complete conditions, and no visible preventing layer.
3. Do not strengthen a crash into code execution, ordinary work into shared availability,
   or a same-principal action into privilege gain.
4. If a required fact is not source-visible or locally observable, use
   needs_validation. Name exact blockers; do not give it severity or speculative completion.
5. A missing best practice with no affected principal/resource is excluded or hardening,
   not a finding. A candidate disproved by source is not needs_validation.
6. Use the same source-derived fingerprint for the same root cause in every state.
   It must match `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$` and must not include a line,
   wave, agent, severity, or verdict.
7. Return an empty candidate array when nothing survives these gates.

## 8. Carried exclusions and peer units
No carried prior-confirmed records (first run). Peer-owned coverage IDs (do not duplicate): .github%2Fworkflows%2Fci.yml%23CI-and-deploy-scripts::deploy.sh%23remote-deploy-and-git-credentials::.::ATTACK-CLASSES.md%23Chained%20vulnerabilities%20and%20trust%20boundaries | api%2Fworker.ts%23Worker-%2Fapi%2Fv1-routes::api%2Fcore.ts%23requireAuth-requirePermission-tenant-scoping::api::ATTACK-CLASSES.md%23Access%20control | backend%2Fapp%2FConsole%2FCommands%23backup-restore-failover-purge::backend%2Fapp%2FServices%2FBackupService.php%23backup-confidentiality-and-restore::backend%2Fapp::ATTACK-CLASSES.md%23Business%20logic | backend%2Fapp%2FHttp%2FControllers%23raw-queries-orderBy-whereRaw-DB-raw::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%23query-construction::backend%2Fapp::ATTACK-CLASSES.md%23Injection | backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FIntegrationsController.php%23webhook-endpoints-and-testWebhook::backend%2Fapp%2FSupport%2FOutboundEndpoint.php%23parse::backend%2Fapp%2FServices::ATTACK-CLASSES.md%23Injection | backend%2Fapp%2FHttp%2FMiddleware%2FApiContext.php%23rate-limits-and-quotas::backend%2Fapp%2FPlugins%2FUsageMeter.php%23quota-reservation::backend%2Fapp::ATTACK-CLASSES.md%23Business%20logic | backend%2Froutes%2Fapi.php%23%2Fwebhooks%2Fai-voice-%2Fwebhooks%2Ftelegram-%2Foauth%2Ftoken-%2Fpublic%2Fforms::backend%2Fapp%2FHttp%2FControllers%2FAiVoiceWebhookController.php%23signature-and-tenant-binding::backend%2Fapp%2FHttp%2FControllers::ATTACK-CLASSES.md%23Access%20control | backend%2Froutes%2Fapi.php%23%2Fwebhooks%2Fclick-%2Fwebhooks%2Fpayme-billing-routes::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FBillingController.php%23changePlan-payInvoice-resolveProvider::backend%2Fapp%2FHttp%2FControllers::ATTACK-CLASSES.md%23Business%20logic | backend%2Froutes%2Fapi_v1.php%23ai-routes-and-telegram-assistant::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAiController.php%23complete-finalizeCall-decideApproval::backend%2Fapp%2FServices::ATTACK-CLASSES.md%23Feature%20abuse%20and%20data%20leakage | backend%2Froutes%2Fapi_v1.php%23attachments-export-reports::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FCrmExtrasController.php%23upload-download-attachments::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Resource%20and%20file%20handling | backend%2Froutes%2Fapi_v1.php%23auth-session-recovery-invite-routes::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAuthController.php%23resetPassword-acceptInvite-login::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Access%20control | backend%2Froutes%2Fapi_v1.php%23plugins-marketplace-developer-routes::backend%2Fapp%2FPlugins%2FPluginRuntime.php%23invoke::backend%2Fapp%2FPlugins::ATTACK-CLASSES.md%23Resource%20and%20file%20handling | backend%2Froutes%2Fapi_v1.php%23tenant-and-platform-routes::backend%2Fapp%2FSupport%2FH.php%23requirePermission-requirePlatform::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Access%20control | repo%23obvious-things-sweep::repo%23debug-endpoints-default-creds-error-leaks::repo::ATTACK-CLASSES.md%23Obvious%20things | repo%23wildcard-cross-cutting-review::repo%23unexpected-boundaries-and-chains::backend%2Fapp::ATTACK-CLASSES.md%23Wildcard | src%2Flib%2Fapi.ts%23SPA-api-client-and-native-session::src%2Flib%2Fnative.ts%23SecureStorage-session-and-openExternal::src::ATTACK-CLASSES.md%23Access%20control

## 9. Paths, execution policy and result contract
- Your agent_id: `h11-crypto`. Your scratch dir: /Users/zzz/security-audit-skill/nexio-crm/run-1/agents/h11-crypto/scratch (the only place you may write; you normally need none).
- EXECUTION POLICY FOR THIS RUN: **source-only**. No OS-enforced sandbox is available and php/composer are absent, so do NOT execute, build, test or run any target code, and do not use the network. Read-only inspection (Read/Grep/Glob and read-only shell like cat/grep/wc) only. Do not read or print .env files or secret values (state only that a secret exists at file:line). Consequently, because a `confirmed` record requires a bounded local observed result, you may NOT propose `confirmed`. Return strongly source-traced boundary failures as `needs_validation` with the exact blocker ("local execution not performed: no PHP runtime / no sandbox") and a precise local validation_plan (the PHPUnit/vitest-style test that would settle it) plus deployment plan if relevant. Do NOT use needs_validation for hypotheses source already refutes. Where the decisive logic is pure and fully visible in source, state the exact trace so the verifier can re-derive the result by reading. (The parent may record a source-derived trace as the evidence; the schema's observed_result requirement is why confirmed is unavailable.)
- All source paths in your result are repository-relative to "/Users/zzz/Desktop/nexio crm" (quote it, it has a space). Every assigned coverage_id must appear exactly once in "units"; each unit needs nonempty reviewed_paths and checks (method "source", artifact null, agent_id "h11-crypto"), and the unit-level reviewed_paths must equal the union of its checks' reviewed_paths. Use disposition covered / candidate / blocked per the contract.
- Candidate entries (needs_validation): `proposed_verdict: "needs_validation"` plus every required field of the schema's needs_validation branch: fingerprint, title, description, claimed_root_cause, ordered trace (entrypoint ... sink with line numbers), evidence, blockers, validation_plan.local and/or deployment. Fingerprint matches ^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$, source-derived, no line/agent/wave. Candidates must include severity? NO (needs_validation has no severity).
- Depth bound: stop each line as soon as the invariant is settled. Aim to finish within a focused pass.

## Structured hunter result

Return exactly one JSON object, with no surrounding prose:

```json
{
  "units": [
    {
      "coverage_id": "one assigned ID",
      "disposition": "covered|candidate|blocked",
      "reviewed_paths": ["repo/relative/path"],
      "checks": [
        {
          "agent_id": "canonical owner of this check",
          "reviewed_paths": ["repo/relative/path owned by this check"],
          "invariant": "specific control checked for this unit",
          "method": "source|local",
          "result": "what source or the bounded check established",
          "artifact": "agents/<agent-id>/artifacts/file for local, null for source"
        }
      ],
      "candidate_fingerprints": [],
      "unresolved": []
    }
  ],
  "candidates": [],
  "hardening": ["concrete non-finding note"],
  "uncovered": [
    {
      "surface": "...",
      "boundary": "...",
      "subsystem": "...",
      "attack_class": "...",
      "starting_paths": ["repo/relative/path"],
      "reason": "why this needs its own deterministic coverage unit"
    }
  ]
}
```

Each `candidates` entry is schema-shaped except that it uses `proposed_verdict` in place of `verdict`:

- `proposed_verdict: "confirmed"`: include every field required by the `confirmed` branch of `report-schema.json` other than `verdict`: `fingerprint`, title, description, `root_cause`, `intended_behavior`, ordered `trace`, `evidence`, `conditions`, target-neutral `execution`, `remediation`, `severity`, and `confidence`. The execution instructions describe only the bounded local check already performed. `payloads` holds the minimum test input, fixture, or native invocation. `observed_result` records actual local output. Overall severity must not exceed observed impact.
- `proposed_verdict: "needs_validation"`: include every field required by that schema branch other than `verdict`: `fingerprint`, title, description, `claimed_root_cause`, ordered `trace`, `evidence`, nonempty `blockers`, and `validation_plan` with at least one applicable `local` or `deployment` step. Do not invent an inapplicable context. Do not include severity, execution, remediation, reason, or a confirmed `root_cause`. `deployment` is an owner-observed check, not a request to probe a live target.

Every assigned coverage ID appears exactly once in `units`. A `covered` unit needs an owner, nonempty `reviewed_paths` and `checks`, no unresolved fact, and no candidate. A `candidate` unit has the same owned evidence and is the only state that carries linked fingerprints. A `blocked` unit is an owned partial review with nonempty paths, checks, and unresolved facts but no fingerprint. All source paths are repository-relative, never absolute or traversal paths. A trace with several entries begins at `entrypoint`, ends at `sink`, and labels intermediate steps `propagation`. Every check has its own canonical lowercase `agent_id` and nonempty `reviewed_paths`; the unit-level list is exactly the union of those owned paths. A `source` check uses `artifact: null`. A `local` check uses one successfully parent-promoted regular file beneath `agents/<check.agent_id>/artifacts/`; this permits a verifier to add independently owned evidence without taking ownership from the hunter. Never link scratch, an output-root file, or another check owner's artifact.



### report-schema.json (full, verbatim; use the confirmed and needs_validation branches)

```json
{
  "$comment": "Top-level contract for findings.json. validate-findings.cjs interprets and checks this schema directly.",
  "type": "array",
  "items": {
    "oneOf": [
      {
        "type": "object",
        "description": "A source-grounded vulnerability that was independently demonstrated.",
        "properties": {
          "verdict": {
            "type": "string",
            "const": "confirmed"
          },
          "fingerprint": {
            "type": "string",
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$",
            "description": "A stable source-derived identifier that does not change between validation states."
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "root_cause": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "intended_behavior": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "trace": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["entrypoint", "propagation", "sink"]
                },
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "scope": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["kind", "file", "line", "scope", "description"],
              "additionalProperties": false
            }
          },
          "evidence": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["file", "line", "description"],
              "additionalProperties": false
            }
          },
          "conditions": {
            "type": "array",
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["authentication_level", "authorization_role", "user_interaction", "system_configuration", "network_routing", "environmental_dependency", "data_state", "timing_dependency", "third_party_dependency"]
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["kind", "description"],
              "additionalProperties": false
            }
          },
          "execution": {
            "type": "object",
            "description": "Target-neutral reproduction in the target's native interface.",
            "properties": {
              "attacker_perspective": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              },
              "payloads": {
                "type": "array",
                "minItems": 1,
                "uniqueItems": true,
                "items": {
                  "type": "string"
                }
              },
              "instructions": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "observed_result": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              }
            },
            "required": ["attacker_perspective", "payloads", "instructions", "observed_result"],
            "additionalProperties": false
          },
          "remediation": {
            "type": "object",
            "properties": {
              "strategy": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              },
              "code_changes": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "file_name": {
                      "type": "string",
                      "minLength": 1
                    },
                    "fixed_code": {
                      "type": "string"
                    }
                  },
                  "required": ["file_name", "fixed_code"],
                  "additionalProperties": false
                }
              }
            },
            "required": ["strategy"],
            "additionalProperties": false
          },
          "severity": {
            "type": "object",
            "properties": {
              "likelihood": {
                "type": "object",
                "properties": {
                  "score": {
                    "type": "string",
                    "enum": ["informational", "low", "medium", "high", "critical"]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "visibleContent": true
                  }
                },
                "required": ["score", "reason"],
                "additionalProperties": false
              },
              "impact": {
                "type": "object",
                "properties": {
                  "score": {
                    "type": "string",
                    "enum": ["informational", "low", "medium", "high", "critical"]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "visibleContent": true
                  }
                },
                "required": ["score", "reason"],
                "additionalProperties": false
              },
              "overall_severity": {
                "type": "string",
                "enum": ["informational", "low", "medium", "high", "critical"]
              }
            },
            "required": ["likelihood", "impact", "overall_severity"],
            "additionalProperties": false
          },
          "confidence": {
            "type": "object",
            "properties": {
              "score": {
                "type": "string",
                "enum": ["low", "medium", "high"]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              }
            },
            "required": ["score", "reason"],
            "additionalProperties": false
          }
        },
        "required": ["verdict", "fingerprint", "title", "description", "root_cause", "intended_behavior", "trace", "evidence", "conditions", "execution", "remediation", "severity", "confidence"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "description": "A source-grounded candidate whose decisive validation is blocked.",
        "properties": {
          "verdict": {
            "type": "string",
            "const": "needs_validation"
          },
          "fingerprint": {
            "type": "string",
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "claimed_root_cause": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "trace": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["entrypoint", "propagation", "sink"]
                },
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "scope": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["kind", "file", "line", "scope", "description"],
              "additionalProperties": false
            }
          },
          "evidence": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["file", "line", "description"],
              "additionalProperties": false
            }
          },
          "blockers": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "minLength": 1,
              "visibleContent": true
            }
          },
          "validation_plan": {
            "type": "object",
            "properties": {
              "local": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              },
              "deployment": {
                "type": "string",
                "minLength": 1,
                "visibleContent": true
              }
            },
            "additionalProperties": false
          }
        },
        "required": ["verdict", "fingerprint", "title", "description", "claimed_root_cause", "trace", "evidence", "blockers", "validation_plan"],
        "additionalProperties": false
      },
      {
        "type": "object",
        "description": "A source-grounded candidate refuted during validation.",
        "properties": {
          "verdict": {
            "type": "string",
            "const": "rejected"
          },
          "fingerprint": {
            "type": "string",
            "minLength": 1,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "claimed_root_cause": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          },
          "trace": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": ["entrypoint", "propagation", "sink"]
                },
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "scope": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["kind", "file", "line", "scope", "description"],
              "additionalProperties": false
            }
          },
          "evidence": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "type": "object",
              "properties": {
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "line": {
                  "type": "integer",
                  "minimum": 1
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "visibleContent": true
                }
              },
              "required": ["file", "line", "description"],
              "additionalProperties": false
            }
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "visibleContent": true
          }
        },
        "required": ["verdict", "fingerprint", "title", "description", "claimed_root_cause", "trace", "evidence", "reason"],
        "additionalProperties": false
      }
    ]
  }
}

```
