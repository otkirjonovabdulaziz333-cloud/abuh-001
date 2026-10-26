import { NextRequest, NextResponse } from "next/server";
import { runInterceptorPipeline } from "@/lib/mtproto-engine";
import { getDb, getSafetyMetrics } from "@/lib/store";
import { ChatType } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telegramUserId = String(body.telegramUserId || "884920112").trim();
    const username = body.username
      ? String(body.username).replace(/^@/, "").trim()
      : null;
    const firstName = String(body.firstName || "Otabek").trim();
    const chatType: ChatType = body.chatType || "private";
    const text = String(
      body.text || "Assalomu alaykum! Bo‘shaganingizda yozvorasizmi?"
    ).trim();
    const isBot = Boolean(body.isBot);
    const isForwarded = Boolean(body.isForwarded);
    const simulateRealTimeDelay = Boolean(body.simulateRealTimeDelay);

    const logEntry = await runInterceptorPipeline({
      telegramUserId,
      username,
      firstName,
      chatType,
      text,
      isBot,
      isForwarded,
      isSimulated: true,
      simulateRealTimeDelay,
    });

    const db = getDb();
    return NextResponse.json({
      logEntry,
      repliedHistory: db.repliedHistory,
      messageLogs: db.messageLogs,
      metrics: getSafetyMetrics(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 }
    );
  }
}
