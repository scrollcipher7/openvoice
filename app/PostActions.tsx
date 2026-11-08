"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useLanguage } from "./LanguageContext";

type Comment = {
  id: number;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { display_name: string | null; username: string | null } | null;
};

export default function PostActions({
  postId,
  session,
  isAdmin,
}: {
  postId: number;
  session: Session | null;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data: likes } = await supabase
      .from("likes")
      .select("user_id")
      .eq("post_id", postId);
    setLikeCount(likes?.length ?? 0);
    setLiked(!!session && !!likes?.some((l) => l.user_id === session.user.id));

    const { data: cs } = await supabase
      .from("comments")
      .select("id, user_id, content, created_at, profiles(display_name, username)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    setComments((cs as unknown as Comment[]) ?? []);
  }, [postId, session]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleLike() {
    if (!session) return setMsg("Log in to like posts.");
    setMsg("");
    const { error } = liked
      ? await supabase.from("likes").delete().eq("post_id", postId).eq("user_id", session.user.id)
      : await supabase.from("likes").insert({ post_id: postId, user_id: session.user.id });
    if (error) return setMsg(error.message);
    load();
  }

  async function addComment() {
    if (!session) return setMsg("Log in to comment.");
    if (!text.trim()) return;
    setMsg("");
    const { error } = await supabase
      .from("comments")
      .insert({ post_id: postId, user_id: session.user.id, content: text.trim() });
    if (error) return setMsg(error.message);
    setText("");
    load();
  }

  async function share() {
    const url = `${window.location.origin}/#post-${postId}`;
    setMsg("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "OpenVoice",
          text: "Check this out on OpenVoice",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setMsg("Link copied.");
      }
      if (session) {
        const { error } = await supabase.rpc("notify_post_share", { target_post: postId });
        if (error) setMsg(`${t("Link shared, but the post owner could not be notified:")} ${error.message}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMsg(error instanceof Error ? error.message : "Unable to share this post.");
    }
  }

  async function deleteComment(id: number) {
    const { error } = await supabase.from("comments").delete().eq("id", id);
    if (error) return setMsg(error.message);
    load();
  }

  return (
    <div className="space-y-2 border-t border-[#2a2a2a] pt-2">
      <div className="flex gap-4 text-sm">
        <button onClick={share} className="order-last ml-auto font-semibold text-gray-400">
          🔗 {t("Share")}
        </button>
        <button onClick={toggleLike} className="font-semibold"
          style={{ color: liked ? "#f5b301" : "#9ca3af" }}>
          {liked ? "🔥" : "🤍"} {likeCount} {t(likeCount === 1 ? "Like" : "Likes")}
        </button>
        <button onClick={() => setOpen(!open)} className="font-semibold text-gray-400">
          💬 {comments.length} {t(comments.length === 1 ? "Comment" : "Comments")}
        </button>
      </div>

      {msg && <p className="text-sm text-red-500">{t(msg)}</p>}

      {open && (
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded bg-[#1c1c1c] p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {c.profiles?.display_name || c.profiles?.username || "Anonymous"}
                </span>
                {session && (isAdmin || session.user.id === c.user_id) && (
                  <button onClick={() => deleteComment(c.id)} className="text-xs text-red-500">
                    {t("Delete")}
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{c.content}</p>
            </div>
          ))}
          {session && (
            <div className="flex gap-2">
              <input
                className="w-full rounded border border-[#333] bg-[#1c1c1c] p-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#f5b301]"
                placeholder={t("Write a comment...")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addComment()}
              />
              <button onClick={addComment}
                className="rounded px-4 text-sm font-bold text-black" style={{ background: "#f5b301" }}>
                {t("Send")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
