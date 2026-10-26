import { NextRequest, NextResponse } from "next/server";
import { saveDb, getSafetyMetrics } from "@/lib/store";

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("telegramUserId");
    const clearLogs = searchParams.get("clearLogs") === "true";

    const db = saveDb((state) => {
      if (clearLogs) {
        state.messageLogs = [];
      } else if (targetUserId) {
        state.repliedHistory = state.repliedHistory.filter(
          (r) => r.telegramUserId !== targetUserId
        );
      } else {
        state.repliedHistory = [];
      }
    });

    return NextResponse.json({
      repliedHistory: db.repliedHistory,
      messageLogs: db.messageLogs,
      metrics: getSafetyMetrics(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reset history" },
      { status: 500 }
    );
  }
}
