import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "@/lib/store";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, template, description, enabled } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Segment id is required" },
        { status: 400 }
      );
    }

    const db = saveDb((state) => {
      const seg = state.segments.find((s) => s.id === id);
      if (seg) {
        if (typeof template === "string") seg.template = template;
        if (typeof description === "string") seg.description = description;
        if (typeof enabled === "boolean") seg.enabled = enabled;
        seg.updatedAt = new Date().toISOString();
      }
    });

    return NextResponse.json({ segments: db.segments });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update segment" },
      { status: 500 }
    );
  }
}
