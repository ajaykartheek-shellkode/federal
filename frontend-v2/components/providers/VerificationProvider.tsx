"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import {
  ApiError,
  askAgent,
  buildStepForm,
  editItem as apiEditItem,
  enterScaleReading,
  getSession,
  overrideFinding,
  startSession,
  streamStep,
  type ItemChanges,
  type StepPayload,
} from "@/lib/api";
import { parseIntent } from "@/lib/intents";
import { initialState, reducer, type AppState, type DialogState, type NavView, type OverrideTarget, type Toast } from "@/lib/store";
import type { SampleAccount, SessionView, StepAction } from "@/lib/types";
import { WORKFLOW_STEPS } from "@/lib/format";

const STORAGE_KEY = "glportal.session";
const WELCOME =
  "Welcome to <strong>GL Portal</strong>. Enter the customer's <strong>loan account number</strong> and I'll pull their gold-loan details from CBS.";

interface VerificationApi {
  state: AppState;
  session: SessionView | null;
  start: (account: string) => Promise<void>;
  runStep: (action: StepAction, payload?: StepPayload) => Promise<boolean>;
  send: (text: string) => Promise<void>;
  override: (target: OverrideTarget, ref: string, justification: string) => Promise<boolean>;
  editItem: (ref: string, changes: ItemChanges, justification: string) => Promise<boolean>;
  setScaleReading: (weightG: number, justification: string) => Promise<boolean>;
  resume: (sessionId: string) => Promise<void>;
  reset: () => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  setView: (view: NavView) => void;
  toast: (tone: Toast["tone"], text: string) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<VerificationApi | null>(null);

export function useVerification(): VerificationApi {
  const value = useContext(Ctx);
  if (!value) throw new Error("useVerification must be used inside <VerificationProvider>");
  return value;
}

function storage(action: "get" | "set" | "remove", value?: string): string | null {
  try {
    if (action === "get") return window.localStorage.getItem(STORAGE_KEY);
    if (action === "set" && value) window.localStorage.setItem(STORAGE_KEY, value);
    if (action === "remove") window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — sessions simply won't auto-resume */
  }
  return null;
}

const stepLabel = (s: SessionView) =>
  s.workflow_state === "done" ? "the completed report" : WORKFLOW_STEPS.find((w) => w.key === s.workflow_state)?.label.toLowerCase();

export function VerificationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const busyRef = useRef(false);
  const answeringRef = useRef(false);
  const sessionRef = useRef<SessionView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bootedRef = useRef(false);

  sessionRef.current = state.session;

  const toast = useCallback((tone: Toast["tone"], text: string) => dispatch({ type: "toast", toast: { tone, text } }), []);
  const bot = useCallback((html: string, samples?: SampleAccount[]) => dispatch({ type: "bot", html, samples }), []);

  const setSession = useCallback((session: SessionView | null) => {
    dispatch({ type: "session", session });
    if (session) storage("set", session.session_id);
  }, []);

  /** Run an exclusive async operation with a busy indicator. Returns false if another is running. */
  const exclusive = useCallback(async (busy: AppState["busy"], fn: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    dispatch({ type: "busy", busy });
    try {
      await fn();
      return true;
    } finally {
      busyRef.current = false;
      dispatch({ type: "busy", busy: null });
    }
  }, []);

  const handleApiError = useCallback(
    (err: unknown, context: string) => {
      if (err instanceof ApiError) {
        const body = err.body as { session?: SessionView };
        if (body.session) setSession(body.session);
        if (err.status === 404 && sessionRef.current) {
          storage("remove");
          dispatch({ type: "reset" });
          bot(WELCOME);
        }
        dispatch({ type: "notice", level: err.status >= 500 || err.status === 0 ? "error" : "warn", text: err.message });
        toast(err.status >= 500 || err.status === 0 ? "bad" : "warn", err.message);
        return;
      }
      if ((err as Error)?.name === "AbortError") return;
      const message = `${context} failed. Please try again.`;
      dispatch({ type: "notice", level: "error", text: message });
      toast("bad", message);
    },
    [bot, setSession, toast]
  );

  // ---- boot: deep link (?session=&view=), else resume the last session, else greet
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const linkedView = params.get("view");
    if (linkedView === "reports" || linkedView === "history" || linkedView === "settings") {
      dispatch({ type: "view", view: linkedView });
    }
    const saved = params.get("session") || storage("get");
    if (params.has("session") || params.has("view")) window.history.replaceState(null, "", window.location.pathname);
    if (!saved) {
      bot(WELCOME);
      return;
    }
    void exclusive("restore", async () => {
      try {
        const { session } = await getSession(saved);
        setSession(session);
        bot(
          `Welcome back. I've restored the verification for <strong>${session.loan.customer_name}</strong> (${session.loan.account_number}) at ${stepLabel(session)}.`
        );
      } catch (err) {
        // Forget the saved session only if it no longer exists — not on a network blip or 5xx.
        if (err instanceof ApiError && err.status === 404) {
          storage("remove");
          bot(WELCOME);
        } else {
          bot("I couldn't reach the GL Portal service to restore your verification. Refresh to try again, or enter a loan account number to start a new one.");
        }
      }
    });
    return () => abortRef.current?.abort();
  }, [bot, exclusive, setSession]);

  // ---- actions ---------------------------------------------------------------
  const start = useCallback(
    async (account: string) => {
      const trimmed = account.trim();
      if (!trimmed) return;
      dispatch({ type: "user", text: trimmed });
      await exclusive("start", async () => {
        try {
          const res = await startSession(trimmed);
          setSession(res.session);
          dispatch({ type: "view", view: "verify" });
          bot(res.message);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            bot(`${err.message} Please check the number and try again.`, (err.body.samples as SampleAccount[]) ?? []);
            return;
          }
          handleApiError(err, "Loading the account");
        }
      });
    },
    [bot, exclusive, handleApiError, setSession]
  );

  const runStep = useCallback(
    async (action: StepAction, payload?: StepPayload) => {
      const session = sessionRef.current;
      if (!session) return false;
      let failed = false;
      let finished = false;
      const ran = await exclusive("step", async () => {
        abortRef.current = new AbortController();
        try {
          await streamStep(
            buildStepForm(session.session_id, action, payload),
            (event, data) => {
              switch (event) {
                case "exec-step":
                  dispatch({ type: "exec-step", event: data });
                  break;
                case "exec-done":
                  dispatch({ type: "exec-done", event: data });
                  break;
                case "state":
                  setSession(data.session);
                  break;
                case "agent-msg":
                  bot(data.text);
                  break;
                case "notice":
                  dispatch({ type: "notice", level: data.level, text: data.text });
                  if (data.level !== "info") toast(data.level === "error" ? "bad" : "warn", data.text);
                  break;
                case "error":
                  failed = true;
                  dispatch({ type: "notice", level: "error", text: data.error });
                  toast("bad", data.error);
                  break;
                case "done":
                  finished = true;
                  break;
              }
            },
            abortRef.current.signal
          );
          if (!finished && !failed) {
            failed = true;
            const text = "The connection closed before the step finished. The latest saved state has been reloaded.";
            dispatch({ type: "notice", level: "error", text });
            toast("bad", text);
          }
        } catch (err) {
          failed = true;
          handleApiError(err, "This step");
        }
        if (failed) {
          dispatch({ type: "fail-open-runs" });
          // Re-sync with the server so the dashboard never shows a half-applied step.
          try {
            const { session: fresh } = await getSession(session.session_id);
            setSession(fresh);
          } catch {
            /* handled by the next action */
          }
        }
      });
      return ran && !failed;
    },
    [bot, exclusive, handleApiError, setSession, toast]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current || answeringRef.current) return;
      const intent = parseIntent(trimmed, sessionRef.current);
      switch (intent.kind) {
        case "start":
          return start(intent.account);
        case "need-account":
          dispatch({ type: "user", text: trimmed });
          bot("Please enter a valid <strong>loan account number</strong> to begin (for example, GL2024001234).");
          return;
        case "open":
          dispatch({ type: "user", text: trimmed });
          dispatch({ type: "dialog", dialog: { kind: intent.dialog } });
          return;
        case "step":
          dispatch({ type: "user", text: trimmed });
          await runStep(intent.action);
          return;
        case "ask": {
          const session = sessionRef.current;
          if (!session) return;
          dispatch({ type: "user", text: trimmed });
          // Questions are read-only: show the typing indicator but leave every workflow control untouched.
          answeringRef.current = true;
          dispatch({ type: "answering", value: true });
          try {
            const { text: reply } = await askAgent(session.session_id, intent.question);
            bot(reply);
          } catch (err) {
            handleApiError(err, "Asking the agent");
          } finally {
            answeringRef.current = false;
            dispatch({ type: "answering", value: false });
          }
        }
      }
    },
    [bot, handleApiError, runStep, start]
  );

  const mutate = useCallback(
    async (fn: (sessionId: string) => Promise<{ session: SessionView }>, success: string) => {
      const session = sessionRef.current;
      if (!session) return false;
      let ok = false;
      await exclusive("mutate", async () => {
        try {
          const res = await fn(session.session_id);
          setSession(res.session);
          toast("ok", success);
          ok = true;
        } catch (err) {
          handleApiError(err, "Saving");
        }
      });
      return ok;
    },
    [exclusive, handleApiError, setSession, toast]
  );

  const override = useCallback(
    (target: OverrideTarget, ref: string, justification: string) =>
      mutate((sid) => overrideFinding(sid, target, ref, justification), "Override recorded in the audit trail"),
    [mutate]
  );

  const editItem = useCallback(
    (ref: string, changes: ItemChanges, justification: string) =>
      mutate((sid) => apiEditItem(sid, ref, changes, justification), "Inventory correction recorded"),
    [mutate]
  );

  const setScaleReading = useCallback(
    (weightG: number, justification: string) =>
      mutate((sid) => enterScaleReading(sid, weightG, justification), "Scale reading recorded in the audit trail"),
    [mutate]
  );

  const resume = useCallback(
    async (sessionId: string) => {
      await exclusive("restore", async () => {
        try {
          const { session } = await getSession(sessionId);
          dispatch({ type: "reset" });
          setSession(session);
          bot(`Opened the verification for <strong>${session.loan.customer_name}</strong> (${session.loan.account_number}).`, undefined);
        } catch (err) {
          handleApiError(err, "Opening the verification");
        }
      });
    },
    [bot, exclusive, handleApiError, setSession]
  );

  const reset = useCallback(() => {
    if (busyRef.current) return;
    abortRef.current?.abort();
    storage("remove");
    dispatch({ type: "reset" });
    bot(WELCOME);
  }, [bot]);

  const api = useMemo<VerificationApi>(
    () => ({
      state,
      session: state.session,
      start,
      runStep,
      send,
      override,
      editItem,
      setScaleReading,
      resume,
      reset,
      openDialog: (dialog) => dispatch({ type: "dialog", dialog }),
      closeDialog: () => dispatch({ type: "dialog", dialog: null }),
      setView: (view) => dispatch({ type: "view", view }),
      toast,
      dismissToast: (id) => dispatch({ type: "dismiss-toast", id }),
    }),
    [state, start, runStep, send, override, editItem, setScaleReading, resume, reset, toast]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
