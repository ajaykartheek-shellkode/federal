# GL Portal — Federal Bank gold loan collateral verification (frontend)

A 3-column, AI-guided single-page app (navigation rail · verification dashboard · Verification
Agent chat) that walks a branch assessor through gold-loan collateral verification, built to the
ShellKode TDD v3.0 and styled in the Federal Bank identity.

Runs on **:3001** and proxies `/api/*` to the FastAPI backend on **:8000**, so AWS credentials
never reach the browser.

## Run

```bash
cd ../backend && ./.venv/bin/uvicorn main:app --reload --port 8000   # API
npm install
npm run dev          # http://localhost:3001
# quality gates
npm run typecheck && npm run lint && npm run build
```

`BACKEND_ORIGIN` overrides the API origin used by the proxy (default `http://localhost:8000`).

## The flow

1. **Account** — enter a loan account number (chat or welcome screen). CBS details, KYC (masked) and the
   pledged inventory load; CBS-declared damage is flagged.
2. **Collateral photos** — place the ornaments on the weighing scale and upload or webcam-capture up
   to 3 photos per upload. The Collateral Validator checks clarity, visibility, cropping, obstruction,
   foreign objects and background, reads the scale display, matches each detected item to a CBS row
   and crops a thumbnail. Unsighted items can be re-captured or confirmed with a justified override;
   an unreadable scale reading can be entered or corrected (audited).
3. **Weight & purity** — fetch readings from the CaratMeter: net weight and XRF fineness per item,
   graded against the valuation table and compared with CBS; the scale reading is reconciled with the
   measured total. Differences can be re-measured or accepted with a justification. The **Pledge
   valuation** card shows the amount per item and in total (gross value → LTV margin → damage
   deduction → pledge).
4. **Damage** — one close-up per damaged item (pre-filled from CBS). The Damage Detector compares the
   recorded damage with the photo and rates severity; items are analysed in parallel.
5. **Documents** — ID proof (image or multi-page PDF) with its type. The Document Verifier checks
   legibility/completeness and cross-verifies name, ID number and address against CBS.
6. **Report** — PROCEED / REVIEW recommendation with reasons, weight & pledge valuation, audit trail
   and e-signatures. **Download PDF** saves the server-generated A4 file; **Print** uses the browser
   (`/report/<sessionId>` is the shareable printable page).

Every step streams its real processing steps into the chat ("Agent executing"). In **alert mode**
findings are advisory; in **blocker mode** unusable captures, unsighted items and undocumented CBS
damage must be fixed or overridden. Scenarios with AI validation switched off record captures for
manual verification without calling the model.

Other views: **Reports** (7-day outcomes, by date, by loan account — with thumbnails and failure
reasons), **History** (reopen any past verification), **Settings** (AI per scenario, enforcement
mode, thresholds, pledge valuation per material, weight/purity tolerances and the damage rule).

Deep links: `/?session=<id>` reopens a verification, `/?view=reports|history|settings` opens a view.

## Structure

```
app/                      layout (Titillium Web), page, /report/[sessionId]
components/
  shell/                  AppShell, NavRail, TopBar, Federal Bank wordmark
  providers/              VerificationProvider — session controller (start, steps over SSE, overrides, restore)
  chat/                   ChatPanel, ExecCard (live agent steps), Messages, ActionBar
  verify/                 dashboard cards: stepper, customer header, photos, weight & purity, inventory, pledge valuation, documents, report summary, audit
  dialogs/                collateral / damage / document uploads, camera capture, override & edit, scale reading, lightbox
  report/                 printable ReportDocument, overlay, signature pads
  views/                  Reports, History, Settings
  ui/                     design-system primitives (Button, Badge, Card, Dialog, Field, Thumb, Toasts…)
lib/                      api client + SSE parser, types, reducer, intents, formatting, safe rich text, motion presets
```

## Theme

Federal Bank palette — royal blue `#004E96`, amber `#FAA619`, navy `#082461`, cream `#FFF6E7` —
with Titillium Web, soft blue-tinted shadows and generous radii. Tokens live in `tailwind.config.ts`.
Motion uses one easing vocabulary (`lib/motion.ts`) and respects `prefers-reduced-motion`.
