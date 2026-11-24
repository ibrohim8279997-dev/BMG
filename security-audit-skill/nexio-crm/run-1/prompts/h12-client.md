# Hunter prompt for agent `h12-client`

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

### coverage_id: src%2Flib%2Fapi.ts%23SPA-api-client-and-native-session::src%2Flib%2Fnative.ts%23SecureStorage-session-and-openExternal::src::ATTACK-CLASSES.md%23Access%20control
- surface: src/lib/api.ts#SPA-api-client-and-native-session
- boundary: src/lib/native.ts#SecureStorage-session-and-openExternal
- subsystem: src
- attack_class: Access control
- starting_paths: src/lib/api.ts, src/lib/native.ts, src/lib/hooks.ts, src/App.tsx, src/pages, src/components, capacitor.config.ts, android/app/src/main/AndroidManifest.xml, android/app/src/main/res/xml/file_paths.xml, android/app/build.gradle, ios/App/App/Info.plist, backend/config/cors.php, docker/spa-nginx.conf, index.html
- ordinary_attack_class_block: ATTACK-CLASSES.md#Access control
- selected_companion_blocks: CLIENT-SIDE.md#Core discipline, CLIENT-SIDE.md#DOM and object-state attack classes, CLIENT-SIDE.md#Cross-origin messaging and network attack classes, CLIENT-SIDE.md#Service-worker and browser-storage attack classes, CLIENT-SIDE.md#Universal moves, CLIENT-SIDE.md#Validation rules, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Core discipline, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Deep-link, callback, and navigation attack classes, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Webview and native-bridge attack classes, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Local IPC and exported-component attack classes, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Application-state and device-lifecycle attack classes, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Universal moves, DESKTOP-MOBILE-AND-LOCAL-IPC.md#Validation rules
- excluded_blocks:
  - AI-AND-LLM.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - WEB-PROTOCOL-AND-AUTH.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - SUPPLY-CHAIN-AND-RELEASE.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - CLOUD-AND-DEPLOYMENT.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - PROTOCOLS-RPC-AND-MESSAGING.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
  - DATA-ISOLATION-AND-LIFECYCLE.md#Core discipline: companion domain not a boundary of this unit; covered by a peer unit
- parent focus hints (unverified recon leads, prove or disprove each, never assume): SPA + Capacitor: payment_url location.assign without scheme check, openExternal, X-Nexio-Session handling, CORS with credentials for localhost origins, FileProvider external-path ".", minifyEnabled false, nginx headers/CSP, route guards, XSS sinks.

## 4. Selected blocks (verbatim)

### ATTACK-CLASSES.md#Access control

**Access control** (subagent_type: `general`)
Verify that a caller cannot do something outside its authority. Go beyond checking whether permission checks exist — verify they check the *right* permission for the *right* resource via the *right* mechanism:
- Is there a path to the same state change that checks a different (weaker) permission?
- Can a field in the request body override what the permission system intended to restrict?
- Are there endpoints that gate on authentication but forget authorization?
- Does the same resource have multiple access paths with inconsistent checks?
- What about bulk/batch/export/import operations — do they enforce per-item permissions?

For complex access models, split into separate agents for auth bypass vs authorization logic.


### CLIENT-SIDE.md

## Core discipline (include in every agent prompt for this domain)

```
- A client-side candidate needs a controllable source and an executing or disclosing sink. Name both and show attacker-influenced data reaching the sink.
- The impact must reach a victim's session, another origin, or shared persistence. Self-injection and disclosure of the attacker's own data are not findings.
- Framework escaping, browser same-origin policy, CSP, COOP/CORP, service-worker scope, and modern noopener defaults are real controls. Verify them before assigning impact.
- Browser storage and caches are shared by origin and may outlive login state. Identify who writes, who reads, and which account, tenant, or worker lifecycle clears each record.
- Use `confirmed` only for complete source evidence plus bounded local browser tests. Use `needs_validation` when renderer, extension permission, deployed header, or browser-policy behavior is required but unavailable.
```


## DOM and object-state attack classes (subagent_type: `general`)

**DOM-based XSS**
Trace `location` fields, `document.referrer`, `window.name`, message data, storage, and browser-controlled document state into `innerHTML`, `outerHTML`, `document.write`, string-evaluating APIs, executable URLs, jQuery HTML APIs, or framework escape hatches. Interpolation escaped by the framework is not a finding.

**DOM clobbering**
Attacker-injected `id` or `name` attributes shadow a global, form property, configuration object, or initialization flag later trusted by code. Require both a markup path that preserves the attribute and a security-relevant use of the clobbered value.

**Prototype pollution and gadget chain**
An attacker-controlled key reaches a recursive write such as deep merge or path assignment and modifies prototype state. Then a reachable gadget consumes the polluted property to change authorization, execution, navigation, or rendering. `JSON.parse`, a shallow copy, or pollution without a gadget is not enough.


## Cross-origin messaging and network attack classes (subagent_type: `general`)

**`postMessage` origin and source trust**
A handler performs a sensitive action with `event.data` without an exact origin allowlist and, where multiple frames share an origin, the expected `event.source`. On the send side, sensitive data sent to `*` reaches an unintended embedder. Weak substring, prefix, suffix, or unanchored-regex origin matching is not an origin check.

**Cross-site WebSocket request use**
A WebSocket upgrade accepts ambient cookies from an untrusted origin without an `Origin` check or channel-specific token, allowing the victim's session to read or mutate data. Confirm both the upgrade behavior and a security-relevant message handler.

**Credentialed CORS trust**
The server reflects or weakly matches `Origin` while allowing credentials and returns sensitive responses. A bare wildcard with credentials is rejected by browsers; report only the actual reflected/allowed origin path and cross-origin data or mutation.


## Service-worker and browser-storage attack classes (subagent_type: `general`)

**Service-worker registration and scope takeover**
Attacker-influenceable content can become the registered worker script, control a path that receives an over-broad `Service-Worker-Allowed` scope, or alter update imports without integrity control. Verify the final script URL, response MIME type, origin, scope, and who controls every imported script. A normal same-origin worker with intended scope is not a defect.

**Service-worker cache and identity confusion**
The worker caches personalized responses without including account, tenant, authorization state, or request mode in its policy, then serves them after account switch or logout. Review fetch-event routing, cache names and keys, navigation fallbacks, cache cleanup, and whether error/offline paths return another user's prior response.

**Browser-storage disclosure and stale authorization**
Tokens, private responses, draft data, or authorization decisions remain in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, extension storage, or client state and become readable by another account or less-trusted same-origin component. Storage of a token alone is not a finding; require a realistic reader with less authority, or continued use after revocation/logout.

**Cross-context storage and broadcast confusion**
`storage` events, `BroadcastChannel`, shared workers, or origin-wide caches carry identity or commands between tabs without binding them to the current session. Check account switching, private/public windows, tenant changes, and stale tabs that can overwrite newer auth state.


## Universal moves (apply across the above)

- Start from DOM, navigation, worker, message, and storage sinks, then trace backward to browser-only and server-controlled sources. Record the browser policy that should stop the path.
- Test account switch, logout, worker update, offline fallback, and stale-tab state with a local test origin and dummy accounts. Do not use production users, origins, or shared services.
- For XS-Leaks, list only predicates proved by source and local browser behavior. Then identify the response headers or rendering choice that would remove the oracle.


## Validation rules (apply before reporting ANY finding here)

1. Cite the source, sink, browser policy, affected origin/session, and observable mutation or disclosure.
2. For prototype pollution, prove the recursive write and a security-relevant gadget. For DOM clobbering, prove the markup survives and the shadowed value is used.
3. For service workers and storage, prove lifecycle reachability: an attacker-controlled write or cache entry must reach a different account, tenant, or later authorization state.
4. For messaging, CORS, WebSocket, and XS-Leaks, show exact origin/source validation and the protected state or action exposed. Confirm that CSP, COOP/CORP, cookies, and SameSite policy do not already block it.
5. Return `confirmed` findings only with a complete client path and bounded local evidence. Return `needs_validation` with the precise deployed header, extension permission, browser version, or renderer behavior an owner must verify.


### DESKTOP-MOBILE-AND-LOCAL-IPC.md

## Core discipline (include in every agent prompt for this domain)

```
- Establish the realistic local or remote-content attacker: another app, another OS user, a sandboxed child, an untrusted document, or a remote origin. Self-harm within the same account and authority is not a boundary violation.
- Paths, process names, bundle/package IDs, and claimed sender fields are not peer authentication. Use OS peer credentials, code identity, capability handles, or protected channel state.
- The native bridge or helper must authorize each operation and final resource after parsing. A trusted UI or broker does not make attacker-influenceable arguments trusted.
- OS sandbox, signing, entitlements, permissions, keychain ACLs, exported-component policy, and prompt behavior are real controls when pinned and visible.
- Use `confirmed` for source evidence plus bounded local/emulator tests. Use `needs_validation` when signing, manifest merge, OS version, device policy, installer ACL, or packaging is required but not observable.
```


## Deep-link, callback, and navigation attack classes (subagent_type: `general`)

**Custom-scheme and deep-link ambiguity**
Another app or page can invoke a route that mutates state, imports data, completes authentication, or selects an account without a current-session and one-time callback binding. Review URI normalization, duplicate query fields, scheme/host/path matching, exported activity/handler policy, and stale/replayed links.

**App and account handoff confusion**
OAuth, SSO, magic-link, invite, device pairing, passwordless, or payment callbacks return to the wrong installed app, profile, tenant, or pending transaction. Bind state to the initiating app identity, current session, account, provider, operation, and expiry.

**File-open and intent authority confusion**
An associated file, share intent, drag/drop item, pasteboard/clipboard record, notification action, or open-file event triggers a privileged operation without confirming content type, sender trust where applicable, current user intent, and final target.


## Webview and native-bridge attack classes (subagent_type: `general`)

**Navigation-origin to bridge confusion**
Remote or attacker-controlled frames can reach a JavaScript/native bridge intended only for packaged content. Validate origin at call time and after every navigation, redirect, subframe creation, popup, and error/fallback page. URL-prefix checks and initial-load checks are insufficient.

**Over-broad native bridge capabilities**
Web content can select arbitrary files, commands, IPC methods, credentials, or system actions through a generic bridge. Check method allowlists, normalized arguments, user/tenant authority, gesture/confirmation requirements, and return-value disclosure.

**Webview file and universal access**
Remote content can read app-local files, privileged custom schemes, or internal origins because file access, universal access, mixed content, debug interfaces, or custom protocol handlers join origins unexpectedly. Missing a restrictive setting without reachable protected content is hardening.


## Local IPC and exported-component attack classes (subagent_type: `general`)

**IPC peer-authentication gaps**
Unix sockets, named pipes, XPC, Binder, D-Bus, native messaging, RPC, shared memory, or loopback listeners accept a lower-trust peer without checking OS credentials, code identity, sandbox token, or channel ownership. Require a meaningful method or disclosure behind the channel.

**Claimed principal versus channel identity**
The authenticated process/channel belongs to one app or user, but request fields select another user, tenant, profile, or capability. Bind each method and resource to the peer credential rather than a caller-declared identifier.

**Exported service, activity, receiver, or provider overreach**
A mobile component or local automation endpoint is externally invokable and performs an operation intended for the app itself. Review final merged manifests, intent filters, permission/signature level, path grants, and alternate aliases. Manifest status unknown after packaging requires `needs_validation`.

**IPC lifecycle and correlation confusion**
Predictable request IDs, reused handles, stale channels, inherited descriptors, world-writable socket paths, or restart behavior lets one peer answer, cancel, or reuse another peer's operation. Review creation permissions and cleanup of socket files, locks, ports, and shared mappings.


## Application-state and device-lifecycle attack classes (subagent_type: `general`)

**Account switch, logout, and device restore leakage**
Cached data, background tasks, widgets, notifications, local databases, webview storage, or biometric approvals survive logout/account change and appear under a later account. Review backup/restore and multi-profile behavior.

**Pending-action and user-presence confusion**
Notification, widget, shortcut, share sheet, biometric prompt, or deferred operation authorizes a different action than displayed, executes after expiry, or uses another profile's pending state. Bind confirmation to normalized action, resource, account, and current foreground state.


## Universal moves (apply across the above)

- Enumerate every process, app component, local endpoint, URI scheme, file association, webview origin, and helper. Record OS identity, runtime privilege, caller, and callable operation.
- Read final packaging inputs: merged manifest, entitlements, installer rules, native-messaging registration, protocol handlers, and ACL creation. Source declarations can be overwritten downstream.
- Validate with dummy profiles and non-sensitive local fixtures on an isolated machine/emulator. Do not interact with other users' apps, credentials, or production services.


## Validation rules (apply before reporting ANY finding here)

1. Name the attacker starting capability, OS/app principal crossed, entry channel, accepted argument or state, and unauthorized operation or disclosure.
2. Confirm OS sandbox, peer credential, signing, entitlement, permission, user-consent, and installer controls that apply. Unknown packaging/runtime facts require `needs_validation`.
3. For webview bridges, cite both navigation/origin control and privileged native sink. For IPC, cite peer authentication and per-resource authorization. For helpers, verify final normalized destination.
4. Keep local tests bounded and use dummy content/accounts. Stop after proving the boundary result; do not extend proof into persistence or broader system modification.
5. Return `confirmed` only with a complete source and local evidence chain. Return `needs_validation` with the exact OS, manifest, signing, ACL, or device-lifecycle fact required.


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
No carried prior-confirmed records (first run). Peer-owned coverage IDs (do not duplicate): .github%2Fworkflows%2Fci.yml%23CI-and-deploy-scripts::deploy.sh%23remote-deploy-and-git-credentials::.::ATTACK-CLASSES.md%23Chained%20vulnerabilities%20and%20trust%20boundaries | api%2Fworker.ts%23Worker-%2Fapi%2Fv1-routes::api%2Fcore.ts%23requireAuth-requirePermission-tenant-scoping::api::ATTACK-CLASSES.md%23Access%20control | backend%2Fapp%2FConsole%2FCommands%23backup-restore-failover-purge::backend%2Fapp%2FServices%2FBackupService.php%23backup-confidentiality-and-restore::backend%2Fapp::ATTACK-CLASSES.md%23Business%20logic | backend%2Fapp%2FHttp%2FControllers%23raw-queries-orderBy-whereRaw-DB-raw::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%23query-construction::backend%2Fapp::ATTACK-CLASSES.md%23Injection | backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAuthController.php%23tokens-hashes-secrets::backend%2Fapp%2FSupport%2FH.php%23password-hashing-and-token-generation::backend%2Fapp::ATTACK-CLASSES.md%23Cryptography%20and%20secrets | backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FIntegrationsController.php%23webhook-endpoints-and-testWebhook::backend%2Fapp%2FSupport%2FOutboundEndpoint.php%23parse::backend%2Fapp%2FServices::ATTACK-CLASSES.md%23Injection | backend%2Fapp%2FHttp%2FMiddleware%2FApiContext.php%23rate-limits-and-quotas::backend%2Fapp%2FPlugins%2FUsageMeter.php%23quota-reservation::backend%2Fapp::ATTACK-CLASSES.md%23Business%20logic | backend%2Froutes%2Fapi.php%23%2Fwebhooks%2Fai-voice-%2Fwebhooks%2Ftelegram-%2Foauth%2Ftoken-%2Fpublic%2Fforms::backend%2Fapp%2FHttp%2FControllers%2FAiVoiceWebhookController.php%23signature-and-tenant-binding::backend%2Fapp%2FHttp%2FControllers::ATTACK-CLASSES.md%23Access%20control | backend%2Froutes%2Fapi.php%23%2Fwebhooks%2Fclick-%2Fwebhooks%2Fpayme-billing-routes::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FBillingController.php%23changePlan-payInvoice-resolveProvider::backend%2Fapp%2FHttp%2FControllers::ATTACK-CLASSES.md%23Business%20logic | backend%2Froutes%2Fapi_v1.php%23ai-routes-and-telegram-assistant::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAiController.php%23complete-finalizeCall-decideApproval::backend%2Fapp%2FServices::ATTACK-CLASSES.md%23Feature%20abuse%20and%20data%20leakage | backend%2Froutes%2Fapi_v1.php%23attachments-export-reports::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FCrmExtrasController.php%23upload-download-attachments::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Resource%20and%20file%20handling | backend%2Froutes%2Fapi_v1.php%23auth-session-recovery-invite-routes::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1%2FAuthController.php%23resetPassword-acceptInvite-login::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Access%20control | backend%2Froutes%2Fapi_v1.php%23plugins-marketplace-developer-routes::backend%2Fapp%2FPlugins%2FPluginRuntime.php%23invoke::backend%2Fapp%2FPlugins::ATTACK-CLASSES.md%23Resource%20and%20file%20handling | backend%2Froutes%2Fapi_v1.php%23tenant-and-platform-routes::backend%2Fapp%2FSupport%2FH.php%23requirePermission-requirePlatform::backend%2Fapp%2FHttp%2FControllers%2FApi%2FV1::ATTACK-CLASSES.md%23Access%20control | repo%23obvious-things-sweep::repo%23debug-endpoints-default-creds-error-leaks::repo::ATTACK-CLASSES.md%23Obvious%20things | repo%23wildcard-cross-cutting-review::repo%23unexpected-boundaries-and-chains::backend%2Fapp::ATTACK-CLASSES.md%23Wildcard

## 9. Paths, execution policy and result contract
- Your agent_id: `h12-client`. Your scratch dir: /Users/zzz/security-audit-skill/nexio-crm/run-1/agents/h12-client/scratch (the only place you may write; you normally need none).
- EXECUTION POLICY FOR THIS RUN: **source-only**. No OS-enforced sandbox is available and php/composer are absent, so do NOT execute, build, test or run any target code, and do not use the network. Read-only inspection (Read/Grep/Glob and read-only shell like cat/grep/wc) only. Do not read or print .env files or secret values (state only that a secret exists at file:line). Consequently, because a `confirmed` record requires a bounded local observed result, you may NOT propose `confirmed`. Return strongly source-traced boundary failures as `needs_validation` with the exact blocker ("local execution not performed: no PHP runtime / no sandbox") and a precise local validation_plan (the PHPUnit/vitest-style test that would settle it) plus deployment plan if relevant. Do NOT use needs_validation for hypotheses source already refutes. Where the decisive logic is pure and fully visible in source, state the exact trace so the verifier can re-derive the result by reading. (The parent may record a source-derived trace as the evidence; the schema's observed_result requirement is why confirmed is unavailable.)
- All source paths in your result are repository-relative to "/Users/zzz/Desktop/nexio crm" (quote it, it has a space). Every assigned coverage_id must appear exactly once in "units"; each unit needs nonempty reviewed_paths and checks (method "source", artifact null, agent_id "h12-client"), and the unit-level reviewed_paths must equal the union of its checks' reviewed_paths. Use disposition covered / candidate / blocked per the contract.
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
