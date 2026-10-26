import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import {
  getDb,
  saveDb,
  getSafetyMetrics,
  getDecryptedServerCredentials,
  createId,
} from "./store";
import { encryptSecret } from "./crypto";
import {
  ChatType,
  MessageLogRecord,
  PipelineTraceStep,
} from "./types";

/**
 * Generates a cryptographically jittered human-like delay between minMs and maxMs.
 */
export function randomDelay(minMs: number, maxMs: number): number {
  const low = Math.min(minMs, maxMs);
  const high = Math.max(minMs, maxMs);
  return Math.floor(low + Math.random() * (high - low + 1));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Interpolates safe template variables: {{first_name}}, {{username}}, {{time}}, {{date}}
 */
export function interpolateTemplate(
  template: string,
  context: { firstName: string; username?: string | null }
): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = now.toLocaleDateString("uz-UZ");
  const cleanFirstName = context.firstName?.trim() || "Do‘stim";
  const cleanUsername =
    context.username?.replace(/^@/, "").trim() || cleanFirstName;

  return template
    .replace(/\{\{\s*first_name\s*\}\}/gi, cleanFirstName)
    .replace(/\{\{\s*username\s*\}\}/gi, cleanUsername)
    .replace(/\{\{\s*time\s*\}\}/gi, timeStr)
    .replace(/\{\{\s*date\s*\}\}/gi, dateStr);
}

interface PendingAuthFlow {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
}

interface EngineRuntime {
  client: TelegramClient | null;
  pendingAuth: PendingAuthFlow | null;
  onlineTimer: NodeJS.Timeout | null;
  initialized: boolean;
  reconnecting: boolean;
  handlerRef?: (event: NewMessageEvent) => Promise<void>;
  rawHandlerRef?: (update: Api.TypeUpdate) => Promise<void>;
  // Smart Owner Presence tracking
  ownerInTelegram: boolean;
  ownerLastActiveAt: number;
  lastBotPingAt: number;
  lastBotReplyAt: number;
  lastOwnerReadAtByPeer: Record<string, number>;
}

const globalForEngine = globalThis as unknown as {
  __safeReplyEngineRuntime?: EngineRuntime;
};

function getRuntime(): EngineRuntime {
  if (!globalForEngine.__safeReplyEngineRuntime) {
    globalForEngine.__safeReplyEngineRuntime = {
      client: null,
      pendingAuth: null,
      onlineTimer: null,
      initialized: false,
      reconnecting: false,
      ownerInTelegram: false,
      ownerLastActiveAt: 0,
      lastBotPingAt: 0,
      lastBotReplyAt: 0,
      lastOwnerReadAtByPeer: {},
    };
  }
  return globalForEngine.__safeReplyEngineRuntime;
}

/**
 * Returns true if the account owner is currently active inside their Telegram app
 * (opened Telegram, read a chat, or sent a message within the last 75 seconds,
 * and has not closed/exited the app).
 */
export function isOwnerCurrentlyInTelegram(): boolean {
  const runtime = getRuntime();
  if (!runtime.ownerInTelegram) return false;
  const elapsed = Date.now() - runtime.ownerLastActiveAt;
  if (elapsed > 75 * 1000) {
    runtime.ownerInTelegram = false;
    return false;
  }
  return true;
}

/**
 * Sends an immediate online/offline status update to Telegram MTProto
 */
async function pushTelegramOnlineStatus(online: boolean): Promise<void> {
  const runtime = getRuntime();
  if (!runtime.client) return;
  try {
    if (!runtime.client.connected) {
      await runtime.client.connect();
    }
    runtime.lastBotPingAt = Date.now();
    await runtime.client.invoke(
      new Api.account.UpdateStatus({ offline: !online })
    );
    if (online) {
      saveDb((state) => {
        state.session.lastOnlinePingAt = new Date().toISOString();
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("AUTH_KEY_UNREGISTERED") || errMsg.includes("SESSION_REVOKED")) {
      console.warn("[SafeReply] Telegram session expired/unregistered. Marking DISCONNECTED.");
      void disconnectTelegramSession();
    } else {
      console.warn("[SafeReply 24/7 Presence] Status update warning:", err);
    }
  }
}

/**
 * Keeps the Telegram account continuously Online 24/7 using a 38–48 second
 * heartbeat so Telegram's 60-second online timer never expires.
 */
export function syncOnlinePresenceScheduler(): void {
  const runtime = getRuntime();
  if (runtime.onlineTimer) {
    clearTimeout(runtime.onlineTimer);
    runtime.onlineTimer = null;
  }

  const db = getDb();
  if (
    !db.safetyConfig.online247Enabled ||
    db.safetyConfig.emergencyStop ||
    db.session.status !== "CONNECTED"
  ) {
    void pushTelegramOnlineStatus(false);
    saveDb((state) => {
      state.session.nextOnlinePingAt = null;
    });
    return;
  }

  // Immediately set account online right now
  void pushTelegramOnlineStatus(true);

  // Schedule next heartbeat in 38–48 seconds so Telegram NEVER drops to offline after 1-3 mins
  const jitterMs = randomDelay(38000, 48000);
  const nextPingAt = new Date(Date.now() + jitterMs).toISOString();

  saveDb((state) => {
    state.session.nextOnlinePingAt = nextPingAt;
  });

  runtime.onlineTimer = setTimeout(async () => {
    try {
      const currentDb = getDb();
      if (
        currentDb.safetyConfig.online247Enabled &&
        !currentDb.safetyConfig.emergencyStop &&
        currentDb.session.status === "CONNECTED"
      ) {
        await pushTelegramOnlineStatus(true);
      }
    } finally {
      syncOnlinePresenceScheduler();
    }
  }, jitterMs);
}

/**
 * Automatically restores the live GramJS TelegramClient connection from the
 * AES-256-GCM encrypted session vault on server start or reload.
 */
export async function ensureLiveClientConnected(): Promise<void> {
  const runtime = getRuntime();
  if (runtime.client && runtime.client.connected) {
    return;
  }
  if (runtime.reconnecting) {
    return;
  }

  const db = getDb();
  if (db.session.status !== "CONNECTED" || db.session.mode !== "LIVE_MTPROTO") {
    return;
  }

  const creds = getDecryptedServerCredentials();
  if (!creds.apiId || !creds.apiHash || !creds.sessionString) {
    return;
  }

  runtime.reconnecting = true;
  try {
    console.log("[SafeReply MTProto] Auto-connecting saved Telegram session...");
    const client = new TelegramClient(
      new StringSession(creds.sessionString.trim()),
      creds.apiId,
      creds.apiHash,
      {
        connectionRetries: 10,
        autoReconnect: true,
        useWSS: false,
      }
    );

    await client.connect();
    runtime.client = client;
    attachGramJsInterceptor(client);
    syncOnlinePresenceScheduler();
    console.log(
      "[SafeReply MTProto] Live Telegram Userbot connected & listening 24/7!"
    );
  } catch (err) {
    console.error("[SafeReply MTProto] Auto-connect error:", err);
  } finally {
    runtime.reconnecting = false;
  }
}

export interface IncomingMessagePayload {
  telegramUserId: string;
  username?: string | null;
  firstName: string;
  chatType: ChatType;
  text: string;
  isBot?: boolean;
  isForwarded?: boolean;
  isSimulated?: boolean;
  simulateRealTimeDelay?: boolean;
  peer?: unknown;
  rawMessage?: Api.Message;
}

/**
 * Core Anti-Ban Interceptor Pipeline with Smart Owner Presence Detection
 */
export async function runInterceptorPipeline(
  payload: IncomingMessagePayload
): Promise<MessageLogRecord> {
  const db = getDb();
  const config = db.safetyConfig;
  const runtime = getRuntime();
  const steps: PipelineTraceStep[] = [];
  const messageReceivedAt = Date.now();

  const cleanUserId = String(payload.telegramUserId).trim();
  const cleanUsername = payload.username
    ? payload.username.replace(/^@/, "").trim()
    : null;
  const cleanFirstName = payload.firstName?.trim() || "Telegram User";

  // =========================================================================
  // STAGE 1: Private Chat Check (Strictly Ignore Non-Private Chats Silently)
  // =========================================================================
  const isOfficialTelegram =
    cleanUserId === "777000" ||
    cleanUserId === "42777" ||
    cleanUsername?.toLowerCase() === "telegram";
  const isBotAccount =
    payload.isBot ||
    payload.chatType === "bot" ||
    Boolean(cleanUsername && cleanUsername.toLowerCase().endsWith("bot"));
  const isForwarded =
    payload.isForwarded || payload.chatType === "forwarded";
  const isGroupOrChannel =
    payload.chatType === "group" ||
    payload.chatType === "supergroup" ||
    payload.chatType === "channel" ||
    cleanUserId.startsWith("-100") ||
    cleanUserId.startsWith("-");

  if (
    (config.ignoreGroupsAndChannels && isGroupOrChannel) ||
    (config.ignoreBotsAndService && (isOfficialTelegram || isBotAccount)) ||
    (config.ignoreForwardedMessages && isForwarded)
  ) {
    return {
      id: createId("ignored"),
      telegramUserId: cleanUserId,
      username: cleanUsername,
      firstName: cleanFirstName,
      chatType: payload.chatType,
      incomingText: payload.text,
      outgoingText: null,
      segmentMatched: null,
      ruleMatched: "Private-Only Filter",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (Filtered)",
      status: "IGNORED_NON_PRIVATE",
      reason: "Non-private chat ignored.",
      isSimulated: Boolean(payload.isSimulated),
      pipelineSteps: [],
      createdAt: new Date().toISOString(),
    };
  }

  // Stage 0: Manual Pause / Emergency Stop Check
  if (config.emergencyStop || db.session.status === "EMERGENCY_STOP" || !config.autoReplyEnabled) {
    return recordAuditLog({
      payload,
      outgoingText: null,
      segmentMatched: null,
      ruleMatched: "Engine Paused",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (Paused)",
      status: "PAUSED_CONTACT",
      reason: "Auto-Reply tugmasi o‘chirilgan (Paused).",
      steps,
    });
  }

  // Smart Owner Presence Check: Is owner currently using Telegram?
  if (config.pauseWhenOwnerOnline !== false && isOwnerCurrentlyInTelegram()) {
    return recordAuditLog({
      payload,
      outgoingText: null,
      segmentMatched: null,
      ruleMatched: "Smart Owner Online",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (Siz Telegramdasiz)",
      status: "PAUSED_CONTACT",
      reason:
        "Siz hozir Telegram ilovasidasiz — avto-javob avtomatik to‘xtatildi.",
      steps,
    });
  }

  // =========================================================================
  // STAGE 2: Contact Lookup & Blacklist Check
  // =========================================================================
  const matchedContact = db.contacts.find(
    (c) =>
      c.telegramUserId === cleanUserId ||
      (cleanUsername &&
        c.username &&
        c.username.toLowerCase() === cleanUsername.toLowerCase()) ||
      (c.firstName &&
        c.firstName.trim().toLowerCase() === cleanFirstName.toLowerCase())
  );

  const matchedSegment = matchedContact
    ? db.segments.find((s) => s.id === matchedContact.segmentId)
    : db.segments.find((s) => s.slug === "general") || db.segments[0];

  if (
    matchedSegment &&
    (matchedSegment.isIgnored || matchedSegment.slug === "blacklist")
  ) {
    return recordAuditLog({
      payload,
      outgoingText: null,
      segmentMatched: matchedSegment.name,
      ruleMatched: "Blacklist Shield",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (Blocked)",
      status: "BLOCKED_BLACKLIST",
      reason: `Blacklist — javob yuborilmadi.`,
      steps,
    });
  }

  if (matchedContact?.isPaused) {
    return recordAuditLog({
      payload,
      outgoingText: null,
      segmentMatched: matchedSegment?.name || "VIP / Yaqinlar",
      ruleMatched: "Per-User Pause Switch",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (User Paused)",
      status: "PAUSED_CONTACT",
      reason: `${matchedContact.firstName} uchun avto-javob to‘xtatilgan.`,
      steps,
    });
  }

  // =========================================================================
  // STAGE 3: Reply-Once Enforcement (Already Replied Check)
  // =========================================================================
  const existingReply = db.repliedHistory.find(
    (r) => r.telegramUserId === cleanUserId
  );

  if (existingReply && config.replyCooldownMode !== "EVERY_MESSAGE") {
    const elapsedMs = Date.now() - new Date(existingReply.repliedAt).getTime();
    let cooldownStillActive = true;

    if (config.replyCooldownMode === "NEVER") {
      cooldownStillActive = true;
    } else if (config.replyCooldownMode === "AFTER_1H") {
      cooldownStillActive = elapsedMs < 60 * 60 * 1000;
    } else if (config.replyCooldownMode === "AFTER_24H") {
      cooldownStillActive = elapsedMs < 24 * 60 * 60 * 1000;
    } else if (config.replyCooldownMode === "AFTER_7D") {
      cooldownStillActive = elapsedMs < 7 * 24 * 60 * 60 * 1000;
    }

    if (cooldownStillActive) {
      const prevTime = new Date(existingReply.repliedAt).toLocaleTimeString(
        "uz-UZ",
        { hour: "2-digit", minute: "2-digit" }
      );
      return recordAuditLog({
        payload,
        outgoingText: null,
        segmentMatched: matchedSegment?.name || "General Public",
        ruleMatched: "Reply-Once Guard",
        initialDelayMs: 0,
        typingDurationMs: 0,
        totalDelayLabel: "0.0s (Skipped)",
        status: "SKIPPED_ALREADY_REPLIED",
        reason: `Allaqachon javob berilgan (${prevTime}). Qayta javob berish uchun "Qayta javob berish" tugmasini bosing.`,
        steps,
      });
    }
  }

  // =========================================================================
  // STAGE 4: Strict Rate-Limit Check (Hard Cap Max 15 / hour)
  // =========================================================================
  const metrics = getSafetyMetrics();
  const hardCap = Math.min(config.maxRepliesPerHour || 15, 15);

  if (metrics.repliesLastHour >= hardCap) {
    return recordAuditLog({
      payload,
      outgoingText: null,
      segmentMatched: matchedSegment?.name || "General Public",
      ruleMatched: "Hourly Flood Shield",
      initialDelayMs: 0,
      typingDurationMs: 0,
      totalDelayLabel: "0.0s (Throttled)",
      status: "THROTTLED_RATE_LIMIT",
      reason: `Soatlik limit (${metrics.repliesLastHour}/${hardCap}) to‘ldi.`,
      steps,
    });
  }

  // =========================================================================
  // STAGE 5: Humanized Delay & Typing Action Simulation
  // =========================================================================
  const minDelay = Math.max(4000, config.minDelayMs || 4000);
  const maxDelay = Math.max(minDelay, config.maxDelayMs || 9000);
  const minTyping = Math.max(2000, config.minTypingMs || 2000);
  const maxTyping = Math.max(minTyping, config.maxTypingMs || 4000);

  const initialDelayMs = randomDelay(minDelay, maxDelay); // 4000ms - 9000ms
  const typingDurationMs = randomDelay(minTyping, maxTyping); // 2000ms - 4000ms

  const shouldWaitRealTime =
    !payload.isSimulated || Boolean(payload.simulateRealTimeDelay);

  if (shouldWaitRealTime) {
    // 1. Wait randomized initial human reading delay (4–9s)
    await sleep(initialDelayMs);

    // Re-check if user paused auto-reply OR opened Telegram / read the message during the delay
    const midCheckDb = getDb();
    const ownerReadThisChat =
      (runtime.lastOwnerReadAtByPeer[cleanUserId] || 0) >= messageReceivedAt;

    if (
      !midCheckDb.safetyConfig.autoReplyEnabled ||
      midCheckDb.safetyConfig.emergencyStop ||
      (midCheckDb.safetyConfig.pauseWhenOwnerOnline !== false &&
        (isOwnerCurrentlyInTelegram() || ownerReadThisChat))
    ) {
      return recordAuditLog({
        payload,
        outgoingText: null,
        segmentMatched: null,
        ruleMatched: "Smart Owner Online",
        initialDelayMs,
        typingDurationMs: 0,
        totalDelayLabel: "0.0s (To‘xtatildi)",
        status: "PAUSED_CONTACT",
        reason: ownerReadThisChat
          ? "Siz xabarni o‘qidingiz — avto-javob bekor qilindi."
          : "Avto-javob to‘xtatildi (Siz Telegramdasiz yoki Pause bosildi).",
        steps,
      });
    }

    // 2. Dispatch "typing..." action via MTProto if live client is connected
    if (
      !payload.isSimulated &&
      runtime.client &&
      runtime.client.connected &&
      payload.peer
    ) {
      try {
        await runtime.client.invoke(
          new Api.messages.SetTyping({
            peer: payload.peer as Api.TypeInputPeer,
            action: new Api.SendMessageTypingAction(),
          })
        );
      } catch (err) {
        console.warn("[SafeReply Typing Action] Non-fatal warning:", err);
      }
    }

    // 3. Hold typing indicator for 2–4s before sending text
    await sleep(typingDurationMs);

    // Final check right before sending the message
    const finalCheckDb = getDb();
    const ownerReadNow =
      (runtime.lastOwnerReadAtByPeer[cleanUserId] || 0) >= messageReceivedAt;

    if (
      !finalCheckDb.safetyConfig.autoReplyEnabled ||
      finalCheckDb.safetyConfig.emergencyStop ||
      (finalCheckDb.safetyConfig.pauseWhenOwnerOnline !== false &&
        (isOwnerCurrentlyInTelegram() || ownerReadNow))
    ) {
      return recordAuditLog({
        payload,
        outgoingText: null,
        segmentMatched: null,
        ruleMatched: "Smart Owner Online",
        initialDelayMs,
        typingDurationMs,
        totalDelayLabel: "0.0s (To‘xtatildi)",
        status: "PAUSED_CONTACT",
        reason: ownerReadNow
          ? "Siz xabarni o‘qidingiz — avto-javob bekor qilindi."
          : "Avto-javob to‘xtatildi (Siz Telegramdasiz yoki Pause bosildi).",
        steps,
      });
    }
  }

  const initialSec = (initialDelayMs / 1000).toFixed(1);
  const typingSec = (typingDurationMs / 1000).toFixed(1);
  const totalDelayLabel = `Waited ${initialSec}s + ${typingSec}s typing`;

  // =========================================================================
  // STAGE 6: Template Resolution & DM Dispatch
  // =========================================================================
  const rawTemplate =
    matchedContact?.customTemplate?.trim() ||
    matchedSegment?.template ||
    "Assalomu alaykum, {{first_name}}! Xabaringiz uchun rahmat. Bo‘shaganimda javob yozaman.";

  const outgoingText = interpolateTemplate(rawTemplate, {
    firstName: cleanFirstName,
    username: cleanUsername,
  });

  const ruleMatchedLabel = matchedContact?.customTemplate?.trim()
    ? `${matchedSegment?.name || "VIP"} (Custom Override)`
    : matchedSegment?.name || "General Public";

  if (!payload.isSimulated && runtime.client && runtime.client.connected) {
    runtime.lastBotReplyAt = Date.now();
    if (payload.rawMessage) {
      await payload.rawMessage.respond({ message: outgoingText });
    } else if (payload.peer) {
      await runtime.client.sendMessage(payload.peer as Api.TypeEntityLike, {
        message: outgoingText,
      });
    }
  }

  // =========================================================================
  // STAGE 7: Record in RepliedHistory & Audit Log
  // =========================================================================
  saveDb((state) => {
    const existingIdx = state.repliedHistory.findIndex(
      (r) => r.telegramUserId === cleanUserId
    );
    const nowIso = new Date().toISOString();

    if (existingIdx >= 0) {
      state.repliedHistory[existingIdx] = {
        ...state.repliedHistory[existingIdx],
        username: cleanUsername || state.repliedHistory[existingIdx].username,
        firstName: cleanFirstName,
        repliedAt: nowIso,
        ruleMatched: ruleMatchedLabel,
        lastReplyText: outgoingText,
        replyCount: state.repliedHistory[existingIdx].replyCount + 1,
      };
    } else {
      state.repliedHistory.unshift({
        id: createId("rep"),
        telegramUserId: cleanUserId,
        username: cleanUsername,
        firstName: cleanFirstName,
        repliedAt: nowIso,
        ruleMatched: ruleMatchedLabel,
        lastReplyText: outgoingText,
        replyCount: 1,
      });
    }
  });

  return recordAuditLog({
    payload,
    outgoingText,
    segmentMatched: matchedSegment?.name || "General Public",
    ruleMatched: ruleMatchedLabel,
    initialDelayMs,
    typingDurationMs,
    totalDelayLabel,
    status: "DELIVERED",
    reason: "Humanized delay + typing simulation completed safely.",
    steps,
  });
}

function recordAuditLog(params: {
  payload: IncomingMessagePayload;
  outgoingText: string | null;
  segmentMatched: string | null;
  ruleMatched: string | null;
  initialDelayMs: number;
  typingDurationMs: number;
  totalDelayLabel: string;
  status: MessageLogRecord["status"];
  reason: string;
  steps: PipelineTraceStep[];
}): MessageLogRecord {
  const entry: MessageLogRecord = {
    id: createId("log"),
    telegramUserId: String(params.payload.telegramUserId).trim(),
    username: params.payload.username
      ? params.payload.username.replace(/^@/, "").trim()
      : null,
    firstName: params.payload.firstName?.trim() || "Unknown",
    chatType: params.payload.chatType,
    incomingText: params.payload.text,
    outgoingText: params.outgoingText,
    segmentMatched: params.segmentMatched,
    ruleMatched: params.ruleMatched,
    initialDelayMs: params.initialDelayMs,
    typingDurationMs: params.typingDurationMs,
    totalDelayLabel: params.totalDelayLabel,
    status: params.status,
    reason: params.reason,
    isSimulated: Boolean(params.payload.isSimulated),
    pipelineSteps: params.steps,
    createdAt: new Date().toISOString(),
  };

  saveDb((state) => {
    state.messageLogs.unshift(entry);
    if (state.messageLogs.length > 250) {
      state.messageLogs = state.messageLogs.slice(0, 250);
    }
  });

  return entry;
}

/**
 * Attaches both the Incoming DM Interceptor AND the Smart Owner Activity Listener
 */
function attachGramJsInterceptor(client: TelegramClient): void {
  const runtime = getRuntime();
  if (runtime.handlerRef) {
    try {
      client.removeEventHandler(
        runtime.handlerRef,
        new NewMessage({})
      );
    } catch {
      // ignore
    }
  }
  if (runtime.rawHandlerRef) {
    try {
      client.removeEventHandler(
        runtime.rawHandlerRef,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any
      );
    } catch {
      // ignore
    }
  }

  // 1. Raw MTProto Update Listener: Detects when Owner enters or exits Telegram
  const rawHandler = async (update: Api.TypeUpdate) => {
    try {
      const db = getDb();
      const myUserId = db.session.telegramUserId;

      // A) Detect when owner opens or closes their Telegram app (UserStatusOnline / UserStatusOffline)
      if (update instanceof Api.UpdateUserStatus) {
        const updatedUserId = String(update.userId);
        if (myUserId && updatedUserId === String(myUserId)) {
          if (update.status instanceof Api.UserStatusOnline) {
            // Ignore if this status update was triggered by our own 24/7 bot ping within the last 4 seconds
            if (Date.now() - runtime.lastBotPingAt > 4000) {
              runtime.ownerInTelegram = true;
              runtime.ownerLastActiveAt = Date.now();
              console.log(
                "[Smart Presence] Owner opened Telegram app -> Auto-Reply paused automatically."
              );
            }
          } else if (update.status instanceof Api.UserStatusOffline) {
            // Owner closed/minimized their Telegram app!
            runtime.ownerInTelegram = false;
            runtime.ownerLastActiveAt = 0;
            console.log(
              "[Smart Presence] Owner exited Telegram app -> Auto-Reply turned ON automatically!"
            );

            // If 24/7 Online is enabled, immediately re-assert Online status so account stays Online 24/7
            if (
              db.safetyConfig.online247Enabled &&
              !db.safetyConfig.emergencyStop
            ) {
              setTimeout(() => {
                void pushTelegramOnlineStatus(true);
              }, 1500);
            }
          }
        }
      }

      // B) Detect when owner reads messages inside any private chat
      if (update instanceof Api.UpdateReadHistoryInbox) {
        if (
          update.peer instanceof Api.PeerUser &&
          Date.now() - runtime.lastBotReplyAt > 3000
        ) {
          const peerUserId = String(update.peer.userId);
          runtime.lastOwnerReadAtByPeer[peerUserId] = Date.now();
          runtime.ownerInTelegram = true;
          runtime.ownerLastActiveAt = Date.now();
        }
      }
    } catch {
      // ignore raw update parse errors
    }
  };

  // 2. Message Listener: Handles both Owner's manual outgoing messages and Incoming DMs
  const handler = async (event: NewMessageEvent) => {
    try {
      const message = event.message;
      if (!message) return;

      // If this is an outgoing message sent manually by the owner (not by our bot)
      if (message.out) {
        if (Date.now() - runtime.lastBotReplyAt > 3500) {
          runtime.ownerInTelegram = true;
          runtime.ownerLastActiveAt = Date.now();
        }
        return;
      }

      const text = message.message || "";
      if (!text.trim()) return;

      const isPrivate = Boolean(event.isPrivate);
      const isGroup = Boolean(event.isGroup);
      const isChannel = Boolean(event.isChannel);
      const isForwarded = Boolean(message.fwdFrom);

      let chatType: ChatType = "private";
      if (isChannel) chatType = "channel";
      else if (isGroup) chatType = "group";
      else if (!isPrivate) chatType = "supergroup";

      // Quickly ignore groups/channels before making extra API calls
      if (chatType !== "private") return;

      const sender = (await message.getSender()) as Api.User | undefined;
      const inputChat = await message.getInputChat().catch(() => message.peerId);
      const senderId = sender?.id
        ? String(sender.id)
        : message.senderId
        ? String(message.senderId)
        : "unknown";
      const isBot = Boolean(sender && "bot" in sender && sender.bot);
      const firstName =
        sender && "firstName" in sender && sender.firstName
          ? sender.firstName
          : "Telegram User";
      const username =
        sender && "username" in sender && sender.username
          ? sender.username
          : null;

      await runInterceptorPipeline({
        telegramUserId: senderId,
        username,
        firstName,
        chatType,
        text,
        isBot,
        isForwarded,
        isSimulated: false,
        peer: inputChat || message.peerId,
        rawMessage: message,
      });
    } catch (err) {
      console.error("[SafeReply GramJS Interceptor Error]:", err);
    }
  };

  runtime.rawHandlerRef = rawHandler;
  runtime.handlerRef = handler;
  client.addEventHandler(rawHandler);
  client.addEventHandler(handler, new NewMessage({}));
}

export async function startTelegramAuthCode(params: {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
}): Promise<{ status: string; message: string }> {
  const runtime = getRuntime();
  const { apiId, apiHash, phoneNumber } = params;

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    useWSS: false,
  });

  await client.connect();
  const result = await client.sendCode({ apiId, apiHash }, phoneNumber);

  runtime.pendingAuth = {
    client,
    apiId,
    apiHash,
    phoneNumber,
    phoneCodeHash: result.phoneCodeHash,
  };

  saveDb((state) => {
    state.session.apiId = apiId;
    state.session.encryptedApiHash = encryptSecret(apiHash);
    state.session.phoneNumber = phoneNumber;
    state.session.status = "AWAITING_CODE";
    state.session.updatedAt = new Date().toISOString();
  });

  return {
    status: "AWAITING_CODE",
    message: "Verification code dispatched to your Telegram app.",
  };
}

export async function verifyTelegramAuthCode(params: {
  code?: string;
  password?: string;
}): Promise<{ status: string; message: string }> {
  const runtime = getRuntime();
  const pending = runtime.pendingAuth;

  if (!pending) {
    throw new Error(
      "No active pending verification session found. Please request a login code first."
    );
  }

  const { client, apiId, apiHash, phoneNumber, phoneCodeHash } = pending;

  try {
    if (params.code) {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: params.code.trim(),
        })
      );
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("SESSION_PASSWORD_NEEDED")) {
      if (!params.password) {
        saveDb((state) => {
          state.session.status = "AWAITING_2FA";
          state.session.updatedAt = new Date().toISOString();
        });
        return {
          status: "AWAITING_2FA",
          message:
            "2FA Cloud Password is enabled on this account. Please enter your 2FA password.",
        };
      }
      await client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => params.password || "",
          onError: (e) => {
            throw e;
          },
        }
      );
    } else {
      throw err;
    }
  }

  if (params.password && !params.code) {
    await client.signInWithPassword(
      { apiId, apiHash },
      {
        password: async () => params.password || "",
        onError: (e) => {
          throw e;
        },
      }
    );
  }

  const me = (await client.getMe()) as Api.User;
  const sessionString = client.session.save() as unknown as string;

  runtime.client = client;
  runtime.pendingAuth = null;
  attachGramJsInterceptor(client);

  const nowIso = new Date().toISOString();
  saveDb((state) => {
    state.session.encryptedSessionStr = encryptSecret(sessionString);
    state.session.username = me?.username || null;
    state.session.firstName = me?.firstName || "Telegram User";
    state.session.telegramUserId = me?.id ? String(me.id) : null;
    state.session.status = "CONNECTED";
    state.session.mode = "LIVE_MTPROTO";
    state.session.lastOnlinePingAt = nowIso;
    state.session.updatedAt = nowIso;
    state.safetyConfig.autoReplyEnabled = true;
    state.safetyConfig.emergencyStop = false;
  });

  syncOnlinePresenceScheduler();

  return {
    status: "CONNECTED",
    message: `Connected to live MTProto session as ${me?.firstName || "user"}.`,
  };
}

export async function connectSafeAccountProfile(params: {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  username?: string;
  firstName?: string;
  sessionString?: string;
}): Promise<{ status: string; message: string }> {
  const runtime = getRuntime();
  const nowIso = new Date().toISOString();

  if (params.sessionString && params.sessionString.trim().length > 30) {
    const client = new TelegramClient(
      new StringSession(params.sessionString.trim()),
      params.apiId,
      params.apiHash,
      { connectionRetries: 5, autoReconnect: true }
    );
    await client.connect();
    const me = (await client.getMe()) as Api.User;
    runtime.client = client;
    attachGramJsInterceptor(client);

    saveDb((state) => {
      state.session.apiId = params.apiId;
      state.session.encryptedApiHash = encryptSecret(params.apiHash);
      state.session.encryptedSessionStr = encryptSecret(
        params.sessionString!.trim()
      );
      state.session.phoneNumber = params.phoneNumber;
      state.session.username = me?.username || params.username || null;
      state.session.firstName =
        me?.firstName || params.firstName || "Telegram User";
      state.session.telegramUserId = me?.id ? String(me.id) : null;
      state.session.status = "CONNECTED";
      state.session.mode = "LIVE_MTPROTO";
      state.session.lastOnlinePingAt = nowIso;
      state.session.updatedAt = nowIso;
      state.safetyConfig.emergencyStop = false;
      state.safetyConfig.autoReplyEnabled = true;
    });

    syncOnlinePresenceScheduler();
    return {
      status: "CONNECTED",
      message: "Live GramJS MTProto session verified and connected.",
    };
  }

  return {
    status: "DISCONNECTED",
    message: "Please connect using Telegram Login Code.",
  };
}

export async function disconnectTelegramSession(): Promise<void> {
  const runtime = getRuntime();
  if (runtime.onlineTimer) {
    clearTimeout(runtime.onlineTimer);
    runtime.onlineTimer = null;
  }
  if (runtime.client) {
    try {
      await runtime.client.disconnect();
    } catch {
      // ignore
    }
    runtime.client = null;
  }
  runtime.pendingAuth = null;

  saveDb((state) => {
    state.session.status = "DISCONNECTED";
    state.session.encryptedSessionStr = null;
    state.session.nextOnlinePingAt = null;
    state.session.updatedAt = new Date().toISOString();
  });
}

export function triggerEmergencyStop(engage: boolean): void {
  const runtime = getRuntime();
  if (engage && runtime.onlineTimer) {
    clearTimeout(runtime.onlineTimer);
    runtime.onlineTimer = null;
  }

  saveDb((state) => {
    state.safetyConfig.emergencyStop = engage;
    state.safetyConfig.autoReplyEnabled = !engage;
    state.session.status = engage ? "EMERGENCY_STOP" : "CONNECTED";
    if (engage) {
      state.session.nextOnlinePingAt = null;
    }
    state.safetyConfig.updatedAt = new Date().toISOString();
    state.session.updatedAt = new Date().toISOString();
  });

  if (!engage) {
    syncOnlinePresenceScheduler();
  }
}

// Auto-connect saved live MTProto session on server startup
const bootRuntime = getRuntime();
if (bootRuntime.client) {
  attachGramJsInterceptor(bootRuntime.client);
} else {
  void ensureLiveClientConnected();
}
if (!bootRuntime.initialized) {
  bootRuntime.initialized = true;
  syncOnlinePresenceScheduler();
}
