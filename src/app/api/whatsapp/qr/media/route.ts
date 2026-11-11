import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireProject } from "@/lib/auth/project";
import { fetchMediaViaGateway, GatewayError } from "@/lib/channels/gateway";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/whatsapp/encryption";

export const dynamic = "force-dynamic";

function extractProjectIdFromRef(ref: string): string | null {
  try {
    const encrypted = Buffer.from(ref, "base64url").toString("utf8");
    const json = decrypt(encrypted);
    const parsed = JSON.parse(json) as { v?: number; p?: unknown };
    if (parsed?.v === 1 && typeof parsed.p === "string" && parsed.p.length > 0) {
      return parsed.p;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ref = searchParams.get("ref")?.trim() ?? "";
    if (!ref) {
      return NextResponse.json({ error: "Missing media ref" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = extractProjectIdFromRef(ref);
    if (!projectId) {
      return NextResponse.json({ error: "Invalid media reference" }, { status: 400 });
    }

    // Strict project membership verification so another tenant cannot fetch media
    await requireProject(projectId);

    const media = await fetchMediaViaGateway(projectId, ref);
    const headers = new Headers({
      "Content-Type": media.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    });

    if (media.filename) {
      const safeName = media.filename.replace(/["\\\r\n]/g, "_");
      headers.set("Content-Disposition", `inline; filename="${safeName}"`);
    }

    return new Response(new Uint8Array(media.buffer), { status: 200, headers });
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return toErrorResponse(err);
  }
}

