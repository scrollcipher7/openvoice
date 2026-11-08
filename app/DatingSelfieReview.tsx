"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

const GOLD = "#f5b301";

export default function DatingSelfieReview() {
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

    const queue = (data ?? []) as Omit<CheckRequest, "selfie_url">[];
    const signedRequests: CheckRequest[] = [];
    for (const request of queue) {
      if (request.status !== "requested") {
        signedRequests.push({ ...request, selfie_url: null });
        continue;
      }
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("dating-selfies")
        .createSignedUrl(request.selfie_path, 300);
      if (signedUrlError) {
        setError(`Could not open a private selfie for review: ${signedUrlError.message}`);
        return;
      }
      signedRequests.push({ ...request, selfie_url: signedUrl.signedUrl });
    }

    setRequests(signedRequests);
    if (activeRequest) {
      const updatedRequest = signedRequests.find((request) =>
        request.user_id === activeRequest.user_id && request.status === "requested");
      setActiveRequest(updatedRequest ?? null);
    }
  }, [activeRequest]);

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
      setError(cause instanceof Error ? cause.message : "Could not refresh selfie-review requests.");
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
    if (cleanupError) setError(`The review was saved, but selfie cleanup is still pending: ${cleanupError}`);
    else setNotice(approved
      ? "Selfie photo checked. This does not verify the person's identity or age."
      : "Selfie photo review rejected. The uploaded selfie was deleted.");
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
    if (cleanupError) setError(`Selfie cleanup is still pending: ${cleanupError}`);
    else setNotice("The private selfie was deleted.");
    setBusy(false);
    if (!cleanupError) await loadRequests();
  }

  return (
    <section className="space-y-3 rounded-lg border border-[#665000] bg-[#141414] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold uppercase tracking-wide" style={{ color: GOLD }}>Dating selfie checks</h3>
        <button
          type="button"
          onClick={() => void refreshRequests()}
          disabled={refreshing}
          className="rounded border border-[#555] px-3 py-1 text-sm disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="text-sm text-gray-400">
        Compare the submitted private selfie photo with the account photo when available. This is a manual visual check, not face recognition, identity verification, or proof of age.
      </p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-yellow-100">{notice}</p>}

      {activeRequest ? (
        <div className="space-y-3 rounded border border-[#444] p-3">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <p className="mb-2 text-sm text-gray-300">Submitted selfie</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeRequest.selfie_url ?? ""} alt="Private submitted selfie" className="h-52 w-40 rounded object-cover" />
            </div>
            <div>
              <p className="mb-2 text-sm text-gray-300">OpenVoice profile photo</p>
              {activeRequest.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeRequest.avatar_url} alt="Current account profile photo" className="h-52 w-40 rounded object-cover" />
              ) : (
                <p className="flex h-52 w-40 items-center justify-center rounded bg-[#222] p-3 text-center text-sm text-gray-500">No profile photo available</p>
              )}
            </div>
            <div className="min-w-48">
              <p className="font-semibold">{activeRequest.display_name}</p>
              {activeRequest.username && <p className="text-sm text-gray-400">@{activeRequest.username}</p>}
              <p className="mt-2 text-xs text-gray-500">Requested {new Date(activeRequest.requested_at).toLocaleString()}</p>
              <p className="mt-2 text-xs text-gray-500">The photo URL expires after five minutes. Approving does not verify identity or age.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void reviewCheck(true)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-40" style={{ background: GOLD }}>
              {busy ? "Saving…" : "Approve selfie check"}
            </button>
            <button type="button" disabled={busy} onClick={() => void reviewCheck(false)} className="rounded border border-red-500 px-4 py-2 text-red-300 disabled:opacity-40">
              Reject selfie check
            </button>
            <button type="button" disabled={busy} onClick={() => setActiveRequest(null)} className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-40">
              Return to queue
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
                    ? `Requested ${new Date(request.requested_at).toLocaleString()}`
                    : `Review saved; private photo cleanup pending (${request.status.replaceAll("_", " ")}).`}
                </p>
              </div>
              {request.status === "requested" ? (
                <button type="button" disabled={busy} onClick={() => setActiveRequest(request)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
                  Review selfie
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void retryCleanup(request)} className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-50">
                  {busy ? "Cleaning up…" : "Retry private photo cleanup"}
                </button>
              )}
            </div>
          ))}
          {!requests.length && <p className="text-sm text-gray-400">No pending requests.</p>}
        </div>
      )}
    </section>
  );
}
