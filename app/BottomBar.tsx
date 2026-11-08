"use client";
import { Anton } from "next/font/google";
import { useLanguage } from "./LanguageContext";

const anton = Anton({ subsets: ["latin"], weight: "400" });

const GOLD = "#f5b301";

const ITEMS: { id: string; label: string; icon: string | null }[] = [
  { id: "home", label: "Home", icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { id: "reels", label: "Reels", icon: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M10 9l5 3-5 3z" },
  { id: "dating", label: "Dating", icon: "M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z" },
  { id: "alerts", label: "Alerts", icon: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4" },
  { id: "profile", label: "Profile", icon: null },
];

export default function BottomBar({
  tab,
  onSelect,
  avatarUrl,
  initial,
  alertCount = 0,
}: {
  tab: string;
  onSelect: (id: string) => void;
  avatarUrl: string | null;
  initial: string;
  alertCount?: number;
}) {
  const { t } = useLanguage();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-[#2a2a2a] bg-[#0a0a0a]/95 pb-2 backdrop-blur">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map((it) => {
          const active = tab === it.id;
          const color = active ? GOLD : "#9ca3af";
          return (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className={anton.className + " flex flex-col items-center gap-1 py-2 text-[11px] uppercase tracking-wider"}
              style={{ color }}
            >
              {it.icon ? (
                <span className="relative">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill={active ? GOLD : "none"}
                    stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
                    <path d={it.icon} />
                  </svg>
                  {it.id === "alerts" && alertCount > 0 && (
                    <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </span>
              ) : avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-[26px] w-[26px] rounded-full object-cover"
                  style={{ outline: active ? "2px solid " + GOLD : "none" }} />
              ) : (
                <span
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-xs font-bold text-black"
                  style={{ background: GOLD, outline: active ? "2px solid #fff" : "none" }}
                >
                  {initial}
                </span>
              )}
              {t(it.label)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
