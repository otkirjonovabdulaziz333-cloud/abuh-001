import { NextRequest, NextResponse } from "next/server";
import {
  startTelegramAuthCode,
  verifyTelegramAuthCode,
  connectSafeAccountProfile,
  disconnectTelegramSession,
  syncOnlinePresenceScheduler,
} from "@/lib/mtproto-engine";
import {
  getPublicSession,
  getDecryptedServerCredentials,
  saveDb,
} from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "send_code") {
      const saved = getDecryptedServerCredentials();
      const apiId = Number(body.apiId) || saved.apiId;
      const apiHash = String(body.apiHash || "").trim() || saved.apiHash;
      const phoneNumber =
        String(body.phoneNumber || "").trim() || saved.phoneNumber || "";

      if (!apiId || !apiHash || !phoneNumber) {
        return NextResponse.json(
          { error: "api_id, api_hash, and phone number are required." },
          { status: 400 }
        );
      }

      const res = await startTelegramAuthCode({ apiId, apiHash, phoneNumber });
      return NextResponse.json({
        ...res,
        session: getPublicSession(),
      });
    }

    if (action === "verify_code") {
      const code = body.code ? String(body.code).trim() : undefined;
      const password = body.password ? String(body.password) : undefined;

      const res = await verifyTelegramAuthCode({ code, password });
      return NextResponse.json({
        ...res,
        session: getPublicSession(),
      });
    }

    if (action === "connect_vault") {
      const saved = getDecryptedServerCredentials();
      const apiId = Number(body.apiId) || saved.apiId || 0;
      const apiHash = String(body.apiHash || "").trim() || saved.apiHash;
      const phoneNumber =
        String(body.phoneNumber || "").trim() || saved.phoneNumber || "";
      const username = body.username ? String(body.username).trim() : undefined;
      const firstName = body.firstName
        ? String(body.firstName).trim()
        : undefined;
      const sessionString = body.sessionString
        ? String(body.sessionString).trim()
        : undefined;

      const res = await connectSafeAccountProfile({
        apiId,
        apiHash,
        phoneNumber,
        username,
        firstName,
        sessionString,
      });

      return NextResponse.json({
        ...res,
        session: getPublicSession(),
      });
    }

    if (action === "disconnect") {
      await disconnectTelegramSession();
      return NextResponse.json({
        status: "DISCONNECTED",
        message: "MTProto session disconnected and local session token wiped.",
        session: getPublicSession(),
      });
    }

    if (action === "ping_online") {
      saveDb((state) => {
        state.session.lastOnlinePingAt = new Date().toISOString();
      });
      syncOnlinePresenceScheduler();
      return NextResponse.json({
        message: "Online status touched.",
        session: getPublicSession(),
      });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "MTProto authentication error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
