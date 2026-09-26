// Typed client for the GL Portal API (proxied same-origin under /api).

import type {
  AccountReport,
  AppSettings,
  DailyReport,
  OverviewReport,
  SampleAccount,
  SessionView,
  StaffUser,
  StepAction,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the GL Portal service. Check that the backend is running.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

// ---- staff sign-in ------------------------------------------------------------
// The session lives in an HttpOnly cookie the browser attaches to every /api call, including
// the <img> and PDF requests a fetch header could never reach.
export const signIn = (email: string, password: string) =>
  request<{ user: StaffUser }>("/api/auth/login", json("POST", { email, password })).then((r) => r.user);

export const signOut = () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });

export async function fetchCurrentUser(): Promise<StaffUser | null> {
  try {
    return (await request<{ user: StaffUser }>("/api/auth/me")).user;
  } catch {
    return null;
  }
}

// ---- health -------------------------------------------------------------------
export interface Health {
  ok: boolean;
  modelId: string;
  region: string;
  latencyMs?: number;
  error?: string;
}

export async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return (await res.json()) as Health;
  } catch (e) {
    return { ok: false, modelId: "", region: "", error: String(e) };
  }
}

// ---- verification session ---------------------------------------------------
export interface StartResponse {
  session: SessionView;
  message: string;
}

/** Journeys start from the customer's mobile number — CBS holds the five demo customers. */
export const startSession = (mobile: string) => request<StartResponse>("/api/chat/start", json("POST", { mobile }));

/** The CBS customers this branch can start a journey for. */
export const fetchCustomers = () =>
  request<{ customers: SampleAccount[] }>("/api/chat/customers").then((r) => r.customers);

export const getSession = (sessionId: string) =>
  request<{ session: SessionView }>(`/api/chat/session/${encodeURIComponent(sessionId)}`);

export interface SessionSummary {
  session_id: string;
  /** The loan account, or the application reference while the loan is not yet opened. */
  account_number: string;
  reference?: string;
  customer_name: string;
  scenario: string;
  workflow_state: string;
  created_at: string | null;
  updated_at: string | null;
}

export const fetchOpenSessions = (limit = 20) =>
  request<{ sessions: SessionSummary[] }>(`/api/chat/sessions?open_only=true&limit=${limit}`).then((r) => r.sessions);

export const askAgent = (sessionId: string, question: string) =>
  request<{ text: string }>("/api/chat/answer", json("POST", { session_id: sessionId, question }));

export type OverrideTarget = "item" | "damage" | "document" | "measurement" | "scale";

export const overrideFinding = (sessionId: string, target: OverrideTarget, ref: string, justification: string) =>
  request<{ session: SessionView }>("/api/chat/override", json("POST", { session_id: sessionId, target, ref, justification }));

export interface ItemChanges {
  name?: string;
  material?: string;
  carat?: string;
  weight_gm?: number;
  quantity?: number;
}

export const editItem = (sessionId: string, ref: string, changes: ItemChanges, justification: string) =>
  request<{ session: SessionView }>("/api/chat/edit", json("POST", { session_id: sessionId, ref, changes, justification }));

export const enterScaleReading = (sessionId: string, weightG: number, justification: string) =>
  request<{ session: SessionView }>("/api/chat/scale", json("POST", { session_id: sessionId, weight_g: weightG, justification }));

/** The weight the assessor read off the machine for one ornament. */
export const setItemWeight = (sessionId: string, ref: string, weightGm: number, justification = "") =>
  request<{ session: SessionView }>("/api/chat/weight", json("POST", { session_id: sessionId, ref, weight_gm: weightGm, justification }));

export interface NewItem {
  name: string;
  material?: string;
  quantity?: number;
  weight_gm?: number;
}

/** Add an ornament the collateral photo did not show (or the agent missed). */
export const addInventoryItem = (sessionId: string, item: NewItem) =>
  request<{ session: SessionView }>("/api/chat/item", json("POST", { session_id: sessionId, ...item }));

export const removeInventoryItem = (sessionId: string, ref: string, justification = "") =>
  request<{ session: SessionView }>("/api/chat/item/remove", json("POST", { session_id: sessionId, ref, justification }));

export interface DamageInput {
  ornament_id: string;
  type: string;
  severity: string;
  damage_percent: number;
  details: string;
  file: File;
}

export interface DocumentInput {
  declared_type: string;
  file: File;
}

export interface StepPayload {
  collateral?: File[];
  scale?: File;
  damage?: DamageInput[];
  documents?: DocumentInput[];
}

export function buildStepForm(sessionId: string, action: StepAction, payload: StepPayload = {}): FormData {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("action", action);
  (payload.collateral ?? []).forEach((f) => form.append("collateral_images", f, f.name));
  if (payload.scale) form.append("scale_image", payload.scale, payload.scale.name);
  const damage = payload.damage ?? [];
  form.append(
    "damage_hints",
    JSON.stringify(
      damage.map(({ ornament_id, type, severity, damage_percent, details }) => ({
        ornament_id,
        type,
        severity,
        damage_percent,
        details,
      }))
    )
  );
  damage.forEach((d) => form.append("damage_images", d.file, d.file.name));
  const docs = payload.documents ?? [];
  form.append("document_types", JSON.stringify(docs.map((d) => d.declared_type)));
  docs.forEach((d) => form.append("documents", d.file, d.file.name));
  return form;
}

export type StepEventHandler = (event: string, data: any) => void;

/** POST a workflow step and dispatch each Server-Sent Event as it arrives. */
export async function streamStep(form: FormData, onEvent: StepEventHandler, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat/step", { method: "POST", body: form, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the GL Portal service. Check that the backend is running.");
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : `Step failed (${res.status})`, body);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      dispatchFrame(buffer.slice(0, sep), onEvent);
      buffer = buffer.slice(sep + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) dispatchFrame(buffer, onEvent);
}

function dispatchFrame(frame: string, onEvent: StepEventHandler) {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue; // keep-alive comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    return; // malformed frame — ignore rather than break the stream
  }
  onEvent(event, parsed);
}

// ---- settings -----------------------------------------------------------------
export const fetchSettings = () => request<AppSettings>("/api/settings");
export const saveSettings = (patch: Partial<AppSettings>) => request<AppSettings>("/api/settings", json("PUT", patch));

// ---- reports ------------------------------------------------------------------
export const fetchReportDates = () => request<{ dates: string[] }>("/api/reports/dates").then((r) => r.dates);
export const fetchDailyReport = (date?: string) =>
  request<DailyReport>(`/api/reports/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`);
export const fetchAccountReport = (account: string) =>
  request<AccountReport>(`/api/reports/account?account=${encodeURIComponent(account)}`);
export const fetchOverview = (days = 7) => request<OverviewReport>(`/api/reports/overview?days=${days}`);

export const assetUrl = (id: string | null | undefined) => (id ? `/api/assets/${id}` : "");

/** Server-rendered PDF of a finished verification report (download, or inline for a preview tab). */
export const reportPdfUrl = (sessionId: string, inline = false) =>
  `/api/reports/session/${encodeURIComponent(sessionId)}/pdf${inline ? "?inline=true" : ""}`;

export type { SampleAccount };
