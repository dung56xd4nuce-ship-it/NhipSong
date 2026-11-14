// Mô hình dữ liệu Nhịp Sống (đặc tả mục 14). Mọi bản ghi có ID ổn định, thời điểm tạo/sửa, phiên bản schema.

export const SCHEMA_VERSION = 1;

export interface Meta { id: string; createdAt: string; updatedAt: string; schemaVersion: number }

export type HHMM = string; // "07:30" theo múi giờ của lịch
export type LocalDate = string; // "2026-11-14" theo múi giờ của lịch

export interface TimeBlock { days: number[]; start: HHMM; end: HHMM; label: string }

export interface Goal { id: string; name: string; minutesPerSession: number; sessionsPerWeek: number }

export interface EnergyWindow { start: HHMM; end: HHMM; level: "cao" | "thap" }

export interface AiDataConsent {
  profile: boolean;   // gửi hồ sơ nhịp sống (giờ giấc, mục tiêu)
  schedule: boolean;  // gửi lịch cần điều chỉnh
  stats: boolean;     // gửi thống kê tối thiểu (số việc lệch, nguyên nhân đã chọn)
}

export interface UserProfile extends Meta {
  nickname?: string; // không bắt buộc tên thật
  timeZone: string;
  sleep: { bed: HHMM; wake: HHMM };
  work: TimeBlock[];
  daysOff: number[];
  commuteMinutes: number;
  familyDuties: string[];
  goals: Goal[];
  energy: EnergyWindow[];
  assumptions: string[]; // các giả định đã ghi rõ khi trích xuất hồ sơ
  aiConsent: AiDataConsent;
  onboarded: boolean;
}

export type ConstraintKind = "khoa" | "di-chuyen" | "gia-dinh";
export interface ScheduleConstraint extends Meta { kind: ConstraintKind; title: string; days: number[]; start: HHMM; end: HHMM }

export type Recurrence =
  | { kind: "once"; date: LocalDate }
  | { kind: "daily"; from: LocalDate; until?: LocalDate }
  | { kind: "weekly"; days: number[]; from: LocalDate; until?: LocalDate };

export type TaskTiming =
  | { kind: "fixed"; start: HHMM }
  | { kind: "window"; from: HHMM; to: HHMM };

export type Priority = 1 | 2 | 3; // 1 cao
export type Category = "lam-viec" | "hoc" | "suc-khoe" | "gia-dinh" | "nghi" | "ca-nhan" | "khac";

export interface TaskTemplate extends Meta {
  title: string;
  category: Category;
  durationMin: number;
  timing: TaskTiming;
  priority: Priority;
  deadline?: LocalDate;
  flexibility: "co-dinh" | "linh-hoat";
  recurrence: Recurrence;
  graceMin: number;          // khoảng gia hạn
  remindBeforeMin: number | null; // nhắc trước
  trackPunctuality: boolean; // cờ theo dõi đúng giờ
  optional: boolean;         // việc tùy chọn không theo dõi
  archived: boolean;
}

export type ExecStatus = "chua-bat-dau" | "dang-lam" | "hoan-thanh" | "bo-qua" | "huy";
export type Confirmation = "da-phan-hoi" | "chua-xac-nhan";
export type Punctuality = "dung-han" | "lech-han" | "chua-du-du-lieu" | "khong-theo-doi";

export interface PlannedTime { startMs: number; endMs: number }

/** Một lần thực hiện cụ thể của mẫu việc trong một ngày lịch. */
export interface TaskOccurrence extends Meta {
  templateId: string;
  date: LocalDate;       // ngày lịch: ngày của giờ bắt đầu theo múi giờ lịch
  timeZone: string;
  original: PlannedTime; // lịch gốc khi sinh ra
  planned: PlannedTime;  // lịch hiện hành
  overrides: Partial<Pick<TaskTemplate, "title" | "durationMin" | "graceMin" | "remindBeforeMin" | "trackPunctuality" | "optional" | "priority">>;
  status: ExecStatus;
  statusAt?: number;     // thời điểm (ms) người dùng xác nhận trạng thái
  actual: { startMs?: number; endMs?: number };
  reason?: DeviationReason;
}

export type ExecEventType = "bat-dau" | "hoan-thanh" | "bo-qua" | "huy" | "doi-gio" | "sua-thuc-te" | "hoan-tac" | "tao" | "sua";
export interface ExecutionEvent extends Meta {
  occurrenceId: string;
  type: ExecEventType;
  at: number; // thời điểm ghi nhận
  before?: Partial<TaskOccurrence>;
  after?: Partial<TaskOccurrence>;
}

export interface ScheduleRevision extends Meta {
  occurrenceId: string;
  at: number;
  before: PlannedTime;
  after: PlannedTime;
  source: "nguoi-dung" | "ai" | "mau";
}

export type DeviationReason = "phat-sinh" | "thieu-nang-luong" | "thieu-thoi-luong" | "quen-cap-nhat" | "khac";

export type AiProposalKind = "lap-lich" | "dieu-chinh";
export interface AIProposal extends Meta {
  kind: AiProposalKind;
  baseScheduleVersion: number;
  date: LocalDate;
  mode: "nhe-nhang" | "can-bang" | "tap-trung";
  payload: unknown; // dữ liệu đã kiểm tra schema
  state: "cho-duyet" | "da-ap-dung" | "bo-qua" | "het-han";
  source: "ai" | "quy-tac";
}

export interface DailySummary extends Meta {
  date: LocalDate;
  computedAt: number;
  cutoffMs: number;
  due: number;
  completed: number;
  deviatedConfirmed: string[];
  unconfirmed: string[];
  skipped: number;
  thresholdReached: boolean;
  notifiedAt?: number;
  reasons: Partial<Record<DeviationReason, number>>;
}

export interface NotificationSettings extends Meta {
  enabled: boolean;
  defaultGraceMin: number;
  maxPerTask: number;
  quietHours: { start: HHMM; end: HHMM } | null;
  pausedUntil: number | null;
  summaryTime: HHMM;
  style: "dang-yeu" | "ngan-gon";
  hideOnLockScreen: boolean;
  mascot: boolean;
  reduceMotion: boolean;
}

/** Chỉ siêu dữ liệu – token được giữ ở kho bảo mật native, không bao giờ nằm trong state này. */
export interface AIConnectionMetadata extends Meta {
  status: "chua-ket-noi" | "da-ket-noi" | "can-ket-noi-lai" | "khong-du-dieu-kien";
  email?: string;
  scopes: string[];
  planUsage: boolean;
  model?: string;
  connectedAt?: number;
  lastError?: string;
  lastCheckedAt?: number;
}

export interface AppState {
  schemaVersion: number;
  scheduleVersion: number;
  profile: UserProfile;
  constraints: ScheduleConstraint[];
  templates: TaskTemplate[];
  occurrences: Record<string, TaskOccurrence>;
  events: ExecutionEvent[];
  revisions: ScheduleRevision[];
  proposals: AIProposal[];
  summaries: Record<string, DailySummary>;
  notificationSettings: NotificationSettings;
  aiConnection: AIConnectionMetadata;
}
