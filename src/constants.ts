// Session & Bot Health
export const SESSION_HEALTH_POLL_MS = 1000;

// Telegram UI — Typing & Progress
export const TYPING_REFRESH_MS = 3000;
export const PROGRESS_REFRESH_MS = 8000;
export const PROGRESS_EDIT_DEBOUNCE_MS = 1500;
export const TELEGRAM_MSG_LIMIT = 4096;
// Deliberately smaller than TELEGRAM_MSG_LIMIT for headroom in streaming output
export const STREAMING_MSG_MAX_LEN = 4000;

// Logging truncation
export const LOG_TRANSCRIPT_MAX_CHARS = 100;
export const LOG_REASONING_MAX_CHARS = 100;

// Picker UI — Model & Reasoning (long-lived, 24 h)
export const MODEL_PICKER_TTL_MS = 24 * 60 * 60 * 1000;
export const MODEL_PICKER_MAX = 100;
export const MODELS_PER_PAGE = 8;

// Picker UI — Session & Jobs (short-lived, 10 min)
export const ACTION_PICKER_TTL_MS = 10 * 60 * 1000;
export const ACTION_PICKER_MAX = 50;
export const SESSIONS_PER_PAGE = 6;
export const SESSION_LABEL_MAX_CHARS = 28;
export const SESSION_SUMMARY_MAX_CHARS = 60;

// Scheduler
export const HEARTBEAT_MS = 30_000;
export const CRON_LOOKAHEAD_YEARS = 2;

// Jobs
export const JOB_ERROR_MAX_CHARS = 100;

// Logging & Anomaly Detection
export const ANOMALY_RECENT_CALLS = 5;
export const ANOMALY_FAILURE_THRESHOLD = 3;
export const ANOMALY_ERROR_MAX_CHARS = 200;

// User
export const USER_TIMEZONE = "America/New_York";

// Agent
export const VALID_REASONING_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh"]);

// Memory
export const SUMMARIZED_MARKER = "<!-- summarized -->";

// GitHub Copilot API
export const COPILOT_USAGE_FETCH_TIMEOUT_MS = 12_000;
