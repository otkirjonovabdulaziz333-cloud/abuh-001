export type ConnectionStatus =
  | "DISCONNECTED"
  | "AWAITING_CODE"
  | "AWAITING_2FA"
  | "CONNECTED"
  | "EMERGENCY_STOP";

export type ReplyCooldownMode =
  | "EVERY_MESSAGE"
  | "NEVER"
  | "AFTER_24H"
  | "AFTER_7D"
  | "AFTER_1H";

export type DeliveryStatus =
  | "DELIVERED"
  | "SKIPPED_ALREADY_REPLIED"
  | "BLOCKED_BLACKLIST"
  | "IGNORED_NON_PRIVATE"
  | "THROTTLED_RATE_LIMIT"
  | "PAUSED_CONTACT"
  | "EMERGENCY_STOPPED";

export type ChatType =
  | "private"
  | "group"
  | "supergroup"
  | "channel"
  | "bot"
  | "forwarded";

export interface SessionRecord {
  id: string;
  apiId: number | null;
  encryptedApiHash: string | null; // AES-256-GCM encrypted
  encryptedSessionStr: string | null; // AES-256-GCM encrypted
  phoneNumber: string | null;
  username: string | null;
  firstName: string | null;
  telegramUserId: string | null;
  status: ConnectionStatus;
  mode: "LIVE_MTPROTO" | "SAFE_GUARD_READY";
  lastOnlinePingAt: string | null;
  nextOnlinePingAt: string | null;
  updatedAt: string;
  createdAt: string;
}

/**
 * Sanitized session DTO safe for API responses & frontend state.
 * Never includes session strings or api_hash!
 */
export interface PublicSessionDTO {
  status: ConnectionStatus;
  mode: "LIVE_MTPROTO" | "SAFE_GUARD_READY";
  hasEncryptedSession: boolean;
  hasApiCredentials: boolean;
  maskedApiId: string | null;
  maskedPhone: string;
  username: string | null;
  firstName: string | null;
  telegramUserId: string | null;
  lastOnlinePingAt: string | null;
  nextOnlinePingAt: string | null;
  ownerCurrentlyInTelegram?: boolean;
  updatedAt: string;
}

export interface SegmentRecord {
  id: string;
  name: string; // "VIP / Yaqinlar", "Mijozlar", "General Public", "Blacklist"
  slug: "vip" | "clients" | "general" | "blacklist" | string;
  description: string;
  template: string;
  isIgnored: boolean;
  badgeColor: "emerald" | "indigo" | "amber" | "rose" | "sky";
  priority: number;
  enabled: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface ContactRecord {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  segmentId: string;
  customTemplate: string | null;
  isPaused: boolean;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface RepliedHistoryRecord {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  repliedAt: string;
  ruleMatched: string;
  lastReplyText: string | null;
  replyCount: number;
}

export interface MessageLogRecord {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string;
  chatType: ChatType;
  incomingText: string;
  outgoingText: string | null;
  segmentMatched: string | null;
  ruleMatched: string | null;
  initialDelayMs: number;
  typingDurationMs: number;
  totalDelayLabel: string;
  status: DeliveryStatus;
  reason: string | null;
  isSimulated: boolean;
  pipelineSteps?: PipelineTraceStep[];
  createdAt: string;
}

export interface SafetyConfigRecord {
  id: string;
  autoReplyEnabled: boolean;
  pauseWhenOwnerOnline?: boolean;
  emergencyStop: boolean;
  online247Enabled: boolean;
  maxRepliesPerHour: number; // Hard cap 15
  minDelayMs: number; // 4000
  maxDelayMs: number; // 9000
  minTypingMs: number; // 2000
  maxTypingMs: number; // 4000
  minOnlineIntervalSec: number; // 40
  maxOnlineIntervalSec: number; // 55
  replyCooldownMode: ReplyCooldownMode;
  ignoreGroupsAndChannels: boolean;
  ignoreBotsAndService: boolean;
  ignoreForwardedMessages: boolean;
  updatedAt: string;
}

export interface PipelineTraceStep {
  step: number;
  name: string;
  status: "PASSED" | "BLOCKED" | "SKIPPED" | "EXECUTED";
  detail: string;
  durationMs?: number;
}

export interface SafetyMetricsDTO {
  repliesLastHour: number;
  maxRepliesPerHour: number;
  remainingHourlyQuota: number;
  healthStatus: "SAFE" | "APPROACHING_LIMIT" | "THROTTLED" | "EMERGENCY_STOP";
  totalDelivered: number;
  totalSkippedAlreadyReplied: number;
  totalBlockedBlacklist: number;
  totalIgnoredNonPrivate: number;
  totalThrottled: number;
  activeRepliedUsersCount: number;
}
