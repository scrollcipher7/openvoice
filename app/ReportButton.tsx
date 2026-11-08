"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

const REASONS = [
  "Nudity or sexual content",
  "Threats or violence",
  "Fake profile or scam",
  "Harassment",
  "Other",
];

export default function ReportButton({
  postId,
  session,
}: {
  postId: number;
  session: Session;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  async function send() {
    setMsg("");
    const { error } = await supabase
      .from("reports")
      .insert({ post_id: postId, reporter_id: session.user.id, reason });
    if (error) {
      if (error.code === "23505") {
        setDone(true);
        setMsg("You already reported this post.");
        return;
      }
      return setMsg(error.message);
    }
    setDone(true);
    setMsg("Thanks. An admin will review it.");
  }

  if (done) return <p className="text-xs text-gray-400">{msg}</p>;

  return (
    <div className="text-xs">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-gray-500 hover:text-red-500">
          🚩 Report
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded border border-[#333] bg-[#1c1c1c] p-1 text-white"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            onClick={send}
            className="rounded px-3 py-1 font-bold text-white"
            style={{ background: "#d7261e" }}
          >
            Send report
          </button>
          <button onClick={() => setOpen(false)} className="text-gray-400">
            Cancel
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-red-500">{msg}</p>}
    </div>
  );
}
