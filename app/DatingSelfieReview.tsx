"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "./LanguageContext";

type CheckRequest = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  requested_at: string;
  selfie_path: string;
  status: "requested" | "selfie_checked" | "rejected";
  selfie_url: string | null;
};

type QueuedRequest = Omit<CheckRequest, "status" | "selfie_url">;

type VerificationState = {
  user_id: string;
  status: CheckRequest["status"];
};

const GOLD = "#f5b301";

export default function DatingSelfieReview() {
  const { language, t } = useLanguage();
  const [requests, setRequests] = useState<CheckRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<CheckRequest | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadRequests = useCallback(async () => {
    setError("");
    const { data, error: resultError } = await supabase.rpc("get_dating_verification_requests");
    if (resultError) {
      setError(resultError.message);
      return;
    }

    const queue = (data ?? []) as QueuedRequest[];
    if (!queue.length) {
      setRequests([]);
      setActiveRequest(null);
      return;
    }

    const { data: states, error: statesError } = await supabase
      .from("dating_verifications")
      .select("user_id, status")
      .in("user_id", queue.map((request) => request.user_id));
    if (statesError) {
      setError(`Could not load selfie-review statuses: ${statesError.message}`);
      return;
    }
    const statusByUser = new Map(
      ((states ?? []) as VerificationState[]).map((state) => [state.user_id, state.status])
    );

    const signedRequests: CheckRequest[] = [];
    for (const request of queue) {
      const status = statusByUser.get(request.user_id);
      if (status !== "requested" && status !== "selfie_checked" && status !== "rejected") {
        setError(t("Could not determine a selfie-review status. Refresh the queue and try again."));
        return;
      }
      if (status !== "requested") {
        signedRequests.push({ ...request, status, selfie_url: null });
        continue;
      }
      if (!request.selfie_path) {
        setError(t("A pending selfie request is missing its private photo path. Confirm the latest Supabase migration was applied."));
        return;
      }
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("dating-selfies")
        .createSignedUrl(request.selfie_path, 300);
      if (signedUrlError) {
        setError(`Could not open a private selfie for review: ${signedUrlError.message}`);
        return;
      }
      signedRequests.push({ ...request, status, selfie_url: signedUrl.signedUrl });
    }

    setRequests(signedRequests);
    if (activeRequest) {
      const updatedRequest = signedRequests.find((request) =>
        request.user_id === activeRequest.user_id && request.status === "requested");
      setActiveRequest(updatedRequest ?? null);
    }
  }, [activeRequest, t]);

  async function deleteReviewedSelfie(request: CheckRequest): Promise<string | null> {
    const { error: deleteError } = await supabase.storage.from("dating-selfies").remove([request.selfie_path]);
    if (deleteError) {
      const pathParts = request.selfie_path.split("/");
      const filename = pathParts.pop();
      const folder = pathParts.join("/");
      if (!filename || !folder) return "The private selfie path is invalid.";
      const { data: files, error: listError } = await supabase.storage
        .from("dating-selfies")
        .list(folder, { search: filename });
      if (listError) {
        return `Could not delete the private selfie: ${deleteError.message}. Could not confirm whether it remains stored: ${listError.message}`;
      }
      if (files.some((file) => file.name === filename)) {
        return `Could not delete the private selfie: ${deleteError.message}`;
      }
    }

    const { error: clearError } = await supabase.rpc("clear_dating_verification_selfie", {
      target_user: request.user_id,
      selfie_object_path: request.selfie_path,
    });
    return clearError?.message ?? null;
  }

  async function refreshRequests() {
    setRefreshing(true);
    try {
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not refresh selfie-review requests."));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadRequests(), 0);
    const refreshTimer = window.setInterval(() => void loadRequests(), 10000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [loadRequests]);

  async function reviewCheck(approved: boolean) {
    if (!activeRequest || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    const { error: resultError } = await supabase.rpc("review_dating_verification", {
      target_user: activeRequest.user_id,
      approved,
    });
    if (resultError) {
      setError(resultError.message);
      setBusy(false);
      return;
    }

    const cleanupError = await deleteReviewedSelfie(activeRequest);
    if (cleanupError) setError(`${t("The review was saved, but selfie cleanup is still pending:")} ${t(cleanupError)}`);
    else setNotice(t(approved
      ? "Selfie photo checked. This does not verify the person's identity or age."
      : "Selfie photo review rejected. The uploaded selfie was deleted."));
    setActiveRequest(null);
    setBusy(false);
    await loadRequests();
  }

  async function retryCleanup(request: CheckRequest) {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    const cleanupError = await deleteReviewedSelfie(request);
    if (cleanupError) setError(`${t("Selfie cleanup is still pending:")} ${t(cleanupError)}`);
    else setNotice(t("The private selfie was deleted."));
    setBusy(false);
    if (!cleanupError) await loadRequests();
  }

  return (
    <section className="space-y-3 rounded-lg border border-[#665000] bg-[#141414] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold uppercase tracking-wide" style={{ color: GOLD }}>{t("Dating selfie checks")}</h3>
        <button
          type="button"
          onClick={() => void refreshRequests()}
          disabled={refreshing}
          className="rounded border border-[#555] px-3 py-1 text-sm disabled:opacity-50"
        >
          {refreshing ? t("Refreshing…") : t("Refresh")}
        </button>
      </div>
      <p className="text-sm text-gray-400">
        {t("Compare the submitted private selfie photo with the account photo when available. This is a manual visual check, not face recognition, identity verification, or proof of age.")}
      </p>
      {error && <p role="alert" className="text-sm text-red-300">{t(error)}</p>}
      {notice && <p role="status" className="text-sm text-yellow-100">{t(notice)}</p>}

      {activeRequest ? (
        <div className="space-y-3 rounded border border-[#444] p-3">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <p className="mb-2 text-sm text-gray-300">{t("Submitted selfie")}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeRequest.selfie_url ?? ""} alt={t("Private submitted selfie")} className="h-52 w-40 rounded object-cover" />
            </div>
            <div>
              <p className="mb-2 text-sm text-gray-300">{t("OpenVoice profile photo")}</p>
              {activeRequest.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeRequest.avatar_url} alt={t("Current account profile photo")} className="h-52 w-40 rounded object-cover" />
              ) : (
                <p className="flex h-52 w-40 items-center justify-center rounded bg-[#222] p-3 text-center text-sm text-gray-500">{t("No profile photo available")}</p>
              )}
            </div>
            <div className="min-w-48">
              <p className="font-semibold">{activeRequest.display_name}</p>
              {activeRequest.username && <p className="text-sm text-gray-400">@{activeRequest.username}</p>}
              <p className="mt-2 text-xs text-gray-500">{t("Requested")} {new Date(activeRequest.requested_at).toLocaleString(language === "es" ? "es-US" : "en-US")}</p>
              <p className="mt-2 text-xs text-gray-500">{t("The photo URL expires after five minutes. Approving does not verify identity or age.")}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void reviewCheck(true)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-40" style={{ background: GOLD }}>
              {busy ? t("Saving…") : t("Approve selfie check")}
            </button>
            <button type="button" disabled={busy} onClick={() => void reviewCheck(false)} className="rounded border border-red-500 px-4 py-2 text-red-300 disabled:opacity-40">
              {t("Reject selfie check")}
            </button>
            <button type="button" disabled={busy} onClick={() => setActiveRequest(null)} className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-40">
              {t("Return to queue")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div key={request.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#333] p-3">
              <div>
                <p className="font-semibold">{request.display_name}</p>
                {request.username && <p className="text-sm text-gray-400">@{request.username}</p>}
                <p className="text-xs text-gray-500">
                  {request.status === "requested"
                    ? `${t("Requested")} ${new Date(request.requested_at).toLocaleString(language === "es" ? "es-US" : "en-US")}`
                    : `${t("Review saved; private photo cleanup pending")} (${t(request.status.replaceAll("_", " "))}).`}
                </p>
              </div>
              {request.status === "requested" ? (
                <button type="button" disabled={busy} onClick={() => setActiveRequest(request)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
                  {t("Review selfie")}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void retryCleanup(request)} className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-50">
                  {busy ? t("Cleaning up…") : t("Retry private photo cleanup")}
                </button>
              )}
            </div>
          ))}
          {!requests.length && <p className="text-sm text-gray-400">{t("No pending requests.")}</p>}
        </div>
      )}
    </section>
  );
}
