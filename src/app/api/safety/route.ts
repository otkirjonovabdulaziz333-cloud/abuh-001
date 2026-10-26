import { NextRequest, NextResponse } from "next/server";
import { saveDb, getPublicSession, getSafetyMetrics } from "@/lib/store";
import {
  triggerEmergencyStop,
  syncOnlinePresenceScheduler,
} from "@/lib/mtproto-engine";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    if (
      typeof body.emergencyStop === "boolean" &&
      typeof body.autoReplyEnabled !== "boolean"
    ) {
      triggerEmergencyStop(body.emergencyStop);
      const db = saveDb(() => {});
      return NextResponse.json({
        safetyConfig: db.safetyConfig,
        session: getPublicSession(),
        metrics: getSafetyMetrics(),
      });
    }

    const db = saveDb((state) => {
      const cfg = state.safetyConfig;
      if (typeof body.autoReplyEnabled === "boolean") {
        cfg.autoReplyEnabled = body.autoReplyEnabled;
        if (body.autoReplyEnabled) {
          cfg.emergencyStop = false;
          if (state.session.status === "EMERGENCY_STOP") {
            state.session.status = "CONNECTED";
          }
        }
      }
      if (typeof body.online247Enabled === "boolean") {
        cfg.online247Enabled = body.online247Enabled;
      }
      if (typeof body.pauseWhenOwnerOnline === "boolean") {
        cfg.pauseWhenOwnerOnline = body.pauseWhenOwnerOnline;
      }
      if (typeof body.maxRepliesPerHour === "number") {
        cfg.maxRepliesPerHour = Math.max(
          1,
          Math.min(15, Math.round(body.maxRepliesPerHour))
        );
      }
      if (typeof body.minDelayMs === "number") {
        cfg.minDelayMs = Math.max(4000, Math.min(15000, body.minDelayMs));
      }
      if (typeof body.maxDelayMs === "number") {
        cfg.maxDelayMs = Math.max(
          cfg.minDelayMs,
          Math.min(20000, body.maxDelayMs)
        );
      }
      if (typeof body.minTypingMs === "number") {
        cfg.minTypingMs = Math.max(2000, Math.min(8000, body.minTypingMs));
      }
      if (typeof body.maxTypingMs === "number") {
        cfg.maxTypingMs = Math.max(
          cfg.minTypingMs,
          Math.min(10000, body.maxTypingMs)
        );
      }
      if (
        body.replyCooldownMode &&
        [
          "EVERY_MESSAGE",
          "NEVER",
          "AFTER_1H",
          "AFTER_24H",
          "AFTER_7D",
        ].includes(body.replyCooldownMode)
      ) {
        cfg.replyCooldownMode = body.replyCooldownMode;
      }
      if (typeof body.ignoreGroupsAndChannels === "boolean") {
        cfg.ignoreGroupsAndChannels = body.ignoreGroupsAndChannels;
      }
      if (typeof body.ignoreBotsAndService === "boolean") {
        cfg.ignoreBotsAndService = body.ignoreBotsAndService;
      }
      if (typeof body.ignoreForwardedMessages === "boolean") {
        cfg.ignoreForwardedMessages = body.ignoreForwardedMessages;
      }
      cfg.updatedAt = new Date().toISOString();
    });

    syncOnlinePresenceScheduler();

    return NextResponse.json({
      safetyConfig: db.safetyConfig,
      session: getPublicSession(),
      metrics: getSafetyMetrics(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update safety config" },
      { status: 500 }
    );
  }
}
