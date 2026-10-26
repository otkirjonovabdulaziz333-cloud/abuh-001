import { NextResponse } from "next/server";
import { getDb, getPublicSession, getSafetyMetrics } from "@/lib/store";
import {
  ensureLiveClientConnected,
  isOwnerCurrentlyInTelegram,
} from "@/lib/mtproto-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  void ensureLiveClientConnected();
  const db = getDb();
  return NextResponse.json({
    session: {
      ...getPublicSession(),
      ownerCurrentlyInTelegram: isOwnerCurrentlyInTelegram(),
    },
    safetyConfig: db.safetyConfig,
    metrics: getSafetyMetrics(),
    segments: db.segments,
    contacts: db.contacts,
    repliedHistory: db.repliedHistory,
    messageLogs: db.messageLogs,
  });
}
