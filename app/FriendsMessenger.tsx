"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import DatingMatchCall from "./DatingMatchCall";
import { useLanguage } from "./LanguageContext";

type Conversation = {
  id: string;
  other_user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  is_moderation: boolean;
};

type Message = {
  id: number;
  sender_id: string;
  content: string;
  created_at: string;
};

const GOLD = "#f5b301";

export default function FriendsMessenger({
  session,
  initialUserId,
  onOpenProfile,
}: {
  session: Session;
  initialUserId?: string | null;
  onOpenProfile: (userId: string) => void;
}) {
  const { language, t } = useLanguage();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesConversationId, setMessagesConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadConversations = useCallback(async () => {
    const { data, error: resultError } = await supabase.rpc("get_friend_conversations");
    if (resultError) {
      setError(resultError.message);
      setLoading(false);
      return;
    }
    const next = (data ?? []) as Conversation[];
    setConversations(next);
    setSelectedId((current) => {
      if (initialUserId) {
        return next.find((item) => item.other_user_id === initialUserId)?.id ?? current;
      }
      if (current && next.some((item) => item.id === current)) return current;
      return next[0]?.id ?? null;
    });
    setLoading(false);
    setError("");
  }, [initialUserId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadConversations(), 0);
    const timer = window.setInterval(() => void loadConversations(), 10000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadConversations]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error: resultError } = await supabase
      .from("friend_messages")
      .select("id, sender_id, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (resultError) {
      if (selectedId === conversationId) setError(resultError.message);
      return;
    }
    if (selectedId !== conversationId) return;
    setMessages(((data ?? []) as Message[]).reverse());
    setMessagesConversationId(conversationId);
    setError("");
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const initialLoad = window.setTimeout(() => void loadMessages(selectedId), 0);
    const timer = window.setInterval(() => void loadMessages(selectedId), 4000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadMessages, selectedId]);

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError("");
    const content = draft.trim();
    const { error: sendError } = await supabase.from("friend_messages").insert({
      conversation_id: selected.id,
      sender_id: session.user.id,
      content,
    });
    if (sendError) {
      setError(sendError.message);
    } else {
      setDraft("");
      await Promise.all([loadMessages(selected.id), loadConversations()]);
    }
    setSending(false);
  }

  return (
    <section className="space-y-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
      <header>
        <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: GOLD }}>{t("Messages")}</h2>
        <p className="mt-1 text-sm text-gray-400">
          {t("You can message friends after they accept your request. Admin moderation messages are also available.")}
        </p>
      </header>

      {error && <p role="alert" className="text-sm text-red-400">{t(error)}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">{t("Loading conversations...")}</p>
      ) : conversations.length === 0 ? (
        <div className="rounded border border-[#333] bg-[#1c1c1c] p-4 text-sm text-gray-300">
          <p>{t("You don't have any friend conversations yet.")}</p>
          <p className="mt-1 text-gray-400">{t("Add someone as a friend and wait for them to accept to start messaging or calling.")}</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                className="min-w-36 rounded border px-3 py-2 text-left"
                style={{
                  borderColor: selectedId === conversation.id ? GOLD : "#333",
                  background: "#1c1c1c",
                }}
              >
                <span className="block truncate text-sm font-semibold">
                  {conversation.display_name || conversation.username || t("OpenVoice member")}
                </span>
                <span className="block truncate text-xs text-gray-400">
                  {conversation.last_message || t("No messages yet")}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-3">
              <button
                onClick={() => onOpenProfile(selected.other_user_id)}
                className="text-sm font-semibold hover:underline"
                style={{ color: GOLD }}
              >
                {selected.display_name || selected.username || t("OpenVoice member")}
                {selected.username && ` @${selected.username}`}
                {selected.is_moderation && (
                  <span className="ml-2 rounded bg-[#3a2d0b] px-2 py-0.5 text-xs text-[#f5b301]">
                    {t("Admin moderation")}
                  </span>
                )}
              </button>
              <div className="max-h-80 min-h-32 space-y-2 overflow-y-auto rounded border border-[#333] bg-[#0d0d0d] p-3">
                {messagesConversationId !== selected.id || messages.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {messagesConversationId === selected.id ? t("No messages yet. Say hello!") : t("Loading messages...")}
                  </p>
                ) : messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded p-2 text-sm ${
                      message.sender_id === session.user.id
                        ? "ml-auto bg-[#3a2d0b] text-white"
                        : "bg-[#242424] text-gray-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    <time className="mt-1 block text-right text-[10px] text-gray-400">
                      {new Date(message.created_at).toLocaleTimeString(language === "es" ? "es-US" : "en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="flex gap-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={2000}
                  className="min-w-0 flex-1 rounded border border-[#333] bg-[#1c1c1c] p-2 text-sm outline-none focus:border-[#f5b301]"
                  placeholder={t("Write a message...")}
                  aria-label={t("Write a message...")}
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="rounded px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                  style={{ background: GOLD }}
                >
                  {sending ? t("Sending...") : t("Send")}
                </button>
              </form>
              {!selected.is_moderation && (
                <DatingMatchCall
                  matchId={selected.id}
                  otherName={selected.display_name || selected.username || t("OpenVoice member")}
                  callType="friend"
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
