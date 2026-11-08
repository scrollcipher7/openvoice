"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useLanguage } from "./LanguageContext";

const REASONS = [
  "Fake profile or scam",
  "Harassment",
  "Threats or violence",
  "Nudity or sexual content",
  "Other",
];

export default function ProfileReportButton({
  profileId,
  session,
}: {
  profileId: string;
  session: Session;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.from("profile_reports").insert({
      reporter_id: session.user.id,
      reported_user_id: profileId,
      reason,
      details: details.trim() || null,
    });
    if (error) {
      setMessage(error.code === "23505" ? t("You already reported this profile.") : error.message);
    } else {
      setDone(true);
      setMessage(t("Profile report sent. An admin will review it."));
    }
    setBusy(false);
  }

  if (done) return <p role="status" className="text-sm text-gray-300">{message}</p>;

  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-gray-400 hover:text-red-400"
        >
          🚩 {t("Report profile")}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-2 rounded border border-[#333] bg-[#1c1c1c] p-3">
          <label className="block text-xs text-gray-400">
            {t("Report reason")}
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded border border-[#444] bg-[#111] p-2 text-sm text-white"
            >
              {REASONS.map((item) => <option key={item} value={item}>{t(item)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-gray-400">
            {t("Add details (optional)")}
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={1000}
              rows={3}
              className="mt-1 w-full rounded border border-[#444] bg-[#111] p-2 text-sm text-white"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded px-3 py-1 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: "#d7261e" }}
            >
              {busy ? t("Sending...") : t("Send report")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400">
              {t("Cancel")}
            </button>
          </div>
          {message && <p role="alert" className="text-sm text-red-400">{message}</p>}
        </form>
      )}
    </div>
  );
}
