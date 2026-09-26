# GL Portal — Federal Bank gold loan collateral verification (frontend)

A 3-column, AI-guided single-page app (navigation rail · verification dashboard · Verification
Agent chat) that walks a branch assessor through gold-loan collateral verification, built to the
ShellKode TDD v3.0 and styled in the Federal Bank identity. `/login` is the way in; everything else
is behind the sign-in guard.

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

0. **Sign in** — `/login` (branded split screen, demo accounts listed on the page). The session is an
   HttpOnly cookie; the rail's avatar shows who is signed in and holds **Sign out**.
1. **Customer** — enter the customer's **mobile number** (chat or welcome screen; the welcome screen
   also lists the CBS customers as chips). Only the customer and KYC (masked) load from CBS; nothing
   is pledged yet.
2. **Collateral photos** — lay the ornaments out on a plain surface and upload or webcam-capture up to
   3 photos per upload. The Collateral Validator checks the capture and **lists every ornament it can
   see**, cropping a thumbnail for each; that list *is* the pledged inventory. Rename, add or remove
   rows as needed — a re-capture replaces the list until weighing starts.
3. **Weight & purity** — upload the **weighing-machine photo** with everything on the pan. The agent
   reads the total off the display *and splits it across the pledge list*, so every ornament arrives
   with a weight and a one-phrase reason ("thick curb chain, heaviest chain"); the shares always add
   up to the display total. Each is marked **AI** until the assessor confirms it — correcting one in
   the table needs no justification, changing it again does. Then fetch the purity: one CaratMeter
   request for the loan application returns an assay per ornament, graded against the valuation table
   and cross-checked against each ornament's weight. Findings can be re-assayed or accepted with a
   justification. The **Pledge valuation** card shows the amount per ornament and in total (gross
   value → LTV margin → damage deduction → pledge).
4. **Damage** — one close-up per damaged ornament with its **damage percentage**, which reduces that
   item's pledge amount. The Damage Detector compares the recorded damage with the photo and rates
   severity; items are analysed in parallel.
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
app/                      layout (Titillium Web), page, /login, /report/[sessionId]
components/
  auth/                   SignInForm (the /login screen), RequireAuth guard
  shell/                  AppShell, NavRail (account menu + sign out), TopBar, Federal Bank wordmark
  providers/              AuthProvider — signed-in staff; VerificationProvider — session controller (start, steps over SSE, overrides, restore)
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
