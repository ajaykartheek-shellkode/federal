// Client state for the SPA. The server's SessionView is the single source of truth for the
// verification itself; this store only adds UI concerns (chat timeline, live exec cards,
// dialogs, toasts, busy state).

import type { OverrideTarget } from "./api";
import type { ExecDoneEvent, ExecStepEvent, SampleAccount, SessionView } from "./types";

export type NavView = "verify" | "reports" | "history" | "settings";

export type ChatItem =
  | { id: string; kind: "bot"; html: string; at: string; animate: boolean; samples?: SampleAccount[] }
  | { id: string; kind: "user"; text: string; at: string }
  | { id: string; kind: "exec"; runId: string; at: string }
  | { id: string; kind: "notice"; level: "info" | "warn" | "error"; text: string; at: string };

export interface ExecRun {
  runId: string;
  agent: string;
  total: number;
  steps: ExecStepEvent[];
  done?: ExecDoneEvent;
}

export type { OverrideTarget };

export type DialogState =
  | { kind: "collateral" }
  | { kind: "damage"; ornamentId?: string }
  | { kind: "document" }
  | { kind: "override"; target: OverrideTarget; ref: string }
  | { kind: "edit"; ref: string }
  | { kind: "scale" }
  | { kind: "lightbox"; src: string; title: string; contentType?: string; caption?: string }
  | { kind: "report" }
  | { kind: "new-session" };

export interface Toast {
  id: string;
  tone: "ok" | "warn" | "bad" | "info";
  text: string;
}

export type Busy = null | "start" | "step" | "mutate" | "restore";

export interface AppState {
  view: NavView;
  session: SessionView | null;
  messages: ChatItem[];
  runs: Record<string, ExecRun>;
  busy: Busy;
  /** A free-typed question is being answered (never blocks the workflow or other controls). */
  answering: boolean;
  dialog: DialogState | null;
  toasts: Toast[];
}

export const initialState: AppState = {
  view: "verify",
  session: null,
  messages: [],
  runs: {},
  busy: null,
  answering: false,
  dialog: null,
  toasts: [],
};

export type Action =
  | { type: "view"; view: NavView }
  | { type: "session"; session: SessionView | null }
  | { type: "busy"; busy: Busy }
  | { type: "answering"; value: boolean }
  | { type: "bot"; html: string; animate?: boolean; samples?: SampleAccount[] }
  | { type: "user"; text: string }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | { type: "exec-step"; event: ExecStepEvent }
  | { type: "exec-done"; event: ExecDoneEvent }
  | { type: "fail-open-runs" }
  | { type: "dialog"; dialog: DialogState | null }
  | { type: "toast"; toast: Omit<Toast, "id"> }
  | { type: "dismiss-toast"; id: string }
  | { type: "reset"; keepView?: boolean };

let seq = 0;
export const uid = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const now = () => new Date().toISOString();

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "view":
      return { ...state, view: action.view };

    case "session":
      return { ...state, session: action.session };

    case "busy":
      return { ...state, busy: action.busy };

    case "answering":
      return { ...state, answering: action.value };

    case "bot":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: uid("bot"), kind: "bot", html: action.html, at: now(), animate: action.animate ?? true, samples: action.samples },
        ],
      };

    case "user":
      return { ...state, messages: [...state.messages, { id: uid("user"), kind: "user", text: action.text, at: now() }] };

    case "notice":
      return {
        ...state,
        messages: [...state.messages, { id: uid("notice"), kind: "notice", level: action.level, text: action.text, at: now() }],
      };

    case "exec-step": {
      const e = action.event;
      const existing = state.runs[e.run_id];
      const run: ExecRun = existing
        ? { ...existing, steps: [...existing.steps] }
        : { runId: e.run_id, agent: e.agent, total: e.total, steps: [] };
      const idx = run.steps.findIndex((s) => s.index === e.index);
      if (idx >= 0) run.steps[idx] = e;
      else run.steps = [...run.steps, e].sort((a, b) => a.index - b.index);
      const messages = existing
        ? state.messages
        : [...state.messages, { id: uid("exec"), kind: "exec" as const, runId: e.run_id, at: now() }];
      return { ...state, runs: { ...state.runs, [e.run_id]: run }, messages };
    }

    case "exec-done": {
      const run = state.runs[action.event.run_id];
      if (!run) return state;
      return { ...state, runs: { ...state.runs, [run.runId]: { ...run, done: action.event } } };
    }

    case "fail-open-runs": {
      // A stream ended without completing: close any spinning cards so the UI never looks busy forever.
      const runs = { ...state.runs };
      for (const run of Object.values(runs)) {
        if (!run.done) {
          runs[run.runId] = {
            ...run,
            steps: run.steps.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)),
            done: { run_id: run.runId, agent: run.agent, status: "error", summary: "Interrupted — the step did not finish", total_ms: 0 },
          };
        }
      }
      return { ...state, runs };
    }

    case "dialog":
      return { ...state, dialog: action.dialog };

    case "toast":
      return { ...state, toasts: [...state.toasts.slice(-3), { ...action.toast, id: uid("toast") }] };

    case "dismiss-toast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case "reset":
      return { ...initialState, view: action.keepView ? state.view : "verify", toasts: state.toasts };

    default:
      return state;
  }
}
