---
name: e2e
scope: binwak
version: 0.1.0
description: >-
  Drive and verify uni-app mp-weixin UI changes through the WeChat DevTools
  simulator via @dcloudio/uni-automator (Jest). Use when you need to run e2e /
  visual-regression tests, capture real-runtime screenshots to confirm a UI
  change, or diagnose the recurring "wx.$$initRuntimeAutomator not exists" /
  "stuck at RUNS" failures. Covers the non-obvious gotchas that cost hours:
  compile mode, the trust-project popup, the logged-in data-drift trap, the
  9420 port deadlock, and the throwaway-screenshot verification pattern.
---

# WeChat Mini-Program E2E Verification (uni-automator)

Hard-won operational knowledge for verifying `mp-weixin` UI changes against the
**real** WeChat DevTools runtime. The framework is `@dcloudio/uni-automator`
driven by Jest. `program` and `uni`/`wx` are injected as globals inside tests.

> Context this was distilled from: a uni-app project (`client/`) whose unit
> tests run in Vitest (`*.test.ts`) and whose e2e/visual tests run in Jest
> (`*.e2e.ts`) against DevTools. Paths below are relative to the client root.

---

## TL;DR — the 5 things that actually matter

1. **`compile: true` is mandatory** in `jest.e2e.config.js`. A plain
   `uni build -p mp-weixin` does **not** inject the runtime hook
   `wx.$$initRuntimeAutomator`; only letting the automator compile (it runs
   `dev:mp-weixin` under the hood) injects it. With `compile: false` + a
   prebuilt bundle every run dies with `wx.$$initRuntimeAutomator not exists`.
2. **The 3-second "trust this project / allow automation" popup** will time out
   if a human can't click it, and the runtime never initialises → same error.
   Pass `--trust-project` to `cli auto`, or keep an already-authorised IDE open.
3. **The e2e runtime is usually LOGGED IN.** Server board state overwrites any
   `seedFixtures()` local data via the sync roundtrip, so seeded fixtures
   **drift** (grid size, titles, completed cells, date-based titles change run
   to run). Do **not** trust visual-snapshot pixel equality for data-dependent
   regions; assert on **structure/status text** instead, or capture a screenshot and
   read it yourself.
4. **Port 9420 deadlocks.** DevTools is left running after a suite
   (`teardown: 'disconnect'`) and a group of processes shares a user-data-dir
   lock. The `pretest:e2e:mp` hook (`node tests/e2e/free-port.js 9420`)
   `cli quit`s the whole app then SIGKILLs stragglers. If you bypass `npm run`,
   you must free the port yourself.
5. **To visually confirm a change, write a throwaway `_tmp_*.e2e.ts`** that
   drives the UI and `fs.writeFileSync('/tmp/shot.png', ...)`, then view the PNG.
   Delete it after. This is the only reliable way to "see" the real runtime.

---

## Standard run commands

```bash
# Full e2e suite (automator compiles + launches DevTools itself)
npm run test:e2e:mp

# A single spec (substring match on filename)
npm run test:e2e:mp -- visual.e2e
npm run test:e2e:mp -- interactions.e2e

# Update visual-regression baselines (jest-image-snapshot)
npm run test:e2e:mp -- visual.e2e -u

# H5 variant (needs a static server on :8847 first)
npm run test:e2e:h5
```

Prerequisites (one-time):
- WeChat DevTools → **Settings → Security Settings → enable "Service Port"**, IDE logged in.
- CLI path defaults to
  `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`; override with
  `WX_CLI_PATH=/path/to/cli`.

The `test:e2e:*` scripts already clear proxy env vars
(`NO_PROXY=127.0.0.1,localhost`, empty `HTTP_PROXY`/`ALL_PROXY`/…). A global
proxy (V2Ray etc.) otherwise hijacks `127.0.0.1:9420` and the run **stalls at
`RUNS`**.

---

## jest.e2e.config.js — the load-bearing options

```js
testEnvironmentOptions: {
  compile: true,                 // REQUIRED — see TL;DR #1
  'mp-weixin': {
    port: 9420,
    launch: true,                // runner cold-boots DevTools
    args: ['--trust-project'],   // skip the trust popup (see TL;DR #2)
    teardown: 'disconnect',      // leave IDE open after run (→ port stays held)
    projectPath: path.resolve(__dirname, 'dist/build/mp-weixin'),
    executablePath: WX_CLI,      // WX_CLI_PATH || default CLI path
  },
}
```

Notes:
- `compile: true` makes the automator run the dev compiler, so **no manual
  `npm run build:mp-weixin` is needed** before e2e.
- E2e is **local-only** in this project (CI runs unit tests + a prod build, not
  this suite).

---

## Failure playbook

### `Error: wx.$$initRuntimeAutomator not exists`
The mini-program runtime started but the automator hook was never registered.
Causes, in order of likelihood:
1. **`compile: false`** + prebuilt bundle. Set `compile: true`. Verify the hook
   exists in a compiled bundle:
   ```bash
   grep -c initRuntimeAutomator dist/build/mp-weixin/common/vendor.js   # want >= 1
   ```
   (A plain `uni build` yields `0` — that's the bug.)
2. **Trust popup timed out.** Add `--trust-project` to `args`, or open the
   project in DevTools and authorise once, keeping it open.
3. **Stale DevTools compile cache** serving a pre-hook build. Clear it:
   ```bash
   # Note: WeChat DevTools' own macOS app-support folder is literally named
   # in Chinese ("微信开发者工具") — that's the real on-disk name, not a
   # translation choice.
   rm -rf ~/Library/Application\ Support/微信开发者工具/*/WeappCache/WeappCompileCache/*
   ```

### Hangs forever at `RUNS` (no timeout fires)
Leftover DevTools holds port 9420; the second instance can't bind it. Fix:
```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli quit   # close whole app
# then confirm + SIGKILL stragglers by LITERAL pid (never pkill/killall):
lsof -ti:9420            # → prints pid(s) if still held
kill 12345              # use the literal number(s) printed above
```
`npm run test:e2e:mp` does this automatically via `pretest:e2e:mp`
(`tests/e2e/free-port.js 9420`). Only do it by hand when invoking `jest`
directly.

### Simulator window opens then crashes (simulator crash)
Seen on some machines right after the automation window opens; surfaces as the
same `$$initRuntimeAutomator` error. Try `--disable-gpu` in `args`. If it still
crashes, the IDE itself is wedged — quit it fully (see above) and relaunch from
a clean state; sometimes a human must open the project once in the GUI.

### Visual snapshot fails but you "didn't change that area"
The board grid is **server-synced for the logged-in test account** and drifts
(grid size, words, completed marks, date-based title). The header/layout you
changed is stable; the grid pixels are not. Don't chase it with `-u` blindly —
confirm the real diff by viewing the regenerated PNG. Prefer asserting on
DOM structure / status text over full-frame pixels for data-dependent screens.

---

## Verification patterns

### Pattern A — assert on structure, not pixels (durable)
```ts
const dropdown = await page.$('.board-dropdown')
expect(dropdown).toBeTruthy()
const actions = await page.$$('.dropdown-action')
expect(actions.length).toBeGreaterThanOrEqual(4)
```

### Pattern B — throwaway screenshot to /tmp, then view it (to actually SEE it)
Create `tests/e2e/_tmp_shot.e2e.ts`:
```ts
import { gotoMain, seedFixtures } from './helpers'
import * as fs from 'fs'
declare const program: any

describe('tmp shot', () => {
  let page: any
  beforeAll(async () => { await seedFixtures(); page = await gotoMain() }, 120000)
  it('captures UI', async () => {
    // ...drive the UI (tap, open dropdown, etc.)...
    const b64 = await program.screenshot()
    fs.writeFileSync('/tmp/shot.png', Buffer.from(b64, 'base64'))
    // optionally also dump text you care about:
    const el = await page.$('.progress-status')
    fs.writeFileSync('/tmp/shot.txt', el ? await el.text() : '(none)')
    expect(true).toBe(true)
  })
})
```
Run it, view `/tmp/shot.png`, read `/tmp/shot.txt`, then **delete the temp spec
and the /tmp files**:
```bash
npm run test:e2e:mp -- _tmp_shot.e2e
rm -f tests/e2e/_tmp_shot.e2e.ts /tmp/shot.png /tmp/shot.txt
```

### Pattern C — read state text instead of eyeballing
`program.screenshot()` returns base64; `el.text()` returns rendered text. For
logic you can verify deterministically, prefer reading text (e.g. a progress
label `5/7` and a status label like `In Progress`) over visual comparison.

---

## Driving real interactions

- **Selectors:** use `page.$('.cls')` / `page.$$('.cls')`; mp-weixin automator is
  **unreliable with dynamically-bound `#id`s** — prefer `.class` + index, e.g.
  `(await page.$$('.cell'))[3].tap()`.
- **Navigation:** enter the home shell with `gotoMain()` (seeds the onboarding
  flag and `reLaunch`s). Switch tabs with `switchTab(page, idx)` (0=Challenge,
  1=Plaza, 2=Profile) — it taps the real `.tab-item`.
- **Native ActionSheet** (e.g. cell completion goes through
  `uni.showActionSheet`): you can't click native popups, so mock them:
  ```ts
  await mockActionSheet(1)      // resolve with tapIndex 1
  // ...drive the flow...
  await restoreActionSheet()
  ```
- **Settling time:** after `reLaunch`/tab switch, `await page.waitFor(800..2500)`;
  mp-weixin needs generous waits or `$`/`$$` returns null.
- **Plaza list** comes from `/api/templates` which is offline in tests — mock it
  with `mockPlazaTemplates()` before switching to the tab, `restore` after.

---

## Visual-regression baselines (jest-image-snapshot)

- Baselines live in `tests/e2e/__image_snapshots__/tab-*.png` and are committed.
- Tolerance (SSIM + ~2% threshold) absorbs antialiasing; a sub-1% icon change may
  **not** trigger an update — delete the PNG and rerun with `-u` to force a fresh
  capture when you need to inspect a small change.
- Determinism: `seedFixtures()` writes fixed local storage, BUT see TL;DR #3 —
  on a logged-in runtime the server overwrites it. Truly reproducible baselines
  require an offline/no-login path; until then, treat data-dependent regions as
  noisy.

---

## Hygiene / safety

- **Always clean up**: delete `_tmp_*.e2e.ts` and any `/tmp/*.png|*.txt` you
  created; never commit them.
- **Process killing**: only ever `kill <literal-pid>` (look it up first with
  `lsof -ti:9420` or `ps ... | awk '{print $2}'`). Never `pkill`/`killall`/
  `kill $VAR` — those trip safety guardrails and abort the turn.
- **No giant one-liners**: prefer short inspect → act → verify steps over dense
  `&&`-chains with nested quotes; they can be flagged as suspicious.
- Don't leave a `dev:mp-weixin` watcher running in the background while doing
  `launch: true` e2e runs — it can interfere with the IDE session.

---

## One-glance cheat sheet

| Symptom | Root cause | Fix |
|---|---|---|
| `wx.$$initRuntimeAutomator not exists` | hook not in bundle | `compile: true`; verify `grep -c initRuntimeAutomator …/vendor.js` |
| same error, bundle has hook | trust popup / stale cache | `--trust-project`; clear `WeappCompileCache/*` |
| stuck at `RUNS` | port 9420 held / proxy hijack | `cli quit` + free 9420; scripts clear proxy env |
| simulator crash | GPU render crash | `--disable-gpu`; relaunch clean |
| snapshot diff in untouched area | logged-in server data drift | assert structure/text, not pixels |
| can't see a small UI change | snapshot tolerance | throwaway `_tmp` spec → `/tmp/shot.png` → view |
