import { NextRequest, NextResponse } from "next/server";
import { saveDb, createId } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const firstName = String(body.firstName || "").trim();
    const cleanUsername = body.username
      ? String(body.username).replace(/^@/, "").trim() || null
      : null;
    const segmentId = String(body.segmentId || "seg-vip").trim();

    if (!firstName && !cleanUsername) {
      return NextResponse.json(
        { error: "Ism yoki @username kiritilishi shart." },
        { status: 400 }
      );
    }

    const telegramUserId = body.telegramUserId
      ? String(body.telegramUserId).trim()
      : cleanUsername || firstName.toLowerCase();

    const nowIso = new Date().toISOString();
    const db = saveDb((state) => {
      const existingIdx = state.contacts.findIndex(
        (c) =>
          (body.id && c.id === body.id) ||
          (cleanUsername &&
            c.username &&
            c.username.toLowerCase() === cleanUsername.toLowerCase()) ||
          c.firstName.toLowerCase() === firstName.toLowerCase()
      );

      if (existingIdx >= 0) {
        state.contacts[existingIdx] = {
          ...state.contacts[existingIdx],
          telegramUserId:
            body.telegramUserId || state.contacts[existingIdx].telegramUserId,
          username: cleanUsername,
          firstName: firstName || cleanUsername || "Contact",
          lastName: null,
          phone: null,
          segmentId,
          customTemplate: body.customTemplate
            ? String(body.customTemplate).trim()
            : null,
          isPaused: Boolean(body.isPaused),
          notes: null,
          updatedAt: nowIso,
        };
      } else {
        state.contacts.unshift({
          id: createId("cnt"),
          telegramUserId,
          username: cleanUsername,
          firstName: firstName || cleanUsername || "Contact",
          lastName: null,
          phone: null,
          segmentId,
          customTemplate: body.customTemplate
            ? String(body.customTemplate).trim()
            : null,
          isPaused: Boolean(body.isPaused),
          notes: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    });

    return NextResponse.json({ contacts: db.contacts });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save contact" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "Contact id required" }, { status: 400 });
    }

    const db = saveDb((state) => {
      const contact = state.contacts.find((c) => c.id === id);
      if (contact) {
        if (typeof body.isPaused === "boolean") contact.isPaused = body.isPaused;
        if (typeof body.segmentId === "string") contact.segmentId = body.segmentId;
        if (body.customTemplate !== undefined) {
          contact.customTemplate = body.customTemplate
            ? String(body.customTemplate).trim()
            : null;
        }
        contact.updatedAt = new Date().toISOString();
      }
    });

    return NextResponse.json({ contacts: db.contacts });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update contact" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Contact id required" }, { status: 400 });
    }

    const db = saveDb((state) => {
      state.contacts = state.contacts.filter((c) => c.id !== id);
    });

    return NextResponse.json({ contacts: db.contacts });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete contact" },
      { status: 500 }
    );
  }
}
