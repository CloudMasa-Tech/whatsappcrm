import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildProjectMediaPath } from "@/lib/storage/upload-media";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json();
    const fileName = String(body?.fileName || "upload.mp4");
    const bucket = body?.bucket === "flow-media" ? "flow-media" : "chat-media";

    const path = buildProjectMediaPath(ctx.accountId, ctx.projectId, fileName);
    const db = supabaseAdmin();

    const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not generate signed upload URL" },
        { status: 500 },
      );
    }

    const { data: publicData } = db.storage.from(bucket).getPublicUrl(path);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      publicUrl: publicData.publicUrl,
      bucket,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate signed upload URL";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
