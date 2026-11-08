"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageContext";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallApp() {
  const { t } = useLanguage();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [serviceWorkerError, setServiceWorkerError] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then(() => {
        setServiceWorkerError(false);
      }).catch((cause: unknown) => {
        console.error("OpenVoice service worker registration failed.", cause);
        setServiceWorkerError(true);
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) {
      setShowInstructions(true);
      return;
    }
    await installEvent.prompt();
    const result = await installEvent.userChoice;
    if (result.outcome === "accepted") setInstallEvent(null);
  }

  if (installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        className="fixed bottom-20 right-3 z-30 rounded-full border border-[#f5b301] bg-[#141414] px-4 py-2 text-sm font-semibold text-white shadow-lg"
      >
        {t("Install OpenVoice")}
      </button>
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setShowInstructions(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-openvoice-title"
            className="w-full max-w-sm space-y-3 rounded-xl border border-[#444] bg-[#141414] p-5 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="install-openvoice-title" className="text-lg font-bold">{t("Install OpenVoice")}</h2>
              <button type="button" onClick={() => setShowInstructions(false)} aria-label={t("Close")} className="text-xl text-gray-400">×</button>
            </div>
            {isIOS ? (
              <p className="text-sm text-gray-300">{t("On your iPhone or iPad: open this page in Safari, tap Share, then choose Add to Home Screen.")}</p>
            ) : (
              <p className="text-sm text-gray-300">{t("In your browser menu, choose Install app or Add to Home Screen. On desktop, use the install icon in the address bar if it appears.")}</p>
            )}
            {serviceWorkerError && <p role="alert" className="text-xs text-yellow-200">{t("App install setup could not finish. Refresh the page and try again.")}</p>}
            <button type="button" onClick={() => setShowInstructions(false)} className="rounded px-4 py-2 font-semibold text-black" style={{ background: "#f5b301" }}>{t("Got it")}</button>
          </section>
        </div>
      )}
    </>
  );
}
