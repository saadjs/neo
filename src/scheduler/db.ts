import { getConversationDb } from "../logging/conversations.js";

export interface Reminder {
  id: number;
  label: string;
  message: string;
  fire_at: string;
  recurrence: string;
  status: string;
  created_at: string;
  fired_at: string | null;
}

export function initRemindersTable(): void {
  const db = getConversationDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      message TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'once',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fired_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_status_fire_at
      ON reminders(status, fire_at);
  `);
}

export function createReminder(
  label: string,
  message: string,
  fireAt: string,
  recurrence: string = "once",
): number {
  const db = getConversationDb();
  const result = db
    .prepare("INSERT INTO reminders (label, message, fire_at, recurrence) VALUES (?, ?, ?, ?)")
    .run(label, message, fireAt, recurrence);
  return Number(result.lastInsertRowid);
}

export function listActiveReminders(): Reminder[] {
  const db = getConversationDb();
  return db
    .prepare("SELECT * FROM reminders WHERE status = 'active' ORDER BY fire_at")
    .all() as unknown as Reminder[];
}

export function cancelReminder(id: number): boolean {
  const db = getConversationDb();
  const result = db
    .prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'active'")
    .run(id);
  return result.changes > 0;
}

export function getDueReminders(now: string): Reminder[] {
  const db = getConversationDb();
  return db
    .prepare("SELECT * FROM reminders WHERE status = 'active' AND fire_at <= ?")
    .all(now) as unknown as Reminder[];
}

export function markFired(id: number, recurrence: string): void {
  const db = getConversationDb();
  const now = new Date().toISOString();

  if (recurrence === "once") {
    db.prepare("UPDATE reminders SET status = 'fired', fired_at = ? WHERE id = ?").run(now, id);
  } else {
    const nextFireAt = computeNextFireAt(recurrence, now);
    db.prepare("UPDATE reminders SET fire_at = ?, fired_at = ? WHERE id = ?").run(
      nextFireAt,
      now,
      id,
    );
  }
}

function computeNextFireAt(recurrence: string, fromIso: string): string {
  const date = new Date(fromIso);

  switch (recurrence) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case "weekdays": {
      // Advance to next weekday (Mon-Fri)
      do {
        date.setUTCDate(date.getUTCDate() + 1);
      } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
      break;
    }
    default:
      // Fallback: treat as daily
      date.setUTCDate(date.getUTCDate() + 1);
  }

  return date.toISOString();
}
