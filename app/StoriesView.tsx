"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "./LanguageContext";

type Story = {
  id: string;
  user_id: string;
  media_path: string;
  media_type: "image" | "video";
  caption: string;
  created_at: string;
  expires_at: string;
  profiles: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
  media_url?: string;
};

const GOLD = "#f5b301";
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

function validateVideoDuration(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const valid = Number.isFinite(video.duration) && video.duration > 0 && video.duration <= MAX_VIDEO_SECONDS;
      cleanup();
      if (valid) resolve();
      else reject(new Error("Stories videos must be 60 seconds or shorter."));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read the selected video."));
    };
    video.src = objectUrl;
  });
}

export default function StoriesView({
  session,
  avatarUrl,
  createOpen,
  onCreateHandled,
  onCreateStory,
}: {
  session: Session;
  avatarUrl: string | null;
  createOpen: boolean;
  onCreateHandled: () => void;
  onCreateStory: () => void;
}) {
  const { language, t } = useLanguage();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadStories = useCallback(async () => {
    const { data: expired, error: expiredError } = await supabase
      .from("profile_stories")
      .select("id, media_path")
      .eq("user_id", session.user.id)
      .lte("expires_at", new Date().toISOString());
    if (expiredError) {
      setError(expiredError.message);
      setLoading(false);
      return;
    }
    if (expired?.length) {
      const { error: filesError } = await supabase.storage
        .from("stories")
        .remove(expired.map((story) => story.media_path));
      if (filesError) {
        setError(t("Expired stories could not be cleaned up:") + ` ${filesError.message}`);
        setLoading(false);
        return;
      }
      const { error: rowsError } = await supabase.from("profile_stories")
        .delete()
        .in("id", expired.map((story) => story.id));
      if (rowsError) {
        setError(rowsError.message);
        setLoading(false);
        return;
      }
    }

    const { data, error: resultError } = await supabase
      .from("profile_stories")
      .select("id, user_id, media_path, media_type, caption, created_at, expires_at, profiles!profile_stories_user_id_fkey(display_name, username, avatar_url)")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    if (resultError) {
      setError(resultError.message);
      setLoading(false);
      return;
    }

    const next = (data ?? []) as unknown as Story[];
    const signedStories = await Promise.all(next.map(async (story) => {
      const { data: signed, error: signedError } = await supabase.storage
        .from("stories")
        .createSignedUrl(story.media_path, 3600);
      if (signedError) throw new Error(signedError.message);
      return { ...story, media_url: signed.signedUrl };
    })).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t("Could not load stories."));
      return null;
    });
    if (!signedStories) {
      setLoading(false);
      return;
    }
    setStories(signedStories);
    setError("");
    setLoading(false);
  }, [session.user.id, t]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadStories(), 0);
    const timer = window.setInterval(() => void loadStories(), 60000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadStories]);

  useEffect(() => {
    if (createOpen) {
      setFile(null);
      setCaption("");
      setError("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }, [createOpen]);

  async function publishStory() {
    if (!file || creating) return;
    setCreating(true);
    setError("");
    let path: string | null = null;
    try {
      const isImage = file.type.startsWith("image/");
      const isVideo = VIDEO_TYPES.includes(file.type);
      if (!isImage && !isVideo) throw new Error("Choose an image or an MP4, WebM, or QuickTime video.");
      if (file.size > MAX_FILE_SIZE) throw new Error("Story files must be 50 MB or smaller.");
      if (isVideo) await validateVideoDuration(file);

      const safeName = file.name.replace(/[^\w.-]/g, "_");
      path = `${session.user.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("stories").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from("profile_stories").insert({
        user_id: session.user.id,
        media_path: path,
        media_type: isImage ? "image" : "video",
        caption: caption.trim(),
      });
      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from("stories").remove([path]);
        if (cleanupError) {
          throw new Error(`Could not publish the Story: ${insertError.message}. Its uploaded file could not be removed: ${cleanupError.message}`);
        }
        throw new Error(insertError.message);
      }

      setFile(null);
      setCaption("");
      if (fileInput.current) fileInput.current.value = "";
      onCreateHandled();
      await loadStories();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not publish the Story."));
    } finally {
      setCreating(false);
    }
  }

  async function deleteStory(story: Story) {
    const { error: rowError } = await supabase.from("profile_stories")
      .delete()
      .eq("id", story.id);
    if (rowError) {
      setError(rowError.message);
      return;
    }
    const { error: fileError } = await supabase.storage.from("stories").remove([story.media_path]);
    if (fileError) {
      setError(t("Story deleted, but its media file could not be removed:") + ` ${fileError.message}`);
    }
    setActiveStory(null);
    await loadStories();
  }

  function displayName(story: Story) {
    return story.profiles?.display_name || story.profiles?.username || t("OpenVoice member");
  }

  return (
    <>
      <section aria-label={t("Stories")} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={onCreateStory}
          aria-label={t("Create story")}
          className="w-28 h-44 shrink-0 overflow-hidden rounded-xl border border-[#333] bg-[#1c1c1c] text-left"
        >
          <span className="relative flex h-[138px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#333] to-[#111]">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            )}
            <span className="absolute bottom-[-18px] flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#1c1c1c] bg-blue-500 text-2xl leading-none text-white">+</span>
          </span>
          <span className="flex h-[38px] items-end justify-center bg-[#1c1c1c] px-1 pb-1 text-center text-xs font-semibold">{t("Create story")}</span>
        </button>
        {!loading && stories.map((story) => {
          const own = story.user_id === session.user.id;
          return (
            <button
              type="button"
              key={story.id}
              onClick={() => setActiveStory(story)}
              className="relative h-44 w-28 shrink-0 overflow-hidden rounded-xl border border-[#333] bg-[#222] text-left"
              aria-label={`${t("View story from")} ${displayName(story)}`}
            >
              {story.media_type === "image" && story.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={story.media_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#444] to-[#111] text-3xl" aria-hidden="true">▶</span>
              )}
              <span className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
              {story.profiles?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={story.profiles.avatar_url} alt="" className="absolute left-2 top-2 h-9 w-9 rounded-full border-2 border-blue-500 object-cover" />
              ) : (
                <span className="absolute left-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-blue-500 bg-[#333] text-sm font-bold">
                  {displayName(story).charAt(0).toUpperCase()}
                </span>
              )}
              <span className="absolute bottom-2 left-2 right-2 line-clamp-2 text-sm font-semibold text-white">
                {own ? t("Your story") : displayName(story)}
              </span>
            </button>
          );
        })}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </section>

      {createOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void publishStory();
            }}
            className="w-full max-w-md space-y-4 rounded-lg border border-[#333] bg-[#141414] p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: GOLD }}>{t("Create a Story")}</h2>
              <button type="button" onClick={onCreateHandled} aria-label={t("Close")} className="px-2 text-xl text-gray-400">×</button>
            </div>
            <p className="text-sm text-gray-400">{t("Stories disappear after 24 hours.")}</p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-[#333] file:px-3 file:py-2 file:text-white"
            />
            {file && <p className="text-sm text-gray-400">{t("Selected:")} {file.name}</p>}
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={280}
              rows={2}
              className="w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white"
              placeholder={t("Add a caption (optional)")}
            />
            <p className="text-xs text-gray-500">
              {t("Images or videos up to 60 seconds and 50 MB. OpenVoice rules apply: no nudity or sexual content, threats, calls for violence, graphic gore, or doxxing.")}
            </p>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!file || creating} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
                {creating ? t("Posting...") : t("Post Story")}
              </button>
              <button type="button" onClick={onCreateHandled} className="rounded border border-[#555] px-4 py-2">
                {t("Cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeStory && activeStory.media_url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3" onClick={() => setActiveStory(null)}>
          <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-[#111]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayName(activeStory)}</p>
                <time className="text-xs text-gray-400">
                  {new Date(activeStory.created_at).toLocaleString(language === "es" ? "es-US" : "en-US")}
                </time>
              </div>
              <div className="flex shrink-0 gap-2">
                {activeStory.user_id === session.user.id && (
                  <button type="button" onClick={() => void deleteStory(activeStory)} className="text-sm text-red-300">
                    {t("Delete")}
                  </button>
                )}
                <button type="button" onClick={() => setActiveStory(null)} aria-label={t("Close")} className="px-2 text-xl text-gray-300">×</button>
              </div>
            </div>
            {activeStory.media_type === "video" ? (
              <video src={activeStory.media_url} autoPlay controls playsInline className="max-h-[72vh] w-full bg-black object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeStory.media_url} alt="" className="max-h-[72vh] w-full bg-black object-contain" />
            )}
            {activeStory.caption && <p className="whitespace-pre-wrap p-3 text-sm">{activeStory.caption}</p>}
          </div>
        </div>
      )}
    </>
  );
}
