"use client";
import { useState } from "react";
import { Anton } from "next/font/google";
import { LanguageSwitch, useLanguage } from "./LanguageContext";

const anton = Anton({ subsets: ["latin"], weight: "400" });

const GOLD = "#f5b301";
const RED = "#d7261e";

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill={GOLD} />
      <path d="M12 14h40a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H30l-12 10v-10h-6a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z"
        fill="#0a0a0a" />
      <rect x="18" y="26" width="4" height="8" rx="2" fill={GOLD} />
      <rect x="26" y="20" width="4" height="20" rx="2" fill={GOLD} />
      <rect x="34" y="23" width="4" height="14" rx="2" fill={GOLD} />
      <rect x="42" y="27" width="4" height="6" rx="2" fill={RED} />
    </svg>
  );
}

const btn =
  "flex h-10 w-10 items-center justify-center rounded-full bg-[#1c1c1c] text-white hover:bg-[#2a2a2a]";

export default function TopBar({
  onCreatePost,
  onCreateReel,
  onCreateStory,
  onSearch,
  onMessages,
}: {
  onCreatePost: () => void;
  onCreateReel: () => void;
  onCreateStory: () => void;
  onSearch: () => void;
  onMessages: () => void;
}) {
  const { t } = useLanguage();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  function choose(action: () => void) {
    setCreateMenuOpen(false);
    action();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[#2a2a2a] bg-[#0a0a0a]/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <LogoMark size={34} />
          <span className={anton.className + " text-2xl uppercase leading-none tracking-wider"}>
            Open<span style={{ color: GOLD }}>Voice</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <LanguageSwitch compact />
          <div className="relative">
            <button
              onClick={() => setCreateMenuOpen((open) => !open)}
              className={btn}
              aria-label={t("Create")}
              aria-expanded={createMenuOpen}
              aria-haspopup="menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {createMenuOpen && (
              <div role="menu" className="absolute right-0 top-12 z-30 w-44 overflow-hidden rounded-lg border border-[#333] bg-[#1c1c1c] p-1 shadow-xl">
                <button role="menuitem" onClick={() => choose(onCreatePost)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[#2a2a2a]">
                  {t("Post to feed")}
                </button>
                <button role="menuitem" onClick={() => choose(onCreateReel)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[#2a2a2a]">
                  {t("Reel")}
                </button>
                <button role="menuitem" onClick={() => choose(onCreateStory)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[#2a2a2a]">
                  {t("Story")}
                </button>
              </div>
            )}
          </div>
          <button onClick={onSearch} className={btn} aria-label={t("Search")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          </button>
          <button onClick={onMessages} className={btn} aria-label={t("Messages")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
              <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
