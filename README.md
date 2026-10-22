# vitalwatch-node

Node.js reporter for [VitalWatch Hub](https://github.com/CestnyTR/vitalwatch-hub): server
errors, SSR errors, slow requests.

No dependencies. No build step. Node 18.17+.

---

## Scope — and why it is this narrow

This package covers **the server side only**. Browser errors are collected by `t.js`, which
is served by the hub, and that file was deliberately not moved to npm:

| | Browser (`t.js`) | Node (this package) |
|---|---|---|
| Distribution | Served by the hub | npm |
| Updates | **Reach every site within 5 minutes**, nobody deploys | `npm update` in each project |
| Why | Central updates are worth more than package ergonomics | A script tag cannot run on the server — no hosted option |

On the Node side a package is **required**, and being a package rather than a copied file is
also deliberate: copied files never get updated, and that happens **silently**. This project
hit exactly that kind of bug — a flaw in duration measurement and a session ID leaking
through error messages — and the fix reached every project only because the package could
be updated.

---

## Installation

```bash
npm install vitalwatch-node
```

In `.env` — the same variable names as the Laravel package:

```env
VITALWATCH_ENABLED=true
VITALWATCH_URL=https://vitalwatch.example.com
VITALWATCH_KEY=project-key
VITALWATCH_SECRET=<64-character secret from the panel>
VITALWATCH_ENV=production
```

### Verify the installation

```bash
npx vitalwatch-status
```

Do not skip this step. The package's most expensive failure mode is silently not working:
if the secret was copied incompletely, nothing crashes and nothing is logged — the hub
answers an invalid signature with `204` as well. An installation can be broken for months,
and that silence gets mistaken for "all good".

```bash
npx vitalwatch-status --test         # a real test event — shows up in the panel as an error
npx vitalwatch-status --vitalwatch   # liveness request only — no error in the panel
```

`--test` is the right choice when verifying a single installation: transport and scrubbing
are exercised together and the event is visible in the panel. **In an update loop that walks
dozens of installations, use `--vitalwatch`** — `--test` would leave dozens of fake errors in
the panel, i.e. the monitoring tool producing its own noise.

Whether data actually arrives can only be confirmed **in the hub panel**: the connection
status on the project row should read `Connected`. The command cannot tell on its
own, because the hub gives valid and invalid signatures the same response.

The command also shows:

- **Release tag** and where it was found (see [Release tag](#release-tag)).
- **Latest version:** the newest version on npm (`registry.npmjs.org`, 2-second timeout).
  If it is newer than the installed one, it prints the warning
  `Update available: npm install vitalwatch-node@latest`. This is a
  warning only and does not change the exit code; if npm is unreachable it prints
  `could not check`, which is not a failure either.
  `VITALWATCH_STATUS_OFFLINE=1` skips the check entirely. The check runs **only in this
  command** — the monitored application never sends any request to npm at runtime.

---

## Quick setup recipe

This section is intentionally step-by-step and complete: it can be handed as-is to an AI
assistant or a teammate. Order matters.

**Prerequisite:** the project must exist in the VitalWatch panel; the key and secret come
from there. If the browser side will be set up too, an **origin** must be added to the
project — events from an unregistered origin are silently rejected.

```bash
# 1. Install the package
npm install vitalwatch-node
```

```env
# 2. .env — in the project root. The package reads this file itself; it does not
#    wait for the framework to load it (it would not be loaded yet during preload).
#    DO NOT add a NEXT_PUBLIC_ / NUXT_PUBLIC_ PREFIX to these names —
#    that prefix bakes the value into the browser bundle and leaks the secret.
VITALWATCH_ENABLED=true
VITALWATCH_URL=https://vitalwatch.example.com
VITALWATCH_KEY=project-key
VITALWATCH_SECRET=64-character-secret
VITALWATCH_ENV=production
```

```js
// 3. One line wherever the process is started. With PM2, in the ecosystem file:
module.exports = {
    apps: [{
        name: 'my-app',
        script: 'server.js',
        env: {
            NODE_OPTIONS: '--require vitalwatch-node/auto',
        },
    }],
};
```

```bash
# 4. Restart — --update-env is REQUIRED.
#    Without it PM2 keeps the old environment, NODE_OPTIONS never reaches the
#    process and the installation silently does nothing.
pm2 restart my-app --update-env

# 5. Verify
npx vitalwatch-status
npx vitalwatch-status --test
```

The last step sends a test event to the hub. **Confirm in the panel:** the connection status
on the project row should read `Connected`. The command cannot tell on its own —
the hub gives valid and invalid signatures the same response.

### What gets touched, what does not

| | Where |
|---|---|
| Package | `package.json` (npm install) |
| Settings | `.env` |
| Loading | Wherever the process starts — PM2 config, systemd unit or start command |
| **Application source** | **Untouched** |

`NODE_OPTIONS` cannot go into the application's own `.env` file: Node reads it when the
process starts, while `.env` is read after the application is already running. That is a
Node constraint, not a design choice. It applies **to this line only** — the
`VITALWATCH_*` variables can live in `.env`, the package reads that file itself.

Precedence: `process.env` > `.env.<NODE_ENV>` > `.env.local` > `.env`. The process
environment always wins; files only fill the gaps. Only keys starting with `VITALWATCH_`
are read.

### What this recipe does not cover

- **SSR render errors that Next catches internally.** These need `instrumentation.js`
  (below).
- **Browser errors.** Those are collected by `t.js`, served by the hub; a `<script>` tag has
  to be added to the HTML. The package does not inject it automatically, and should not:
  rewriting the response body breaks `Content-Length`, breaks streaming SSR and conflicts
  with compression.
- **Class and stack of errors the framework catches internally.** The zero-code setup only
  sees "HTTP 500"; for the error itself, add a [framework adapter](#framework-adapters) —
  a single line for most of them.

---

## Usage

### Zero-code setup (recommended)

**Without adding a single line to the application source:** you tell Node to load the
package before the application, and the hooks are installed there.

```
NODE_OPTIONS=--require vitalwatch-node/auto
```

With PM2:

```js
// ecosystem.config.cjs
module.exports = {
    apps: [{
        name: 'my-app',
        script: 'server.js',
        env: {
            NODE_OPTIONS: '--require vitalwatch-node/auto',
        },
    }],
};
```

This line **cannot go into the application's own `.env` file**: `NODE_OPTIONS` is read when
Node starts, the application's `.env` only after it is running. That is a Node constraint,
not a design choice. Every other setting (key, secret, thresholds, on/off) is read from
`.env`.

Covers: uncaught exceptions, unhandled promise rejections, 5xx responses, slow requests —
everything that goes through `node:http`: Next, Express, Nuxt/Nitro, Fastify, plain Node.

The route is derived from the raw URL: only segments that look like identifiers are replaced
(`/products/1042` → `/products/{id}`, UUID → `{uuid}`, long hex → `{hash}`); readable
segments stay as they are (`/games/earthquake-kit`) — so the panel shows which page broke.

Two trade-offs:

- **For errors the framework catches, only the status code is visible.** Frameworks such as
  Nuxt, Fastify and Nest catch the error themselves and turn it into a 500; the error itself
  never reaches the `node:http` layer. For class and stack, add a
  [framework adapter](#framework-adapters).
- **Next's `onRequestError` hook is not installed.** Some SSR render errors are caught by
  Next and never reach `node:http`; those need the `instrumentation.js` below.

### Next.js (SSR)

SSR errors never reach the browser — neither `t.js` nor an error boundary can see them.
Without this hook the SSR layer is completely blind.

```js
// instrumentation.js  (project root)
export async function register() {
    const { hookProcess } = await import('vitalwatch-node');
    hookProcess();
}

// Next 15+
export { nextOnRequestError as onRequestError } from 'vitalwatch-node';
```

Next 14 has no `onRequestError`; there only `register()` runs and uncaught exceptions are
collected.

### Express

```js
const { express: vitalwatch } = require('vitalwatch-node');

app.use(vitalwatch());          // BEFORE the routes — for timing
// ... routes ...
app.use(vitalwatch.errors());   // error middleware LAST
```

`vitalwatch.errors()` does **not swallow** the error; it passes it down the chain with
`next(error)`, so the application's own error page keeps working.

Errors carrying a 4xx status (`status` / `statusCode` 400–499) are not sent — validation and
not-found errors are not failures. An error without a status code counts as a server error
and is sent.

### Framework adapters

Added **on top of** the zero-code setup. They send the error the framework catches
internally, with its class and stack. 4xx (404, validation, authorization) is not sent.

**One failure, one record** — only for adapters with access to the response object: Express
`errors()`, Nuxt/Nitro, Fastify, Koa, Hono (Node) and NestJS (HTTP). These mark the response,
so the zero-code setup does not open a separate "HTTP 500" for the same request.

**SvelteKit, React Router / Remix and Next produce two records.** These hooks only expose
the web `Request`, not the Node response object, so no mark can be set. If the zero-code
setup is also loaded, one failure opens two rows in the panel: an `exception` with a stack
and an `http_5xx` without one. Without the zero-code setup, only the `exception` is sent.

The status code is read **from the error** (`status`, `statusCode`, `getStatus()` in Nest).
If the application turns an error without a status code into a 4xx in its own handler
(Fastify `setErrorHandler`, a Nest exception filter, a custom Express error middleware),
that error **is still sent** — the adapter cannot know in advance what the handler will
decide. To suppress it, put the code on the error (`statusCode: 422`) or add the class to
`ignore`.

**Nuxt 3/4** — one line, no extra file:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ['vitalwatch-node/nuxt'],
});
```

Covers server routes (`server/api`), SSR page errors and render errors caught inside
`<NuxtErrorBoundary>`. The module goes into the server bundle only; browser errors are
`t.js`'s job.

**Plain Nitro** (including Analog and SolidStart):

```ts
// server/plugins/vitalwatch.ts
import vitalwatch from 'vitalwatch-node/nitro';
export default defineNitroPlugin(vitalwatch);
```

**Fastify:**

```js
const { fastify: vitalwatch } = require('vitalwatch-node');
app.register(vitalwatch);   // before the routes; nested scopes are covered too
```

**Koa:**

```js
const { koa: vitalwatch } = require('vitalwatch-node');
vitalwatch(app);
```

Koa's own error logging is preserved: Koa only installs it when nobody listens for
`error`, so if we are the only listener, the default is called explicitly.

**Hono:**

```js
import { hono as vitalwatch } from 'vitalwatch-node';
app.use(vitalwatch());
```

`app.onError` is not used — it holds a single handler and would override the application's.

Supported runtimes: **Node (`@hono/node-server`) and Bun.** Cloudflare Workers and other
edge runtimes are not supported: the package uses `node:fs` and `node:crypto` (which do not
load on Workers without `nodejs_compat`), and sending is not awaited with `waitUntil` — the
runtime may cut it off after the response is returned and the event is silently lost. On Bun
the zero-code setup does not measure anything because `node:http` is not used; the adapter
still sends the error.

**NestJS:**

```ts
import { nest as vitalwatch } from 'vitalwatch-node';
app.useGlobalInterceptors(vitalwatch());
```

An interceptor, not a filter: it sees the error and rethrows it unchanged, leaving the
application's own exception filters and error response untouched.

Non-HTTP contexts: in microservice (`rpc`) and WebSocket (`ws`) handlers, `RpcException` /
`WsException` and their subclasses are not sent — they are business errors returned to the
client, not failures; since they carry no status code, the name is checked. Other errors
(TypeError, database) are sent without a route. In GraphQL, 4xx `HttpException`s are
filtered out by status code and the rest are sent. Errors thrown in guards and middleware
never reach the interceptor.

**SvelteKit** — `src/hooks.server.js`:

```js
import { sveltekit as vitalwatch } from 'vitalwatch-node';
export const handleError = vitalwatch();
// an existing handler is wrapped and its return value preserved:
// export const handleError = vitalwatch(({ error }) => ({ message: 'Error' }));
```

**React Router 7 / Remix** — `app/entry.server.tsx`:

```ts
import { reactRouter as vitalwatch } from 'vitalwatch-node';
export const handleError = vitalwatch();
```

Requests aborted because the visitor left the page are not sent.

For **Express**, `vitalwatch.errors()` above does the same job; for **Next**,
`instrumentation.js`.

### Manual reporting

```js
const { report } = require('vitalwatch-node');

try {
    await riskyWork();
} catch (error) {
    report(error);          // no await needed, completes in the background
    throw error;            // the error is NOT swallowed
}
```

An application reporting from its own Express error handler should pass `res` as well:

```js
app.use((err, req, res, next) => {
    if (status >= 500) report(err, { route, method: req.method, res });
    // ...
});
```

Without `res`, the timing middleware opens a separate stack-less "HTTP 500" for the same
request and one failure shows up as two records in the panel. `res` is not sent to the hub;
it is only used for marking.

The mark is set only if the error will actually be sent. For an ignored class (`ignore`), a
disabled reporter, or an error object already reported (a single module-level error thrown
on every request), the response is not marked and the timing middleware's "HTTP 500" remains
the only trace.

---

## What it collects

- Uncaught exceptions and unhandled promise rejections
- SSR render errors (Next 15+, Nuxt, SvelteKit, React Router — via adapter)
- Errors the framework catches internally, with class and stack (via adapter)
- Requests returning 5xx
- Slow requests above the threshold (default 1000 ms)

## Worker and child process crashes

`hookProcess()` only hooks the main thread. An error thrown inside a **worker thread** does
not reach the main thread as an exception — it lands on the worker object's `error` event and,
if nobody listens, leaves no trace. The same goes for child processes started with `fork()`.

The hook is installed on the parent side, not in the worker's own file: the application
writes that file, and remembering to call the package in every worker would be required.

Captured:

- Uncaught error in a worker / child process (`error` event)
- Non-zero exit code — dying without an error event

One crash produces one record: an uncaught error fires `error` and then `exit`, and the
second is dropped. The error is **not swallowed** — an `error` event without a listener is
still thrown to the main thread by Node and is reported from there as `uncaughtException` too.

**`spawn` and `exec` are out of scope.** A non-zero exit code is routine for external
commands — `grep` returns 1 when nothing matches — and counting it as an error would flood
the panel with meaningless records. The distinction is made via the IPC channel: `fork()`
always opens one, `spawn` does not.

### Why the prototype is patched

The first implementation replaced the `Worker` class with a subclass, and **it did not
work**: application modules copy the reference at load time with
`const { Worker } = require('node:worker_threads')`, so every module loaded before us kept the
unpatched version. The hook was silently disabled — the most expensive failure mode for a
monitoring package.

`prototype.emit` does not have this problem: all instances share the same prototype,
regardless of which reference created them. It was also verified that the hook works
independently of load order.

---

## Liveness heartbeat

Every eight hours the package sends the hub a small request **that carries no events**.

The reason: the hub used to infer whether an installation was working only from incoming
errors. That backfired — an application running without errors sent no events and was
reported as "installation may not be working". Being healthy was penalized.

Now the request itself is the proof. As long as heartbeats arrive, the hub knows the
installation is up; when they stop, what it reports is actually true.

| | |
|---|---|
| Interval | 8 hours |
| Body | `{"events": []}` — carries no measurements |
| Endpoint | Same endpoint as events, no extra address |
| First request | As soon as the process starts — an installation proves itself right after deploy |

The interval is one third of the hub's 24-hour silence threshold. If they were equal, a
single missed request — a deploy, a restart, a brief network outage — would make the
installation look broken. Three rounds of margin tolerate two misses.

The timer is `unref`'d: it does not keep a short-lived script alive, and a process that has
finished its work exits normally.

It starts automatically when `hookProcess()` is called — the zero-code setup, Next
`instrumentation.ts` and the Express recipes all call it already. To manage it manually:

```js
const { startHeartbeat, stopHeartbeat } = require('vitalwatch-node');

startHeartbeat();          // default 8 hours
startHeartbeat(3600_000);  // or your own interval (ms)
stopHeartbeat();
```

Nothing is sent while `VITALWATCH_ENABLED=false` or when configuration is incomplete.

## What it does not collect

These cannot be enabled even through configuration — there is no code for them:

- IP address
- User-Agent
- Request body / form data
- Query string **values** (only the path is kept)
- Session data, cookies
- Raw SQL literal values

Before messages and stack traces are sent, email addresses, Turkish national ID numbers,
phone numbers, IBANs, card numbers and long random strings (session IDs, API keys) are
masked. SQL literal values are replaced with `?` — both for privacy compliance (KVKK) and for
grouping: the same query run with different parameters ends up under one fingerprint.

---

## Behavior guarantees — non-negotiable

The package must **never affect** the application it is installed in:

1. **Errors are never swallowed.** The handler chain is preserved, `throw` is not blocked,
   the process is not terminated.
2. **It never reports its own errors.** Infinite-loop risk; all SDK code is wrapped in
   `try/catch`.
3. **It never delays the user's request.** Sending happens after the response is returned,
   with a short timeout (2 s by default).
4. **If the hub is unreachable, it gives up silently.** No errors, log noise or slowdown in
   the monitored application.
5. **Nothing is sent while `VITALWATCH_ENABLED=false`.**
6. **The heartbeat does not keep the process alive.** The timer is `unref`'d; a script that
   has finished its work exits.

> A monitoring package breaking the application it monitors is a bigger problem than the
> one it solves.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VITALWATCH_ENABLED` | `true` | If `false`, nothing is sent |
| `VITALWATCH_URL` | — | Hub address |
| `VITALWATCH_KEY` | — | Project key from the panel |
| `VITALWATCH_SECRET` | — | 64 characters. **Server-side only** |
| `VITALWATCH_ENV` | `NODE_ENV` | `production` · `staging` · `local`. Aliases are mapped: `prod`/`live` → production, `stage`/`stg`/`preprod`/`uat` → staging, `dev`/`development`/`test`/`testing` → local. The hub rejects unrecognized values; the diagnostic command reports an error |
| `VITALWATCH_RELEASE` | automatic | Release tag (commit sha, tag). Detected when empty, see [Release tag](#release-tag) |
| `VITALWATCH_TIMEOUT` | `2000` | Send timeout in **ms**. Values below 100 are treated as seconds (`2` → 2000 ms) — the Laravel and Python packages expect seconds under the same name. The result is clamped to 100–10000 ms; invalid, zero or negative values fall back to 2000. The rule is the same across all packages |
| `VITALWATCH_SLOW_REQUEST_MS` | `1000` | Requests taking longer than this are considered slow |

Can also be set in code:

```js
const { init } = require('vitalwatch-node');

init({ url: '...', key: '...', secret: '...', ignore: ['NotFoundError'] });
```

`init({ timeout })` follows the same rule as `VITALWATCH_TIMEOUT`: `init({ timeout: 50 })`
means 50 seconds, not 50 ms, and is clamped to 10000 ms.

### Release tag

`VITALWATCH_RELEASE` was set in almost no project, so the hub could not say "this error
started after deploy X". The tag is now resolved once at startup, in this order (same rule
as the Laravel and Python packages):

1. `VITALWATCH_RELEASE` — trimmed, at most 64 characters, used as-is.
2. The first non-empty CI/PaaS variable: `GIT_COMMIT`, `GIT_SHA`, `COMMIT_SHA`,
   `SOURCE_VERSION`, `VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `HEROKU_SLUG_COMMIT`,
   `CI_COMMIT_SHA`. If it looks like a sha (7–40 hex), the first 12 characters lowercased;
   otherwise at most 64 characters.
3. `.git` in the application root (`process.cwd()`): `HEAD` → branch ref file, falling back
   to `packed-refs`; a detached HEAD is the sha itself. If `.git` is a file (worktree,
   submodule), its `gitdir:` is followed. Only a valid 40-character sha is accepted; first
   12 characters.
4. If none of these exist, no tag is sent.

On our servers deploys are a `git pull`, so `.git` is in place and most installations need
no configuration. The `git` binary is never run (no child process); only a few small files
are read synchronously at startup, and it never throws.

When the process restarts after a deploy, the new sha is read. If it does not restart, the
old code is still running in memory — and the old sha is the **correct** tag in that case.

`init({ release })` overrides everything. `npx vitalwatch-status` shows the tag with its
source: `Release tag        a1b2c3d4e5f6 (source: .git)` — the source is
`VITALWATCH_RELEASE`, the CI/PaaS variable name or `.git`; with no tag found it prints
`not set (source: none)`.

---

## Bulk update

To update every Node project on the same server in one go:

```bash
for d in /var/www/*/; do
  [ -d "$d/node_modules/vitalwatch-node" ] || continue
  echo "→ $d"
  (cd "$d" && npm install vitalwatch-node@latest && npx vitalwatch-status)
done
```

`npm install @latest`, **not** `npm update`: below 1.0, the range `^0.2.1` means
`>=0.2.1 <0.3.0`, and `npm update` deliberately skips minor bumps. That is exactly what
happened on a real installation — the command said "up to date", the package stayed on the
old version and nobody noticed.

The last step is deliberate: it verifies the configuration is still valid after the update.
An installation that breaks silently is more dangerous than one never installed.

Which project runs which version is **also visible in the panel** — the package sends
`sdk_version` with every event. Updates are targeted, not blind.

---

## Development

```bash
npm test        # node:test, no dependencies
```

Dependency policy: **as few dependencies as possible.** This package is installed in 8
projects; every dependency is a version-conflict risk. That is why the types are
hand-written rather than generated — no build toolchain was added.

## License

MIT
