import { NextRequest, NextResponse } from "next/server";
import { getCurrentProject } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildMediaPath } from "@/lib/storage/upload-media";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentProject();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Limit to 50 MB
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size exceeds maximum allowed limit of 50 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = buildMediaPath(ctx.accountId, file.name);

    // Try chat-media bucket first, fallback to flow-media
    let bucket = "chat-media";
    let uploadRes = await supabaseAdmin().storage.from(bucket).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

    if (uploadRes.error) {
      bucket = "flow-media";
      uploadRes = await supabaseAdmin().storage.from(bucket).upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    }

    if (uploadRes.error) {
      console.error("[Instagram Upload Error]:", uploadRes.error);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadRes.error.message}` },
        { status: 500 },
      );
    }

    const { data: publicUrlData } = supabaseAdmin().storage.from(bucket).getPublicUrl(path);

    return NextResponse.json({
      success: true,
      url: publicUrlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}
