// Interprets free-typed chat replies so the assessor can drive the flow conversationally.
// Only short, unambiguous commands trigger workflow actions ("no damage", "continue",
// "generate report"); anything longer or hedged ("no wait, the chain has a crack") is sent
// to the agent as a question, because leaving a step or generating the report can't be undone.

import type { SessionView } from "./types";

export type Intent =
  | { kind: "start"; account: string }
  | { kind: "need-account" }
  | { kind: "open"; dialog: "collateral" | "damage" | "document" }
  | { kind: "step"; action: "continue" | "report" | "measure" }
  | { kind: "show-items" }
  | { kind: "ask"; question: string };

const ACCOUNT = /^[A-Za-z]{0,4}\d[\w-]{5,}$/;

/** Lower-case, strip trailing punctuation and politeness so "Continue, please!" === "continue". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!,]+/g, " ")
    .replace(/\b(please|pls|thanks|thank you)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const oneOf = (phrases: string[]) => new RegExp(`^(${phrases.join("|")})$`);

const CONTINUE = oneOf(["continue", "proceed", "next", "next step", "move on", "go ahead", "done", "ok continue", "yes continue", "continue to documents"]);
const NO_DAMAGE = oneOf(["no", "nope", "none", "no damage", "no damages", "nothing damaged", "not damaged", "skip", "skip damage", "no damaged items"]);
const YES_DAMAGE = oneOf(["yes", "yeah", "yep", "yes there is", "yes damaged", "there is damage", "record damage", "add damage", "damaged"]);
const REPORT = oneOf(["generate report", "generate the report", "create report", "create the report", "report", "yes generate", "yes generate report"]);
const UPLOAD_PHOTOS = oneOf(["upload", "upload photos", "upload photo", "add photos", "add photo", "take photo", "capture", "upload collateral", "upload collateral photos"]);
const SHOW_ITEMS = oneOf([
  "show pledged items", "show the pledged items", "show pledged inventory", "show the pledged inventory",
  "show inventory", "show the inventory", "show items", "show the items", "show ornaments", "show the ornaments",
  "pledged items", "pledged inventory", "pledged details", "show pledged details", "show the pledged details",
  "inventory", "items", "list items", "list the items", "show details", "show the details", "show collateral details",
]);
const MEASURE = oneOf(["measure", "weigh", "weigh items", "fetch readings", "fetch", "get readings", "caratmeter", "carat meter", "measure weight", "measure purity", "re-measure", "remeasure", "measure again"]);
const UPLOAD_DOCS = oneOf(["upload", "upload document", "upload documents", "upload aadhaar", "add document", "upload id", "upload id proof", "upload kyc"]);

export function parseIntent(raw: string, session: SessionView | null): Intent {
  const text = raw.trim();
  if (!session) {
    const compact = text.replace(/\s+/g, "");
    return ACCOUNT.test(compact) ? { kind: "start", account: compact } : { kind: "need-account" };
  }

  const t = normalize(text);
  const can = (action: string) => session.allowed_actions.includes(action as never);

  // Available at every step: bring the pledged inventory table on screen.
  if (SHOW_ITEMS.test(t)) return { kind: "show-items" };

  switch (session.workflow_state) {
    case "collateral":
      if (UPLOAD_PHOTOS.test(t)) return { kind: "open", dialog: "collateral" };
      if (CONTINUE.test(t) && can("continue")) return { kind: "step", action: "continue" };
      break;
    case "weight":
      if (MEASURE.test(t) && can("measure")) return { kind: "step", action: "measure" };
      if (CONTINUE.test(t) && can("continue")) return { kind: "step", action: "continue" };
      break;
    case "damage":
      if (YES_DAMAGE.test(t)) return { kind: "open", dialog: "damage" };
      if (NO_DAMAGE.test(t) || CONTINUE.test(t)) return { kind: "step", action: "continue" };
      break;
    case "valuation":
      if (YES_DAMAGE.test(t)) return { kind: "open", dialog: "damage" };
      if (CONTINUE.test(t) && can("continue")) return { kind: "step", action: "continue" };
      break;
    case "document":
      if (UPLOAD_DOCS.test(t)) return { kind: "open", dialog: "document" };
      if (CONTINUE.test(t) && can("continue")) return { kind: "step", action: "continue" };
      break;
    case "report":
      if (REPORT.test(t)) return { kind: "step", action: "report" };
      if (UPLOAD_DOCS.test(t)) return { kind: "open", dialog: "document" };
      break;
  }
  return { kind: "ask", question: text };
}
