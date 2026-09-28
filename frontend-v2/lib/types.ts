// Types mirroring the backend session view (backend/app/workflow/state.py → view()).

export type CheckStatus = "pass" | "alert" | "fail";
export type ResultStatus = CheckStatus | "not_checked";
/** How a row got onto the pledge list: seen in the collateral photo, or added by the assessor. */
export type ItemStatus = "detected" | "manual";
export type WorkflowState = "collateral" | "weight" | "damage" | "valuation" | "document" | "report" | "done";
export type StepAction = "collateral" | "scale_photo" | "measure" | "damage" | "document" | "continue" | "report";
export type MeasurementStatus = "pending" | "match" | "weight_mismatch" | "ungraded" | "mismatch" | "missing";
export type Severity = "minor" | "moderate" | "severe";

export interface Loan {
  /** Empty for a fresh application until the verification is recommended to proceed. */
  account_number: string;
  /** The reference a fresh loan is opened under; empty for an existing loan. */
  application_no: string;
  account_issued_at: string;
  customer_id: string;
  customer_name: string;
  mobile?: string;
  scenario: string;
  branch: string;
  id_number_masked: string;
  has_address: boolean;
}

export interface Application {
  reference: string;
  kind: "fresh" | "existing";
  opened_at?: string;
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

export type WeightSource = "" | "ai" | "assessor";

export interface InventoryItem {
  /** Generated here (item-1, item-2 …) and used as the Karatometer request tag. */
  id: string;
  name: string;
  /** Valuation material key, e.g. "gold" | "silver". */
  material: string;
  /** Purity token: empty until the Karatometer assays it ("22" = 22K gold, "925" = sterling silver). */
  carat: string;
  /** Grams. 0 until the machine total is apportioned or the assessor types one. */
  weight_gm: number;
  /** "ai" while it is the agent's share of the machine total, "assessor" once a human owns it. */
  weight_source?: WeightSource;
  /** The agent's one-phrase reason for this share, e.g. "heavy 22K bangle". */
  weight_basis?: string;
  quantity: number;
  /** True once damage has been recorded against this ornament. */
  damaged: boolean;
  origin: ItemStatus;
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
  /** Ids of the ornaments this photo put on the list. */
  matched: string[];
}

export interface CollateralState {
  images: CollateralImage[];
  overall_status: CheckStatus | null;
  issues: string[];
  corrective_actions: string[];
  detections: number;
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

export type AuditTarget = "item" | "damage" | "document" | "edit" | "measurement" | "scale" | "weight";

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
  detected: number;
  manual: number;
  weighed: number;
  damaged: number;
  /** Total of the per-ornament weights. */
  total_weight: number;
  gross_weight: number;
  net_weight: number;
  measured_weight: number | null;
  measured: number;
  measurement_flags: number;
  max_loan_amount: number;
  /** The historical key for the same figure; reports written before the rename still use it. */
  pledge_amount: number;
  pledge_is_estimate: boolean;
}

export interface ScaleReading {
  /** null when the machine photo was uploaded but its display could not be read. */
  weight_g: number | null;
  text: string;
  source: "photo" | "assessor" | null;
  asset_id: string | null;
  filename: string;
  status: ResultStatus;
  issues: string[];
  recorded_at: string;
}

export interface KaratometerDevice {
  device_id?: string | null;
  model?: string | null;
  branch?: string | null;
  firmware?: string | null;
  calibrated_at?: string | null;
  mode?: string | null;
}

export interface WeightSummary {
  /** What the ornaments weigh: the machine reading, or the pledge list when it could not be read. */
  gross_g: number;
  wastage_pct: number;
  wastage_g: number;
  /** Gross weight less wastage — the weight the loan is sized on. */
  net_g: number;
  rate_per_gram: number;
  /** Total of the per-ornament weights. */
  entered_g: number;
  measured_g: number | null;
  measured_complete: boolean;
  weighed: number;
  unweighed: string[];
  scale_g: number | null;
  scale_text: string;
  scale_source: "photo" | "assessor" | null;
  scale_asset_id: string | null;
  scale_photo_status: ResultStatus | null;
  scale_issues: string[];
  scale_diff_g: number | null;
  scale_status: "pending" | "missing" | "match" | "mismatch";
  scale_overridden: boolean;
  tolerance_g: number;
  item_tolerance_g: number;
  purity_tolerance_pct: number;
  device: KaratometerDevice | null;
  measured_at: string | null;
  counts: Record<MeasurementStatus, number>;
  flagged: number;
}

export type LoanType = "ODA" | "LAA" | "CCA";
export type LoanCategory = "GGL" | "KGL" | "IGL";

/** One lending scheme in the catalogue: where it sits, how long it runs, what it pays per gram. */
export interface LoanSchemeOption {
  name: string;
  loan_type: LoanType;
  loan_category: LoanCategory;
  tenure_months: number;
  rate_per_gram: number;
}

/** The scheme this verification runs under, chosen at the loan valuation step. */
export interface ChosenScheme {
  loan_type: LoanType;
  loan_category: LoanCategory;
  name: string;
  tenure_months: number;
  rate_per_gram: number;
  chosen_at: string;
}

export interface ValuedItem {
  ornament_id: string;
  name: string;
  material: string;
  grade: string | null;
  gross_weight_g: number;
  wastage_g: number;
  net_weight_g: number;
  measured: boolean;
  rate_per_gram: number;
  loan_amount: number;
  /** True while the Karatometer has not graded this ornament's purity. */
  unpriced: boolean;
}

export interface ValuationView {
  items: ValuedItem[];
  totals: {
    gross_weight_g: number;
    wastage_pct: number;
    wastage_g: number;
    net_weight_g: number;
    rate_per_gram: number;
    /** Net weight × the rate per gram. */
    max_loan_amount: number;
    /** The same figure under its historical key, kept for reports written before the rename. */
    pledge_amount: number;
    is_estimate: boolean;
    unpriced: string[];
  };
  materials: { key: string; name: string }[];
}

export interface SignatureRecord {
  role: "customer" | "assessor" | "officer";
  name: string;
  kind: "drawn" | "typed";
  signed_at: string;
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
  /** Set once the signed report has been submitted at the counter. */
  submitted_at?: string | null;
  signatures?: SignatureRecord[];
}

export interface Gate {
  allowed: boolean;
  reasons: string[];
}

export interface SessionView {
  session_id: string;
  workflow_state: WorkflowState;
  /** The loan application this verification runs under (or the existing account). */
  application: Application;
  /** The steps this session runs (sessions created before the weight step skip it). */
  steps: Exclude<WorkflowState, "done">[];
  ai_enabled: boolean;
  loan: Loan;
  inventory: InventoryItem[];
  collateral: CollateralState;
  /** The weighing-machine photo and the total it showed. */
  scale: ScaleReading | null;
  measurements: { device: KaratometerDevice; measured_at: string; count: number } | null;
  weight: WeightSummary;
  valuation: ValuationView;
  caratmeter: { device_id: string; model: string; mode: "mock" | "http" };
  damages: DamageEntry[];
  documents: DocumentsState | null;
  audit: AuditEntry[];
  report: Report | null;
  signatures: SignatureRecord[];
  loan_scheme: ChosenScheme | null;
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
    materials: { key: string; name: string }[];
    grades: Record<string, string[]>;
    /** The full scheme grid; the UI filters it by loan type, then category. */
    schemes: LoanSchemeOption[];
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
  /** The loan amount: net weight × the selected scheme's rate, where net = gross less wastage_pct. */
  wastage_pct: number;
  schemes: LoanSchemeOption[];
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
  customer_id?: string;
  mobile?: string;
  customer_name: string;
  scenario: string;
  branch?: string;
}

// ---- staff -----------------------------------------------------------------
export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: string;
  branch: string;
  initials: string;
}
