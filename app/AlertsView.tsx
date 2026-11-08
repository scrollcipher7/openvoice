"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "./LanguageContext";

type Notification = {
  id: number;
  actor_id: string;
  type: "friend_request" | "friend_accepted" | "comment" | "share" | "feedback" | "suggestion" | "profile_report" | "moderation_message";
  post_id: number | null;
  friend_request_id: string | null;
  created_at: string;
  read_at: string | null;
  profiles: { display_name: string | null; username: string | null } | null;
};

const GOLD = "#f5b301";

export default function AlertsView({
  onOpenProfile,
  onOpenReportQueue,
  onOpenFeedback,
  onOpenMessages,
  onOpenPost,
  onUnreadCount,
}: {
  onOpenProfile: (userId: string) => void;
  onOpenReportQueue: () => void;
  onOpenFeedback: () => void;
  onOpenMessages: (userId: string) => void;
  onOpenPost: (postId: number) => void;
  onUnreadCount: (count: number) => void;
}) {
  const { language, t } = useLanguage();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: resultError } = await supabase
      .from("notifications")
      .select("id, actor_id, type, post_id, friend_request_id, created_at, read_at, profiles!notifications_actor_id_fkey(display_name, username)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (resultError) {
      setError(resultError.message);
      setLoading(false);
      return;
    }
    const next = (data ?? []) as unknown as Notification[];
    setNotifications(next);
    onUnreadCount(next.filter((item) => !item.read_at).length);
    setError("");
    setLoading(false);
  }, [onUnreadCount]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load]);

  async function markRead(notification: Notification) {
    if (notification.read_at) return;
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notification.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  async function respond(notification: Notification, accept: boolean) {
    if (!notification.friend_request_id || busyId !== null) return;
    setBusyId(notification.id);
    setError("");
    const { error: responseError } = await supabase.rpc("respond_friend_request", {
      target_request: notification.friend_request_id,
      accept_request: accept,
    });
    if (responseError) {
      setError(responseError.message);
    } else {
      await load();
    }
    setBusyId(null);
  }

  function notificationText(notification: Notification): string {
    const name = notification.profiles?.display_name || notification.profiles?.username || t("Someone");
    if (notification.type === "friend_request") return `${name} ${t("sent you a friend request.")}`;
    if (notification.type === "friend_accepted") return `${name} ${t("accepted your friend request.")}`;
    if (notification.type === "comment") return `${name} ${t("commented on your post.")}`;
    if (notification.type === "share") return `${name} ${t("shared your post.")}`;
    if (notification.type === "profile_report") return `${name} ${t("reported a member profile.")}`;
    if (notification.type === "moderation_message") return `${name} ${t("sent you a moderation message.")}`;
    return `${name} ${t(notification.type === "feedback" ? "sent feedback." : "sent a suggestion.")}`;
  }

  return (
    <section className="space-y-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: GOLD }}>{t("Alerts")}</h2>
        <span className="text-xs text-gray-400">{t("Friend requests, comments, shares, feedback, and reports")}</span>
      </header>
      {error && <p role="alert" className="text-sm text-red-400">{t(error)}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">{t("Loading alerts...")}</p>
      ) : notifications.length === 0 ? (
        <p className="rounded border border-[#333] bg-[#1c1c1c] p-4 text-sm text-gray-400">{t("You're all caught up.")}</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`space-y-2 rounded border p-3 ${
                notification.read_at ? "border-[#333] bg-[#1c1c1c]" : "border-[#6b5412] bg-[#211b0d]"
              }`}
            >
              <button
                onClick={() => {
                  void markRead(notification);
                  if (notification.type !== "profile_report" && notification.type !== "moderation_message") {
                    onOpenProfile(notification.actor_id);
                  }
                }}
                className="block w-full text-left text-sm"
              >
                <span className="font-semibold">{notificationText(notification)}</span>
                <time className="mt-1 block text-xs text-gray-500">
                  {new Date(notification.created_at).toLocaleString(language === "es" ? "es-US" : "en-US")}
                </time>
              </button>
              <div className="flex flex-wrap gap-2">
                {notification.type === "friend_request" && notification.friend_request_id && (
                  <>
                    <button
                      onClick={() => void respond(notification, true)}
                      disabled={busyId !== null}
                      className="rounded px-3 py-1 text-sm font-bold text-black disabled:opacity-50"
                      style={{ background: GOLD }}
                    >
                      {t("Accept")}
                    </button>
                    <button
                      onClick={() => void respond(notification, false)}
                      disabled={busyId !== null}
                      className="rounded border border-[#555] px-3 py-1 text-sm disabled:opacity-50"
                    >
                      {t("Decline")}
                    </button>
                  </>
                )}
                {(notification.type === "comment" || notification.type === "share") && notification.post_id !== null && (
                  <button
                    onClick={() => {
                      void markRead(notification);
                      onOpenPost(notification.post_id!);
                    }}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: GOLD }}
                  >
                    {t("View post")}
                  </button>
                )}
                {(notification.type === "feedback" || notification.type === "suggestion") && (
                  <button
                    onClick={() => {
                      void markRead(notification);
                      onOpenFeedback();
                    }}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: GOLD }}
                  >
                    {t("Review feedback")}
                  </button>
                )}
                {notification.type === "profile_report" && (
                  <button
                    onClick={() => {
                      void markRead(notification);
                      onOpenReportQueue();
                    }}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: GOLD }}
                  >
                    {t("Review profile reports")}
                  </button>
                )}
                {notification.type === "moderation_message" && (
                  <button
                    onClick={() => {
                      void markRead(notification);
                      onOpenMessages(notification.actor_id);
                    }}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: GOLD }}
                  >
                    {t("Open message")}
                  </button>
                )}
                {!notification.read_at && notification.type !== "friend_request" && (
                  <button onClick={() => void markRead(notification)} className="text-sm text-gray-400">
                    {t("Mark as read")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
