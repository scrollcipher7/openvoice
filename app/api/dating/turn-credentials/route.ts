import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type RequestBody = { targetUserId?: unknown; targetMatchId?: unknown };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return Response.json({ error: "Sign in to start a selfie check." }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const turnUrls = process.env.DATING_TURN_URLS?.split(",").map((url) => url.trim()).filter(Boolean);
  const turnSecret = process.env.DATING_TURN_SHARED_SECRET;
  if (!supabaseUrl || !supabaseAnonKey || !turnUrls?.length || !turnSecret) {
    return Response.json({ error: "Relay-only video is not configured yet. Contact the site administrator." }, { status: 503 });
  }
  if (turnUrls.some((url) => !/^turns?:/i.test(url))) {
    return Response.json({ error: "TURN server URLs must use the turn: or turns: protocol." }, { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return Response.json({ error: "A valid selfie-check request is required." }, { status: 400 });
  }
  const isSelfieRequest = typeof body.targetUserId === "string" && !body.targetMatchId;
  const isMatchCallRequest = typeof body.targetMatchId === "string" && !body.targetUserId;
  if ((!isSelfieRequest && !isMatchCallRequest)
    || (isSelfieRequest && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.targetUserId as string))
    || (isMatchCallRequest && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.targetMatchId as string))) {
    return Response.json({ error: "A valid selfie-check request is required." }, { status: 400 });
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) {
    return Response.json({ error: "Your sign-in has expired. Sign in again." }, { status: 401 });
  }

  let credentialScope: string;
  if (isSelfieRequest) {
    const targetUserId = body.targetUserId as string;
    const { data: check, error: checkError } = await client
      .from("dating_verifications")
      .select("user_id, status, checked_by")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (checkError) return Response.json({ error: "Could not confirm selfie-check access." }, { status: 500 });
    if (!check || check.status !== "in_progress") {
      return Response.json({ error: "This selfie check is not currently active." }, { status: 403 });
    }

    if (authData.user.id === targetUserId) {
      if (check.user_id !== authData.user.id) {
        return Response.json({ error: "You cannot join this selfie check." }, { status: 403 });
      }
    } else {
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("is_admin")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (profileError) return Response.json({ error: "Could not confirm admin access." }, { status: 500 });
      if (!profile?.is_admin || check.checked_by !== authData.user.id) {
        return Response.json({ error: "Only the assigned admin can join this selfie check." }, { status: 403 });
      }
    }
    credentialScope = targetUserId;
  } else {
    const targetMatchId = body.targetMatchId as string;
    const { data: canCall, error: callError } = await client.rpc("dating_can_use_match_call", {
      target_match: targetMatchId,
    });
    if (callError) return Response.json({ error: "Could not confirm this match call is allowed." }, { status: 500 });
    if (!canCall) {
      return Response.json({ error: "Only verified members of this active match can call." }, { status: 403 });
    }
    credentialScope = `dating-call:${targetMatchId}`;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:${credentialScope}`;
  const credential = createHmac("sha1", turnSecret).update(username).digest("base64");

  return Response.json(
    { iceServers: [{ urls: turnUrls, username, credential }] },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
