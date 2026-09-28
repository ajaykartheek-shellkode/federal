# GL Portal — Federal Bank gold loan originating system (frontend)

An AI-guided app that walks a branch assessor through originating a gold loan — collateral to
maximum loan amount — built to the ShellKode TDD v3.0 and styled in the Federal Bank identity. `/login` is the way in; everything
else is behind the sign-in guard.

It runs the same journey on two shapes of screen, from one codebase:

* **Desktop (≥1180px, the `desk:` breakpoint)** — three columns: navigation rail · verification
  dashboard · Verification Agent chat.
* **Phone and tablet (below it)** — one column with **Verify** and **Agent** as bottom tabs, the
  current step's primary action pinned above them, and the rail folded into a slide-over menu. The
  pledge list becomes one card per ornament (a seven-column table can't shrink), every dialog rises
  as a bottom sheet, and **Capture** hands off to the phone's own camera app rather than the
  desktop webcam viewfinder. The A4 report is scaled to fit whole, like a PDF preview, with
  Download PDF one tap away.

The phone is the natural device here: three of the five steps are photographs taken at the counter.
Camera capture needs a secure origin, so it works on HTTPS (or `localhost`) and is disabled with an
explanation on a plain-HTTP deployment.

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
2. **Collateral photos** — lay the ornaments out on a plain surface and upload or capture up to
   3 photos per upload. The Collateral Validator checks the capture and **lists every ornament it can
   see**, cropping a thumbnail for each; that list *is* the pledged inventory. Rename, add or remove
   rows as needed — a re-capture replaces the list until weighing starts. A capture you are re-taking
   can be **removed**, and the ornaments only it produced go with it (anything already weighed stays).
3. **Weight & purity** — upload the **weighing-machine photo** with everything on the pan. The agent
   reads the **gross weight** off the display *and splits it across the pledge list*, so every ornament
   arrives with a weight; the shares always add up to the display total. Each is marked **AI** until
   the assessor confirms it — correcting one in the table needs no justification, changing it again
   does. The three tiles are **Gross weight → Wastage (a fixed %) → Net weight**. Then fetch the
   purity: one **Karatometer** request for the loan application returns an assay per ornament, graded
   and cross-checked against that ornament's weight. Findings can be re-assayed or accepted with a
   justification.
4. **Damage** — the damaged ornament, the type and the severity; a close-up is **optional**, and one
   recorded without a photo is still carried into the report. The Damage Detector compares the
   recorded damage with any photo and rates severity; items are analysed in parallel. Damage is
   documented for the approving officer and never reduces the loan amount.
5. **Documents** — ID proof (image or multi-page PDF) with its type. The Document Verifier checks
   legibility/completeness and cross-verifies name, ID number and address against CBS. **A mismatch
   blocks the process** — in alert mode as well as blocker mode — until the right proof is uploaded
   or an officer overrides it with a justification.
5b. **Loan valuation** — its own step. First capture **loan type** (ODA/LAA/CCA) → **loan category**
   (GGL/KGL/IGL) → **scheme name**; the grid is filtered as you go and says plainly when a pair has
   no scheme configured. The scheme's per-gram rate then prices the net weight: gross weight → less
   wastage → net weight → × rate → **Max loan amount**. The step cannot be passed without a scheme.
6. **Report** — PROCEED / REVIEW recommendation with reasons, weight & loan valuation, audit trail and
   e-signatures from the **customer**, the branch assessor and the authorising officer. Once the
   customer has signed, **Submit** records the signatures and marks the verification submitted.
   **Download PDF** saves the server-generated A4 file; **Print** uses the browser
   (`/report/<sessionId>` is the shareable printable page).

Every step streams its real processing steps into the chat ("Agent executing"). In **alert mode**
findings are advisory; in **blocker mode** unusable captures, unsighted items and undocumented CBS
damage must be fixed or overridden. Scenarios with AI validation switched off record captures for
manual verification without calling the model.

Other views: **Reports** (7-day outcomes, by date, by loan account — with thumbnails and failure
reasons), **History** (reopen any past verification), **Settings** (AI per scenario, enforcement
mode, thresholds, the wastage and scheme grid, purity grades per material and weight/purity tolerances).

**Going back.** Every completed step in the stepper is a button: it opens a confirmation listing what
that step produced and will discard, then rewinds, tells the agent, and writes an audit entry. On a
phone the same control sits under the progress bar. Removing a collateral photo rewinds to the
capture and takes its ornaments, weights and assay with it. A submitted verification is locked.

Deep links: `/?session=<id>` reopens a verification, `/?view=reports|history|settings` opens a view.

## Structure

```
app/                      layout (Titillium Web), page, /login, /report/[sessionId]
components/
  auth/                   SignInForm (the /login screen), RequireAuth guard
  shell/                  AppShell (picks the layout), MobileShell (tabs + menu), NavRail (account menu + sign out), TopBar, Federal Bank wordmark
  providers/              AuthProvider — signed-in staff; VerificationProvider — session controller (start, steps over SSE, overrides, restore)
  chat/                   ChatPanel, ExecCard (live agent steps), Messages, ActionBar
  verify/                 dashboard cards: stepper, customer header, photos, weight & purity, inventory, pledge valuation, documents, report summary, audit
  dialogs/                collateral / damage / document uploads, camera capture, override & edit, scale reading, remove photo, go back, lightbox
  report/                 printable ReportDocument, ScaledPage (fits A4 to a phone), overlay, signature pads
  views/                  Reports, History, Settings
  ui/                     design-system primitives (Button, Badge, Card, Dialog, Field, Thumb, Toasts…)
lib/                      api client + SSE parser, types, reducer, intents, formatting, safe rich text, motion presets, useMediaQuery
```

## Theme

Federal Bank palette — royal blue `#004E96`, amber `#FAA619`, navy `#082461`, cream `#FFF6E7` —
with Titillium Web, soft blue-tinted shadows and generous radii. Tokens live in `tailwind.config.ts`.
Motion uses one easing vocabulary (`lib/motion.ts`) and respects `prefers-reduced-motion`.
