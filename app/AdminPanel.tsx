"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Report = {
  id: number;
  reason: string;
  created_at: string;
  post_id: number;
  posts: {
    id: number;
    content: string;
    image_url: string | null;
    link_url: string | null;
    user_id: string;
    profiles: {
      display_name: string | null;
      username: string | null;
      is_banned: boolean | null;
    } | null;
  } | null;
};

type Banned = {
  id: string;
  display_name: string | null;
  username: string | null;
};

const GOLD = "#f5b301";
const RED = "#d7261e";

export default function AdminPanel({ isAdmin }: { isAdmin: boolean }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [banned, setBanned] = useState<Banned[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!isAdmin) return null;
    const { data: r, error: reportsError } = await supabase
      .from("reports")
      .select(
        "id, reason, created_at, post_id, posts(id, content, image_url, link_url, user_id, profiles(display_name, username, is_banned))"
      )
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (reportsError) throw new Error(reportsError.message);

    const { data: b, error: bannedError } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .eq("is_banned", true);
    if (bannedError) throw new Error(bannedError.message);

    return {
      reports: (r as unknown as Report[]) ?? [],
      banned: (b as Banned[]) ?? [],
    };
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) return;

    load()
      .then((data) => {
        if (!cancelled && data) {
          setReports(data.reports);
          setBanned(data.banned);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMsg(error instanceof Error ? error.message : "Could not load admin data.");
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, load]);

  async function refresh() {
    try {
      const data = await load();
      if (data) {
        setReports(data.reports);
        setBanned(data.banned);
      }
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not load admin data.");
    }
  }

  async function removePost(postId: number) {
    setMsg("");
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) return setMsg(error.message);
    refresh();
  }

  async function dismiss(reportId: number) {
    setMsg("");
    const { error } = await supabase
      .from("reports")
      .update({ status: "dismissed" })
      .eq("id", reportId);
    if (error) return setMsg(error.message);
    refresh();
  }

  async function banAndRemove(userId: string, postId: number) {
    setMsg("");
    const { error: banError } = await supabase.rpc("set_ban", { target: userId, banned: true });
    if (banError) return setMsg(banError.message);
    const { error: deleteError } = await supabase.from("posts").delete().eq("id", postId);
    if (deleteError) {
      setMsg(`User was banned, but removing the post failed: ${deleteError.message}`);
      refresh();
      return;
    }
    refresh();
  }

  async function unban(userId: string) {
    setMsg("");
    const { error } = await supabase.rpc("set_ban", { target: userId, banned: false });
    if (error) return setMsg(error.message);
    refresh();
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
      <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: GOLD }}>
        Admin: reports ({reports.length})
      </h2>
      {msg && <p className="text-sm text-red-500">{msg}</p>}

      {reports.length === 0 && <p className="text-sm text-gray-400">No open reports.</p>}

      {reports.map((r) => (
        <div key={r.id} className="space-y-2 rounded border border-[#333] bg-[#1c1c1c] p-3">
          <p className="text-sm">
            <span className="rounded px-2 py-0.5 text-xs text-white" style={{ background: RED }}>
              {r.reason}
            </span>{" "}
            <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
          </p>

          {r.posts ? (
            <>
              <p className="text-sm text-gray-400">
                Posted by{" "}
                <span className="font-semibold text-white">
                  {r.posts.profiles?.display_name || r.posts.profiles?.username || "Anonymous"}
                </span>
              </p>
              {r.posts.content && (
                <p className="whitespace-pre-wrap break-words text-sm">{r.posts.content}</p>
              )}
              {r.posts.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.posts.image_url} alt="" className="max-h-64 rounded" />
              )}
              {r.posts.link_url && (
                <a href={r.posts.link_url} target="_blank" rel="noopener noreferrer"
                  className="block break-all text-sm" style={{ color: GOLD }}>
                  {r.posts.link_url}
                </a>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => removePost(r.posts!.id)}
                  className="rounded px-3 py-1 text-sm font-bold text-white" style={{ background: RED }}>
                  Remove post
                </button>
                <button onClick={() => banAndRemove(r.posts!.user_id, r.posts!.id)}
                  className="rounded border border-red-500 px-3 py-1 text-sm font-bold text-red-500">
                  Remove + ban user
                </button>
                <button onClick={() => dismiss(r.id)}
                  className="rounded border border-[#555] px-3 py-1 text-sm">
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">This post was already removed.</p>
          )}
        </div>
      ))}

      <h3 className="pt-2 text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
        Banned accounts ({banned.length})
      </h3>
      {banned.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody is banned.</p>
      ) : (
        <ul className="space-y-2">
          {banned.map((b) => (
            <li key={b.id} className="flex items-center justify-between text-sm">
              <span>{b.display_name || b.username || b.id.slice(0, 8)}</span>
              <button onClick={() => unban(b.id)} className="rounded border border-[#555] px-3 py-1">
                Unban
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
