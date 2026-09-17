// Types mirroring the backend session view (backend/app/workflow/state.py → view()).

export type CheckStatus = "pass" | "alert" | "fail";
export type ResultStatus = CheckStatus | "not_checked";
export type ItemStatus = "pending" | "verified" | "overridden" | "manual";
export type WorkflowState = "collateral" | "weight" | "damage" | "document" | "report" | "done";
export type StepAction = "collateral" | "measure" | "damage" | "document" | "continue" | "report";
export type MeasurementStatus = "pending" | "match" | "weight_mismatch" | "purity_low" | "mismatch" | "missing";
export type Severity = "minor" | "moderate" | "severe";

export interface Loan {
  account_number: string;
  customer_id: string;
  customer_name: string;
  scenario: string;
  branch: string;
  id_number_masked: string;
  has_address: boolean;
}

export interface Measurement {
  weight_g: number;
  fineness_pct: number;
  /** Gold only (fineness expressed on the 24K scale). */
  karat: number | null;
  /** Grade assessed from the fineness against the valuation table; null when below every grade. */
  grade: string | null;
  sample_id: string;
  measured_at: string;
  confidence: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  /** Valuation material key, e.g. "gold" | "silver". */
  material: string;
  /** Declared purity token from CBS: "22" (22K gold), "925" (sterling silver). */
  carat: string;
  weight_gm: number;
  quantity: number;
  damage_percent: number;
  cbs_damage: boolean;
  cbs_damage_details: string;
  cbs_damage_waived?: boolean;
  status: ItemStatus;
  thumb_asset_id: string | null;
  source_image: number | null;
  measurement?: Measurement | null;
  measurement_status?: MeasurementStatus;
  measurement_overridden?: boolean;
}

export type CaptureCheck =
  | "clarity_ok"
  | "all_visible"
  | "not_cropped"
  | "no_obstruction"
  | "no_foreign_objects"
  | "clean_background";

export interface CollateralImage {
  index: number;
  upload_no: number;
  asset_id: string | null;
  filename: string;
  uploaded_at: string;
  status: ResultStatus;
  checks: Partial<Record<CaptureCheck, boolean>>;
  ornament_count_estimate: number;
  foreign_object_percent: number;
  issues: string[];
  matched: string[];
  /** Weighing-scale display read from this photo. */
  scale?: { visible: boolean; weight_g: number | null; text: string };
}

export interface CollateralState {
  images: CollateralImage[];
  overall_status: CheckStatus | null;
  issues: string[];
  corrective_actions: string[];
  unmatched_detections: number;
}

export interface DamageEntry {
  ornament_id: string;
  item: string;
  type: string;
  severity: Severity;
  assessor_details: string;
  asset_id: string | null;
  thumb_asset_id: string | null;
  filename: string;
  status: ResultStatus;
  consistent: boolean | null;
  observed: string[];
  additional: string[];
  assessed_severity: "none" | Severity | null;
  notes: string;
  capture_issues: string[];
  corrective_actions: string[];
  overridden: boolean;
  recorded_at: string;
}

export interface DocumentItem {
  doc_no: number;
  declared_type: string;
  asset_id: string | null;
  filename: string;
  content_type: string;
  status: ResultStatus;
  legible: boolean | null;
  complete: boolean | null;
  type_matches_declared: boolean | null;
  doc_type_detected: string;
  extracted: { name: string; id_number: string; address: string };
  matches: { name: boolean; id: boolean; address_pct: number };
  issues: string[];
  overridden: boolean;
}

export interface DocumentsState {
  items: DocumentItem[];
  overall_status: CheckStatus | null;
  issues: string[];
  corrective_actions: string[];
}

export type AuditTarget = "item" | "damage" | "document" | "edit" | "measurement" | "scale";

export interface AuditEntry {
  id: string;
  target: AuditTarget;
  ref: string;
  item: string;
  original: string;
  new_value: string;
  justification: string;
  ts: string;
}

export interface ReviewReason {
  level: "warn" | "info";
  text: string;
}

export interface Stats {
  items: number;
  pieces: number;
  verified: number;
  overridden: number;
  pending: number;
  damaged: number;
  total_weight: number;
  measured_weight: number | null;
  measured: number;
  measurement_flags: number;
  pledge_amount: number;
  pledge_is_estimate: boolean;
}

export interface ScaleReading {
  weight_g: number;
  text: string;
  source: "photo" | "assessor";
  photo_index: number | null;
  recorded_at: string;
}

export interface CaratMeterDevice {
  device_id?: string | null;
  model?: string | null;
  branch?: string | null;
  firmware?: string | null;
  calibrated_at?: string | null;
  mode?: string | null;
}

export interface WeightSummary {
  declared_g: number;
  measured_g: number | null;
  measured_complete: boolean;
  reference: "measured" | "declared";
  scale_g: number | null;
  scale_text: string;
  scale_source: "photo" | "assessor" | null;
  scale_photo: number | null;
  scale_diff_g: number | null;
  scale_status: "pending" | "missing" | "match" | "mismatch";
  scale_overridden: boolean;
  tolerance_g: number;
  item_tolerance_g: number;
  purity_tolerance_pct: number;
  device: CaratMeterDevice | null;
  measured_at: string | null;
  counts: Record<MeasurementStatus, number>;
  flagged: number;
}

export type DamageDeduction = "tenths" | "percent" | "none";

export interface ValuedItem {
  ornament_id: string;
  name: string;
  material: string;
  grade: string | null;
  weight_g: number;
  weight_basis: "measured" | "declared";
  rate_per_gram: number;
  gross_value: number;
  ltv_pct: number;
  damage_percent: number;
  damage_deduction: number;
  pledge_amount: number;
  unpriced: boolean;
}

export interface ValuationView {
  items: ValuedItem[];
  totals: {
    weight_g: number;
    gross_value: number;
    damage_deduction: number;
    pledge_amount: number;
    is_estimate: boolean;
    unpriced: string[];
  };
  damage_deduction_mode: DamageDeduction;
  materials: { key: string; name: string; ltv_pct: number }[];
}

export interface Report {
  report_id: string;
  run_id: string;
  generated_at: string;
  recommendation: "PROCEED" | "REVIEW";
  overall_status: CheckStatus;
  reasons: ReviewReason[];
  stats: Stats;
  valuation?: ValuationView;
  weight?: WeightSummary | null;
}

export interface Gate {
  allowed: boolean;
  reasons: string[];
}

export interface SessionView {
  session_id: string;
  workflow_state: WorkflowState;
  /** The steps this session runs (sessions created before the weight step skip it). */
  steps: Exclude<WorkflowState, "done">[];
  ai_enabled: boolean;
  loan: Loan;
  rate_table: Record<string, number>;
  inventory: InventoryItem[];
  collateral: CollateralState;
  scale: ScaleReading | null;
  measurements: { device: CaratMeterDevice; measured_at: string; count: number } | null;
  weight: WeightSummary;
  valuation: ValuationView;
  caratmeter: { device_id: string; model: string; mode: "mock" | "http" };
  damages: DamageEntry[];
  documents: DocumentsState | null;
  audit: AuditEntry[];
  report: Report | null;
  stats: Stats;
  cbs_damage_pending: string[];
  allowed_actions: StepAction[];
  gate: Gate;
  settings: {
    blocker_mode: boolean;
    max_ornaments_per_image: number;
    foreign_object_threshold_pct: number;
    doc_match_threshold_pct: number;
  };
  options: {
    damage_types: string[];
    severities: Severity[];
    document_types: string[];
    carats: string[];
    grades: Record<string, string[]>;
    damage_deduction: DamageDeduction;
  };
}

// ---- streamed step events ---------------------------------------------------
export interface ExecStepEvent {
  run_id: string;
  agent: string;
  index: number;
  total: number;
  key: string;
  label: string;
  status: "active" | "done" | "error";
  elapsed_ms?: number;
}

export interface ExecDoneEvent {
  run_id: string;
  agent: string;
  status: ResultStatus | "info" | "error";
  summary: string;
  total_ms: number;
}

// ---- settings / reports -------------------------------------------------------
export interface PurityGrade {
  grade: string;
  fineness_pct: number;
  rate_per_gram: number;
}

export interface MaterialConfig {
  key: string;
  name: string;
  ltv_pct: number;
  grades: PurityGrade[];
}

export interface AppSettings {
  scenarios: string[];
  aws_enabled: Record<string, boolean>;
  blocker_mode: boolean;
  max_ornaments_per_image: number;
  foreign_object_threshold_pct: number;
  doc_match_threshold_pct: number;
  valuation: { materials: MaterialConfig[] };
  weight_tolerance_g: number;
  purity_tolerance_pct: number;
  damage_deduction: DamageDeduction;
}

export type CountTriple = { pass: number; alert: number; fail: number };
export type CountsByKind = Record<"collateral" | "damage" | "document", CountTriple>;

export interface RunImage {
  asset_id: string | null;
  filename: string;
  status: string;
  issues: string[];
}

export interface RunRecord {
  id: string;
  session_id: string | null;
  created_at: string;
  date: string;
  loan: { account_number: string; customer_name: string; scenario: string };
  overall_status: CheckStatus;
  summary: {
    report_id?: string;
    recommendation?: "PROCEED" | "REVIEW";
    reasons?: ReviewReason[];
    narrative?: string;
    ai_enabled?: boolean;
    stats?: Stats;
    pledge_amount?: number | null;
  };
  counts: CountsByKind;
  collateral_images: (RunImage & { index: number })[];
  damage_images: (RunImage & { ornament_id: string; ornament_name: string; described_damage: string; overridden?: boolean })[];
  documents: (RunImage & { doc_no: number; doc_type: string; content_type?: string; overridden?: boolean })[];
}

export interface RunSummary {
  run_count: number;
  counts: CountsByKind;
  runs: RunRecord[];
}
export interface DailyReport extends RunSummary {
  date: string;
}
export interface AccountReport extends RunSummary {
  account: string;
}
export interface OverviewReport {
  days: { date: string; runs: number; pass: number; alert: number; fail: number }[];
  totals: { runs: number; pass: number; alert: number; fail: number };
  counts: CountsByKind;
  runs: RunRecord[];
}

export interface SampleAccount {
  account_number: string;
  customer_name: string;
  scenario: string;
}
