# Implementation Brief: v0.3 P0 — Close the Release Blockers

## Instructions to the implementing model

Work in the existing `hris-reconcile` repository. This brief covers **only** the
P0 section of `open_tasks.md`: five defects found in the v0.3 review that block a
release. Every one is small, local, and independently verifiable. Do not start P1
or P2 work.

Where this brief states a decision, implement that decision. Where it marks a
judgement call, make the call and record it in a one-line comment. Section 6
lists the commands your work will be verified against; all of them must pass.

---

## 1. Context

`hris-reconcile` reconciles real payroll and HR master data on corporate
devices. v0.3 replaced Streamlit with a standard-library loopback HTTP server
(`src/hris_reconcile/ui/server.py`), an in-memory session
(`ui/session.py`), framework-free endpoint functions (`ui/api.py`), and a
`sys.addaudithook` network tripwire (`src/hris_reconcile/security.py`).

The governing security rule, from the product owner:

> Data handled by the tool must be no more exposed than the same file sitting in
> the user's Downloads folder.

The governing design rule:

> Never create a copy the user did not ask for, and never open a channel the
> file did not already have.

A second, equally binding rule applies to this particular batch of work:
**every claim the README makes about the security properties must be exactly
true of the code.** Task 1 exists because one currently is not.

Machine compromise, IT/EDR/DLP inspection, and OneDrive syncing of files the
user chose to save are out of scope — they apply equally to the baseline file.

## 2. Do not touch

These are complete and correct. Changing them fails review:

- `src/hris_reconcile/reconciliation/`, `identity/`, `mapping/`,
  `normalization/`, `config/`, `adapters/`, `reporting/`, `cli.py`
- `src/hris_reconcile/ui/profiling.py`, `suggestions.py`, `mapping_analysis.py`,
  `results_analysis.py`, `contract_builder.py`, `csv_upload.py`
- the seven domain test modules at the top level of `tests/`

If you believe one needs a change, stop and say why rather than changing it.

Files in scope: `src/hris_reconcile/security.py`,
`src/hris_reconcile/ui/server.py`, `src/hris_reconcile/ui/api.py`,
`src/hris_reconcile/ui/static/app.js`, `src/hris_reconcile/__init__.py`,
`pyproject.toml`, `README.md`, `tests/ui/test_security.py`,
`tests/ui/test_api.py`.

---

## 3. The five tasks

### Task 1 — Widen the network tripwire beyond `socket.connect`

`security.py:_network_audit_hook` inspects only the `socket.connect` audit
event. Two bypasses were confirmed by probe during the review:

- `socket.sendto` delivered 23 bytes to a non-loopback address with the hook
  installed;
- `socket.getaddrinfo` issues a DNS query that leaves the host.

`README.md:241` claims the hook "hard-aborts if code attempts a non-loopback
connection", which is wider than what the code does. **Close the gap in the
code** rather than narrowing the sentence. Severity is low under the agreed
threat model — a dependency phoning home would use TCP, which *is* caught — but
claim accuracy is the point of the product.

Handle these events in addition to `socket.connect`: `socket.sendto`,
`socket.sendmsg`, `socket.getaddrinfo`.

**Argument shapes, verified by probe on this platform — do not re-derive:**

| event | args |
| --- | --- |
| `socket.connect` | `(socket, address)` |
| `socket.sendto` | `(socket, address)` |
| `socket.sendmsg` | `(socket, address)` |
| `socket.getaddrinfo` | `(host: str, port, family, type, proto)` |

So `sendto`/`sendmsg` reuse the existing tuple-address path, but `getaddrinfo`
passes a **bare host string** and needs its own branch. Allow `getaddrinfo` for
loopback literals and `localhost`; abort for anything else. A `sendmsg` on a
connected socket may pass `None` as the address — that is not a new destination,
so allow it, and comment why.

Pitfall to check, not assume: `http.server.HTTPServer.server_bind` calls
`socket.getfqdn(host)`, which can trigger a name lookup at startup. Confirm the
server still starts under the widened hook and that `hris-reconcile-ui` still
opens; if a legitimate startup lookup is caught, resolve it by allowing that
specific loopback lookup, never by weakening the rule for external hosts.

### Task 2 — Make `_is_loopback_address` deny by default

`security.py:14` returns `True` (allow) for any non-tuple address. This was
probed and is **not** currently reachable — CPython rejects list addresses for
`AF_INET` — but a security control must fail closed. Invert it: unknown address
shapes are denied. Keep the existing `AF_UNIX` exemption in the hook, which is a
deliberate allow rather than an unknown shape.

### Task 3 — Cap the upload body size

`server.py:_read_body` (around line 120) reads `Content-Length` bytes with no
limit. A mis-selected multi-gigabyte file gives an OOM or a silent hang rather
than an error. This ships to non-technical users, so the failure mode matters
more than the exotic-ness of the input.

- Add a module-level named constant for the cap. **64 MiB** unless you can
  justify otherwise in a comment; a CSV payroll extract is far below it.
- Reject on the declared `Content-Length` *before* reading any bytes.
- Respond `413 Request Entity Too Large` with the same JSON error envelope the
  rest of the API uses — `{"error": "..."}` — carrying a message a payroll
  analyst can act on. Name the limit in the message. Do not leak a stack trace.
- The current `_read_body` raises `ValueError`, which `_dispatch_api` maps to
  `400`. Introduce a distinct exception so the `413` is not swallowed into the
  `400` branch.
- The handler is `protocol_version = "HTTP/1.1"` with keep-alive. Rejecting
  without draining the body desynchronises the connection: send
  `Connection: close` on the 413 and close it. `_bytes` already accepts
  `extra_headers`.
- `app.js:showError` (line 25) already surfaces `payload.error` from a failed
  response — confirm the 413 message reaches the user through that path, and fix
  it there if it does not.

### Task 4 — Bump the version to 0.3.0

`src/hris_reconcile/__init__.py:3` and `pyproject.toml:7` both still say
`0.2.0` while the README documents 0.3. `__version__` is embedded as
`engine_version` in every JSON report, so reports from this build misidentify
their own engine. Installed venv metadata already says `0.3.0`, so the bump was
made and reverted at some point — make it stick, in both files.

### Task 5 — Two minor consistency fixes

- `api.py:337-338` writes `session.contract` / `session.result` outside the lock
  that every other mutation in `session.py` holds. Harmless for a single user,
  inconsistent under `ThreadingHTTPServer`. Move the write behind the session
  lock, following the pattern of the `set_*` methods in `session.py` — prefer
  adding a `Session` method over reaching into the fields from `api.py`.
- `README.md`: note that the documented macOS sandbox profile
  (`deny network-outbound`, around line 269) denies loopback outbound too, and
  works only because the server is inbound-only. This prevents a confusing
  failure if that ever changes.

---

## 4. Tests to add

Extend `tests/ui/test_security.py` and `tests/ui/test_api.py`; match the style
already there (`running_server`, subprocess probes for the audit hook).

- The tripwire aborts on `socket.sendto` to a non-loopback address, and on
  `socket.getaddrinfo` for an external hostname. Use the existing subprocess
  pattern and assert `returncode == 70`. Use `192.0.2.1` (TEST-NET-1) and a
  `.invalid` hostname so no test ever emits a real packet or DNS query.
- Loopback stays permitted: `getaddrinfo("localhost", ...)` and a loopback
  connect both still exit `0`.
- `_is_loopback_address` denies a non-tuple address.
- An upload whose `Content-Length` exceeds the cap gets `413` with a JSON
  `error` key, and no `Access-Control-Allow-Origin` header — the existing tests
  assert the absence of CORS headers everywhere and that must stay true.
- An upload just under the cap still succeeds. Do not allocate 64 MiB of real
  payload to prove the boundary; construct the case so the test stays fast.

The existing 84 tests must stay green **unchanged**. If one needs editing,
that is a signal you changed behaviour beyond this brief — stop and explain.

## 5. Constraints that stay true

- No disk writes: no uploaded bytes, dataset, contract, or result is written to
  disk at any point. No cache, no temp file, no session file.
- No new dependencies. Runtime stays `pydantic`, `PyYAML`, `typer`, `rich`.
  Standard library only for everything in this brief.
- No CDN, no remote fonts, no external assets in `static/`. The security tests
  assert this.
- No CORS headers of any kind, on any response, including the new 413.
- Summary views stay counts-only; raw values appear only in analyst-requested
  drill-downs and downloads.

## 6. Acceptance criteria

All of these must pass, from the repository root:

```
ruff check .
ruff format --check .
mypy --strict src tests
pytest
```

Plus, verified by hand and reported in your summary:

1. `hris-reconcile-ui` still launches, opens the browser, and completes a full
   reconciliation end to end under the widened tripwire.
2. The CLI (`hris-reconcile run ...`) is unaffected.
3. A generated JSON report now carries `engine_version: "0.3.0"`.
4. Every security sentence in `README.md` is true of the code as it now stands
   — re-read the security section against your diff and say that you did.

## 7. Out of scope

Do not start on: `console=False` and the terminal-window removal, the macOS
`.app` bundle, the quit button or heartbeat, the Windows build, code signing,
the UI/UX redesign, or any P3 feature. Several of those are blocked on hardware
and certificates that are not available; the rest are the next work unit, not
this one.

## 8. Report back

A short summary listing, per task: what changed, which file, and how you
verified it. Flag anything you found that the review missed, and anything you
chose not to do with the reason.
