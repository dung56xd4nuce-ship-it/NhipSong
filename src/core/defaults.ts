import { AppState, Meta, SCHEMA_VERSION, UserProfile, NotificationSettings, AIConnectionMetadata } from "./types";

let counter = 0;
export function newId(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 12) + (counter++).toString(36);
  return `${prefix}_${rnd}`;
}

export function meta(prefix: string, now = Date.now(), id?: string): Meta {
  const iso = new Date(now).toISOString();
  return { id: id ?? newId(prefix), createdAt: iso, updatedAt: iso, schemaVersion: SCHEMA_VERSION };
}

export function touch<T extends Meta>(rec: T, now = Date.now()): T {
  return { ...rec, updatedAt: new Date(now).toISOString() };
}

export function defaultProfile(timeZone: string, now = Date.now()): UserProfile {
  return {
    ...meta("profile", now, "profile"),
    timeZone,
    sleep: { bed: "23:00", wake: "06:30" },
    work: [],
    daysOff: [0],
    commuteMinutes: 0,
    familyDuties: [],
    goals: [],
    energy: [],
    assumptions: [],
    aiConsent: { profile: false, schedule: false, stats: false },
    onboarded: false,
  };
}

export function defaultNotificationSettings(now = Date.now()): NotificationSettings {
  return {
    ...meta("notif", now, "notification-settings"),
    enabled: true,
    defaultGraceMin: 10,
    maxPerTask: 2,
    quietHours: { start: "22:30", end: "06:00" },
    pausedUntil: null,
    summaryTime: "21:30",
    style: "dang-yeu",
    hideOnLockScreen: false,
    mascot: true,
    reduceMotion: false,
  };
}

export function defaultAiConnection(now = Date.now()): AIConnectionMetadata {
  return { ...meta("ai", now, "ai-connection"), status: "chua-ket-noi", scopes: [], planUsage: false };
}

export function emptyState(timeZone: string, now = Date.now()): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    scheduleVersion: 1,
    profile: defaultProfile(timeZone, now),
    constraints: [],
    templates: [],
    occurrences: {},
    events: [],
    revisions: [],
    proposals: [],
    summaries: {},
    notificationSettings: defaultNotificationSettings(now),
    aiConnection: defaultAiConnection(now),
  };
}
