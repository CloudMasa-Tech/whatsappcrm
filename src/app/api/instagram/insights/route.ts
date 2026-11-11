import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchAccountInsights,
  fetchMediaInsights,
  InstagramMetaError,
} from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("viewer");
    const mediaId = request.nextUrl.searchParams.get("mediaId")?.trim();
    const mediaType = request.nextUrl.searchParams.get("mediaType")?.trim();
    const periodParam = request.nextUrl.searchParams.get("period");
    const period: "day" | "week" | "days_28" =
      periodParam === "day" || periodParam === "week" ? periodParam : "days_28";

    const { data: config } = await supabaseAdmin()
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .eq("status", "connected")
      .maybeSingle();

    if (!config || config.connection_method !== "cloud_api" || !config.access_token) {
      return NextResponse.json(
        { error: "Account & Post Insights require a connected Meta Cloud API token." },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.access_token);
    const tokenType = (config.token_type as InstagramTokenType | undefined) ?? null;

    if (mediaId) {
      const metrics = await fetchMediaInsights(accessToken, mediaId, mediaType, tokenType);
      return NextResponse.json({ success: true, mediaId, metrics });
    }

    const igId = (config.instagram_business_id as string | null) || "me";
    const metrics = await fetchAccountInsights(accessToken, igId, period, tokenType);
    return NextResponse.json({ success: true, period, metrics });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

