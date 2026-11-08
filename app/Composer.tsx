"use client";
import { Anton } from "next/font/google";
import { useLanguage } from "./LanguageContext";

const anton = Anton({ subsets: ["latin"], weight: "400" });

const GOLD = "#f5b301";

const inputCls =
  "w-full rounded border border-[#333] bg-[#1c1c1c] p-2 text-white placeholder-gray-500 outline-none focus:border-[#f5b301]";

export default function Composer({
  avatarUrl,
  initial,
  open,
  setOpen,
  text,
  setText,
  linkUrl,
  setLinkUrl,
  setFile,
  fileKey,
  posting,
  msg,
  onPost,
  onCreateLive,
}: {
  avatarUrl: string | null;
  initial: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  text: string;
  setText: (v: string) => void;
  linkUrl: string;
  setLinkUrl: (v: string) => void;
  setFile: (f: File | null) => void;
  fileKey: number;
  posting: boolean;
  msg: string;
  onPost: () => Promise<boolean>;
  onCreateLive: () => void;
}) {
  const { t } = useLanguage();
  async function submit() {
    const ok = await onPost();
    if (ok) setOpen(false);
  }

  const avatar = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  ) : (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-black"
      style={{ background: GOLD }}
    >
      {initial}
    </div>
  );

  if (!open) {
    return (
      <div className="space-y-2 rounded-lg border border-[#2a2a2a] bg-[#141414] p-3">
        <div className="flex items-center gap-3">
          {avatar}
          <button
            onClick={() => setOpen(true)}
            className="flex-1 rounded-full border border-[#333] bg-[#1c1c1c] px-4 py-2 text-left text-gray-400 hover:border-[#f5b301]"
          >
            {t("What's on your mind?")}
          </button>
        </div>
        <div className="flex border-t border-[#2a2a2a] pt-2">
          <button
            type="button"
            onClick={onCreateLive}
            className="flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm text-gray-300 hover:bg-[#1c1c1c]"
          >
            <span aria-hidden="true" className="text-lg text-red-500">●</span>
            {t("Live video")}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("Add photo")}
            className="flex flex-1 items-center justify-center gap-2 rounded py-2 text-sm text-gray-300 hover:bg-[#1c1c1c]"
          >
            <span aria-hidden="true" className="text-lg">▧</span>
            {t("Photo/Video")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
      <div className="flex items-center gap-3">
        {avatar}
        <p className={anton.className + " text-lg uppercase tracking-wider"}>{t("New post")}</p>
      </div>
      <textarea
        className={inputCls}
        rows={3}
        placeholder={t("What's on your mind?")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <input
        className={inputCls}
        placeholder={t("Paste a link (YouTube, Spotify, SoundCloud, TikTok, Amazon Music...)")}
        value={linkUrl}
        onChange={(e) => setLinkUrl(e.target.value)}
      />
      <input
        key={fileKey}
        type="file"
        accept="image/*"
        className="text-sm text-gray-400"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={posting}
          className={anton.className + " rounded px-6 py-2 uppercase tracking-wider text-black disabled:opacity-50"}
          style={{ background: GOLD }}
        >
          {posting ? t("Posting...") : t("Post")}
        </button>
        <button onClick={() => setOpen(false)} className="rounded border border-[#555] px-5 py-2">
          {t("Cancel")}
        </button>
      </div>
      {msg && <p className="text-sm text-red-500">{t(msg)}</p>}
    </div>
  );
}
