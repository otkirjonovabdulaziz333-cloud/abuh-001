import fs from "fs";
import path from "path";
import crypto from "crypto";
import { decryptSecret, maskPhone } from "./crypto";
import {
  SessionRecord,
  PublicSessionDTO,
  SegmentRecord,
  ContactRecord,
  RepliedHistoryRecord,
  MessageLogRecord,
  SafetyConfigRecord,
  SafetyMetricsDTO,
} from "./types";

interface DatabaseState {
  session: SessionRecord;
  safetyConfig: SafetyConfigRecord;
  segments: SegmentRecord[];
  contacts: ContactRecord[];
  repliedHistory: RepliedHistoryRecord[];
  messageLogs: MessageLogRecord[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "safereply-store.json");

function createInitialSeed(): DatabaseState {
  const nowIso = new Date().toISOString();

  const segments: SegmentRecord[] = [
    {
      id: "seg-general",
      name: "General Public",
      slug: "general",
      description:
        "Default auto-reply message for everyone who writes to you in private.",
      template:
        "Assalomu alaykum, {{first_name}}! Xabaringiz uchun rahmat. Hozir tarmoqda bandman, bo‘shaganimda xabaringizni ko‘rib chiqaman. (Avto-javob)",
      isIgnored: false,
      badgeColor: "sky",
      priority: 3,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "seg-vip",
      name: "VIP / Yaqinlar",
      slug: "vip",
      description: "Close family & VIP contacts in Tanlangan Odamlar.",
      template:
        "Assalomu alaykum, {{first_name}}! Hozir biroz band edim, lekin xabaringizni ko‘rdim — bo‘shashim bilan birinchi bo‘lib sizga aloqaga chiqaman.",
      isIgnored: false,
      badgeColor: "emerald",
      priority: 1,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "seg-clients",
      name: "Mijozlar",
      slug: "clients",
      description: "Business clients in Tanlangan Odamlar.",
      template:
        "Assalomu alaykum, hurmatli {{first_name}}! Murojaatingiz qabul qilindi. Yaqin orada javob yozaman.",
      isIgnored: false,
      badgeColor: "indigo",
      priority: 2,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "seg-blacklist",
      name: "Blacklist",
      slug: "blacklist",
      description: "Ignored contacts (never receives an auto-reply).",
      template: "",
      isIgnored: true,
      badgeColor: "rose",
      priority: 0,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  return {
    session: {
      id: "primary",
      apiId: null,
      encryptedApiHash: null,
      encryptedSessionStr: null,
      phoneNumber: null,
      username: null,
      firstName: null,
      telegramUserId: null,
      status: "DISCONNECTED",
      mode: "LIVE_MTPROTO",
      lastOnlinePingAt: null,
      nextOnlinePingAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    safetyConfig: {
      id: "default",
      autoReplyEnabled: true,
      emergencyStop: false,
      online247Enabled: true,
      maxRepliesPerHour: 15,
      minDelayMs: 4000,
      maxDelayMs: 9000,
      minTypingMs: 2000,
      maxTypingMs: 4000,
      minOnlineIntervalSec: 240,
      maxOnlineIntervalSec: 420,
      replyCooldownMode: "NEVER",
      ignoreGroupsAndChannels: true,
      ignoreBotsAndService: true,
      ignoreForwardedMessages: true,
      updatedAt: nowIso,
    },
    segments,
    contacts: [],
    repliedHistory: [],
    messageLogs: [],
  };
}

function loadStoreFromDisk(): DatabaseState {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf8");
      if (raw.trim()) {
        return JSON.parse(raw) as DatabaseState;
      }
    }
  } catch (err) {
    console.error("[SafeReply Store] Failed to read disk store:", err);
  }

  const seeded = createInitialSeed();
  persistStoreToDisk(seeded);
  return seeded;
}

function persistStoreToDisk(state: DatabaseState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("[SafeReply Store] Failed to persist store:", err);
  }
}

export function getDb(): DatabaseState {
  return loadStoreFromDisk();
}

export function saveDb(mutator: (db: DatabaseState) => void): DatabaseState {
  const db = loadStoreFromDisk();
  mutator(db);
  persistStoreToDisk(db);
  return db;
}

export function getPublicSession(): PublicSessionDTO {
  const { session } = getDb();
  const apiIdStr = session.apiId ? String(session.apiId) : null;
  const maskedApiId =
    apiIdStr && apiIdStr.length > 4
      ? `${apiIdStr.slice(0, 2)}••••${apiIdStr.slice(-2)}`
      : apiIdStr;

  return {
    status: session.status,
    mode: session.mode,
    hasEncryptedSession: Boolean(session.encryptedSessionStr),
    hasApiCredentials: Boolean(session.apiId && session.encryptedApiHash),
    maskedApiId,
    maskedPhone: maskPhone(session.phoneNumber),
    username: session.username,
    firstName: session.firstName,
    telegramUserId: session.telegramUserId,
    lastOnlinePingAt: session.lastOnlinePingAt,
    nextOnlinePingAt: session.nextOnlinePingAt,
    updatedAt: session.updatedAt,
  };
}

export function getDecryptedServerCredentials(): {
  apiId: number | null;
  apiHash: string;
  sessionString: string;
  phoneNumber: string | null;
} {
  const { session } = getDb();
  return {
    apiId: session.apiId,
    apiHash: decryptSecret(session.encryptedApiHash),
    sessionString: decryptSecret(session.encryptedSessionStr),
    phoneNumber: session.phoneNumber,
  };
}

export function getSafetyMetrics(): SafetyMetricsDTO {
  const db = getDb();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  const repliesLastHour = db.messageLogs.filter(
    (log) =>
      log.status === "DELIVERED" &&
      new Date(log.createdAt).getTime() >= oneHourAgo
  ).length;

  const maxRepliesPerHour = Math.min(db.safetyConfig.maxRepliesPerHour || 15, 15);
  const remainingHourlyQuota = Math.max(0, maxRepliesPerHour - repliesLastHour);

  let healthStatus: SafetyMetricsDTO["healthStatus"] = "SAFE";
  if (db.safetyConfig.emergencyStop || db.session.status === "EMERGENCY_STOP") {
    healthStatus = "EMERGENCY_STOP";
  } else if (repliesLastHour >= maxRepliesPerHour) {
    healthStatus = "THROTTLED";
  } else if (repliesLastHour >= Math.floor(maxRepliesPerHour * 0.75)) {
    healthStatus = "APPROACHING_LIMIT";
  }

  return {
    repliesLastHour,
    maxRepliesPerHour,
    remainingHourlyQuota,
    healthStatus,
    totalDelivered: db.messageLogs.filter((l) => l.status === "DELIVERED").length,
    totalSkippedAlreadyReplied: db.messageLogs.filter(
      (l) => l.status === "SKIPPED_ALREADY_REPLIED"
    ).length,
    totalBlockedBlacklist: db.messageLogs.filter(
      (l) => l.status === "BLOCKED_BLACKLIST"
    ).length,
    totalIgnoredNonPrivate: db.messageLogs.filter(
      (l) => l.status === "IGNORED_NON_PRIVATE"
    ).length,
    totalThrottled: db.messageLogs.filter(
      (l) => l.status === "THROTTLED_RATE_LIMIT"
    ).length,
    activeRepliedUsersCount: db.repliedHistory.length,
  };
}

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}
