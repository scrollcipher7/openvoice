"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DatingSelfieCall from "./DatingSelfieCall";

type CheckRequest = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  requested_at: string;
  status: "requested" | "in_progress";
};

type VerificationState = {
  user_id: string;
  status: "requested" | "in_progress";
};

const GOLD = "#f5b301";

export default function DatingSelfieReview() {
  const [requests, setRequests] = useState<CheckRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<CheckRequest | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const markConnected = useCallback(() => setConnected(true), []);

  const loadRequests = useCallback(async () => {
    setError("");
    const { data, error: resultError } = await supabase.rpc("get_dating_verification_requests");
    if (resultError) {
      setError(resultError.message);
      return;
    }

    const queue = (data ?? []) as Omit<CheckRequest, "status">[];
    if (!queue.length) {
      setRequests([]);
      setActiveRequest(null);
      setConnected(false);
      return;
    }

    const { data: states, error: statesError } = await supabase
      .from("dating_verifications")
      .select("user_id, status")
      .in("user_id", queue.map((request) => request.user_id));
    if (statesError) {
      setError(`Could not refresh selfie-check statuses: ${statesError.message}`);
      return;
    }

    const statusByUser = new Map(
      ((states ?? []) as VerificationState[]).map((state) => [state.user_id, state.status])
    );
    const refreshedQueue: CheckRequest[] = [];
    for (const request of queue) {
      const status = statusByUser.get(request.user_id);
      if (status !== "requested" && status !== "in_progress") {
        setError("Could not determine the current status for a selfie-check request. Please refresh again.");
        return;
      }
      refreshedQueue.push({ ...request, status });
    }

    setRequests(refreshedQueue);
    if (activeRequest) {
      const updatedRequest = refreshedQueue.find((request) => request.user_id === activeRequest.user_id);
      if (!updatedRequest || updatedRequest.status !== "in_progress") {
        setActiveRequest(null);
        setConnected(false);
      } else {
        setActiveRequest(updatedRequest);
      }
    }
  }, [activeRequest]);

  async function refreshRequests() {
    setRefreshing(true);
    try {
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh selfie-check requests.");
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

  async function startCheck(request: CheckRequest) {
    setError("");
    setNotice("");
    setBusy(true);
    if (request.status === "requested") {
      const { error: resultError } = await supabase.rpc("start_dating_selfie_check", {
        target_user: request.user_id,
      });
      if (resultError) {
        setError(resultError.message);
        setBusy(false);
        await refreshRequests();
        return;
      }
    }
    setActiveRequest(request);
    setConnected(false);
    setBusy(false);
    await loadRequests();
  }

  async function reviewCheck(approved: boolean) {
    if (!activeRequest || !connected) return;
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
    setNotice(approved ? "Marked Selfie checked. This does not verify the person's name or age." : "Selfie check rejected.");
    setActiveRequest(null);
    setConnected(false);
    setBusy(false);
    await loadRequests();
  }

  async function returnToQueue() {
    if (!activeRequest) return;
    setError("");
    setBusy(true);
    const { error: resultError } = await supabase.rpc("release_dating_selfie_check", {
      target_user: activeRequest.user_id,
    });
    if (resultError) {
      setError(resultError.message);
      setBusy(false);
      return;
    }
    setActiveRequest(null);
    setConnected(false);
    setBusy(false);
    await loadRequests();
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
        Review a live camera feed and compare it with the account photo when available. OpenVoice does not record or store video, but cannot prevent capture outside the app. This is a human selfie check, not face recognition, identity verification, or proof of age.
      </p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-yellow-100">{notice}</p>}

      {activeRequest ? (
        <div className="space-y-3 rounded border border-[#444] p-3">
          <div className="flex flex-wrap items-center gap-3">
            {activeRequest.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeRequest.avatar_url} alt="Current account profile photo" className="h-20 w-20 rounded-full object-cover" />
            )}
            <div>
              <p className="font-semibold">{activeRequest.display_name}</p>
              {activeRequest.username && <p className="text-sm text-gray-400">@{activeRequest.username}</p>}
              <p className="text-xs text-gray-500">Compare the live person to the existing profile photo if one is available.</p>
            </div>
          </div>
          <DatingSelfieCall
            userId={activeRequest.user_id}
            role="reviewer"
            displayName={activeRequest.display_name}
            onConnected={markConnected}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!connected || busy} onClick={() => void reviewCheck(true)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-40" style={{ background: GOLD }}>
              Mark “Selfie checked”
            </button>
            <button type="button" disabled={!connected || busy} onClick={() => void reviewCheck(false)} className="rounded border border-red-500 px-4 py-2 text-red-300 disabled:opacity-40">
              Reject check
            </button>
            <button type="button" disabled={busy} onClick={() => void returnToQueue()} className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-40">
              Return request to queue
            </button>
          </div>
          {!connected && <p className="text-sm text-gray-500">Review actions unlock after a live video connects.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div key={request.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#333] p-3">
              <div>
                <p className="font-semibold">{request.display_name}</p>
                {request.username && <p className="text-sm text-gray-400">@{request.username}</p>}
                <p className="text-xs text-gray-500">Requested {new Date(request.requested_at).toLocaleString()}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void startCheck(request)} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
                {busy ? "Starting…" : request.status === "in_progress" ? "Resume live check" : "Start live check"}
              </button>
            </div>
          ))}
          {!requests.length && <p className="text-sm text-gray-400">No pending requests.</p>}
        </div>
      )}
    </section>
  );
}
