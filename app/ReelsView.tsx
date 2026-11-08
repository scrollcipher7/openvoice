"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type RemixStyle = "duet" | "react_after";
type ReportReason = "nudity_or_sexual_content" | "violence_or_threats" | "harassment_or_doxxing" | "spam_or_other";

type Reel = {
  id: string;
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  video_path: string;
  video_url: string;
  caption: string;
  source_reel_id: string | null;
  remix_style: RemixStyle | null;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  source_video_path: string | null;
  source_video_url: string | null;
  source_caption: string | null;
  source_display_name: string | null;
  source_username: string | null;
};

type FeedReel = Omit<Reel, "video_url" | "source_video_url">;
type ReviewReel = {
  id: string;
  user_id: string;
  display_name: string;
  username: string | null;
  video_path: string;
  video_url: string | null;
  caption: string;
  source_reel_id: string | null;
  remix_style: RemixStyle | null;
  source_video_path: string | null;
  source_video_url: string | null;
  source_caption: string | null;
  source_display_name: string | null;
  report_count: number;
  report_reasons: string[];
  report_details: string[];
  created_at: string;
};
type ModerationReel = Omit<ReviewReel, "video_url" | "source_video_url">;

const GOLD = "#f5b301";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 60;

function isVideoFile(file: File): boolean {
  return ["video/mp4", "video/webm", "video/quicktime"].includes(file.type);
}

function isMissingStorageObject(error: { statusCode?: string; message: string }): boolean {
  return error.statusCode === "404" || error.message.toLowerCase().includes("not found");
}

function getRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    .find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null;
}

function validateVideoDuration(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        reject(new Error("Could not read the video's duration."));
      } else if (video.duration > MAX_DURATION_SECONDS) {
        reject(new Error(`Videos must be ${MAX_DURATION_SECONDS} seconds or shorter.`));
      } else {
        resolve();
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not open this video. Choose an MP4, WebM, or QuickTime video."));
    };
    video.src = objectUrl;
  });
}

export default function ReelsView({ session, isAdmin }: { session: Session | null; isAdmin: boolean }) {
  const [reels, setReels] = useState<Reel[]>([]);
  const [moderationQueue, setModerationQueue] = useState<ReviewReel[]>([]);
  const [isReelsBanned, setIsReelsBanned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [remixSource, setRemixSource] = useState<Reel | null>(null);
  const [remixStyle, setRemixStyle] = useState<RemixStyle>("duet");
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("spam_or_other");
  const [reportDetails, setReportDetails] = useState("");
  const [recording, setRecording] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cameraRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);

  const loadReels = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    const [{ data, error: resultError }, { data: banRow, error: banError }] = await Promise.all([
      supabase.rpc("get_reels_feed"),
      supabase.from("reel_bans").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    ]);
    if (resultError || banError) {
      setError(resultError?.message ?? banError?.message ?? "Could not load Reels.");
      setLoading(false);
      return;
    }
    setIsReelsBanned(Boolean(banRow));

    const rows = (data ?? []) as FeedReel[];
    const paths = [...new Set(rows.flatMap((reel) =>
      [reel.video_path, reel.source_video_path].filter((path): path is string => Boolean(path))
    ))];
    const urls = new Map<string, string>();
    const missingPaths = new Set<string>();
    for (const path of paths) {
      const { data: signed, error: signedError } = await supabase.storage.from("reels").createSignedUrl(path, 3600);
      if (signedError) {
        if (isMissingStorageObject(signedError)) {
          missingPaths.add(path);
          continue;
        }
        setError(`Could not load a Reel video: ${signedError.message}`);
        setLoading(false);
        return;
      }
      urls.set(path, signed.signedUrl);
    }
    setReels(rows.map((reel) => ({
      ...reel,
      video_url: missingPaths.has(reel.video_path) ? "" : urls.get(reel.video_path) ?? "",
      source_video_url: reel.source_video_path && !missingPaths.has(reel.source_video_path)
        ? urls.get(reel.source_video_path) ?? null
        : null,
    })));
    setLoading(false);
  }, [session]);

  const loadModerationQueue = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error: queueError } = await supabase.rpc("get_reel_moderation_queue");
    if (queueError) {
      setError(`Could not load the moderation queue: ${queueError.message}`);
      return;
    }
    const rows = (data ?? []) as ModerationReel[];
    const paths = [...new Set(rows.flatMap((reel) =>
      [reel.video_path, reel.source_video_path].filter((path): path is string => Boolean(path))
    ))];
    const urls = new Map<string, string>();
    const missingPaths = new Set<string>();
    for (const path of paths) {
      const { data: signed, error: signedError } = await supabase.storage.from("reels").createSignedUrl(path, 3600);
      if (signedError) {
        if (isMissingStorageObject(signedError)) {
          missingPaths.add(path);
          continue;
        }
        setError(`Could not open a Reel for moderation: ${signedError.message}`);
        return;
      }
      urls.set(path, signed.signedUrl);
    }
    setModerationQueue(rows.map((reel) => ({
      ...reel,
      video_url: missingPaths.has(reel.video_path) ? null : urls.get(reel.video_path) ?? null,
      source_video_url: reel.source_video_path && !missingPaths.has(reel.source_video_path)
        ? urls.get(reel.source_video_path) ?? null
        : null,
    })));
  }, [isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReels(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReels]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadModerationQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [loadModerationQueue]);

  useEffect(() => {
    if (cameraRef.current && cameraStream) cameraRef.current.srcObject = cameraStream;
  }, [cameraStream]);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraStream(null);
    setRecording(false);
    setRecordingSeconds(0);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera recording is not available in this browser. Choose a video from your gallery instead.");
      return;
    }
    if (!getRecorderMimeType()) {
      setError("Video recording is not supported in this browser. Choose a video from your gallery instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      setCameraStream(stream);
    } catch (cause) {
      setError(cause instanceof Error
        ? `Could not open your camera: ${cause.message}. Check camera and microphone permission, or choose a video from your gallery.`
        : "Could not open your camera. Check camera and microphone permission, or choose a video from your gallery.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    const mimeType = getRecorderMimeType();
    if (!stream || !mimeType || typeof MediaRecorder === "undefined") {
      setError("Start the camera before recording.");
      return;
    }
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        if (!blob.size) {
          setError("The recording was empty. Try recording again.");
          return;
        }
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        setVideoFile(new File([blob], `openvoice-reel.${extension}`, { type: blob.type }));
        stopCamera();
        setNotice("Recording ready. Add a caption and post your Reel.");
      };
      recorder.start();
      setRecording(true);
      elapsedRef.current = 0;
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setRecordingSeconds(elapsedRef.current);
        if (elapsedRef.current >= MAX_DURATION_SECONDS && recorder.state === "recording") recorder.stop();
      }, 1000);
    } catch (cause) {
      setError(cause instanceof Error ? `Could not record video: ${cause.message}` : "Could not record video.");
    }
  }

  function finishRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function publishReel() {
    if (!session || !videoFile || busy) return;
    if (isReelsBanned) {
      setError("This account is banned from posting or interacting with Reels.");
      return;
    }
    setError("");
    setNotice("");
    if (!isVideoFile(videoFile)) {
      setError("Choose an MP4, WebM, or QuickTime video.");
      return;
    }
    if (videoFile.size > MAX_FILE_SIZE) {
      setError("Videos must be 50 MB or smaller.");
      return;
    }
    if (caption.trim().length > 280) {
      setError("Captions must be 280 characters or shorter.");
      return;
    }
    setBusy(true);
    try {
      await validateVideoDuration(videoFile);
      const extension = videoFile.type === "video/webm" ? "webm"
        : videoFile.type === "video/quicktime" ? "mov" : "mp4";
      const path = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("reels").upload(path, videoFile, {
        contentType: videoFile.type,
        upsert: false,
      });
      if (uploadError) throw new Error(`Could not upload the Reel: ${uploadError.message}`);

      const { error: insertError } = await supabase.from("reels").insert({
        user_id: session.user.id,
        video_path: path,
        caption: caption.trim(),
        source_reel_id: remixSource?.id ?? null,
        remix_style: remixSource ? remixStyle : null,
      });
      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from("reels").remove([path]);
        throw new Error(cleanupError
          ? `Could not publish the Reel: ${insertError.message}. Its uploaded video could not be removed: ${cleanupError.message}`
          : `Could not publish the Reel: ${insertError.message}`);
      }
      setVideoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setCaption("");
      setRemixSource(null);
      setNotice("Your Reel was sent to admin review. It will appear in the feed after approval.");
      await Promise.all([loadReels(), loadModerationQueue()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish the Reel.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(reel: Reel) {
    if (!session || busy) return;
    if (isReelsBanned) {
      setError("This account is banned from posting or interacting with Reels.");
      return;
    }
    setError("");
    const result = reel.liked_by_me
      ? await supabase.from("reel_likes").delete().eq("reel_id", reel.id).eq("user_id", session.user.id)
      : await supabase.from("reel_likes").insert({ reel_id: reel.id, user_id: session.user.id });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setReels((current) => current.map((item) => item.id === reel.id ? {
      ...item,
      liked_by_me: !item.liked_by_me,
      like_count: Math.max(0, item.like_count + (reel.liked_by_me ? -1 : 1)),
    } : item));
  }

  async function submitReport(reel: Reel) {
    if (!session) return;
    if (isReelsBanned) {
      setError("This account is banned from posting or interacting with Reels.");
      return;
    }
    setError("");
    const { error: reportError } = await supabase.from("reel_reports").insert({
      reel_id: reel.id,
      reporter_id: session.user.id,
      reason: reportReason,
      details: reportDetails.trim(),
    });
    if (reportError) {
      setError(reportError.code === "23505" ? "You already reported this Reel." : reportError.message);
      return;
    }
    setReportTarget(null);
    setReportDetails("");
    setNotice("Report sent to OpenVoice admins.");
  }

  async function deleteReel(reel: Reel) {
    if (!session || (reel.user_id !== session.user.id && !isAdmin)) return;
    setError("");
    setBusy(true);
    const { error: deleteError } = await supabase.from("reels").delete().eq("id", reel.id);
    if (deleteError) {
      setError(`Could not delete the Reel: ${deleteError.message}`);
      setBusy(false);
      return;
    }
    const { error: removeError } = await supabase.storage.from("reels").remove([reel.video_path]);
    setReels((current) => current.filter((item) => item.id !== reel.id));
    setBusy(false);
    setNotice(removeError
      ? `Reel removed, but its private video file could not be deleted: ${removeError.message}`
      : "Reel deleted.");
  }

  async function reviewReel(reel: ReviewReel, decision: "approve" | "remove" | "ban_for_nudity") {
    if (!isAdmin || busy) return;
    setError("");
    setBusy(true);
    if (decision !== "approve") {
      let videoPaths = [reel.video_path];
      if (decision === "ban_for_nudity") {
        const { data: creatorReels, error: creatorReelsError } = await supabase
          .from("reels")
          .select("video_path")
          .eq("user_id", reel.user_id);
        if (creatorReelsError) {
          setError(`Could not load the creator's videos for removal: ${creatorReelsError.message}`);
          setBusy(false);
          return;
        }
        videoPaths = [...new Set((creatorReels ?? []).map((item) => item.video_path))];
      }
      for (const path of videoPaths) {
        const { error: removeError } = await supabase.storage.from("reels").remove([path]);
        if (removeError && !isMissingStorageObject(removeError)) {
          setError(`Could not remove the Reel video before moderation: ${removeError.message}`);
          setBusy(false);
          return;
        }
      }
    }
    const { error: reviewError } = await supabase.rpc("review_reel", {
      target_reel: reel.id,
      decision,
    });
    if (reviewError) {
      setError(`The video was removed, but the moderation decision could not be saved: ${reviewError.message}`);
      setBusy(false);
      return;
    }
    setNotice(decision === "approve" ? "Reel approved and published."
      : decision === "ban_for_nudity" ? "Reel removed; creator is banned from Reels for confirmed nudity."
        : "Reel removed.");
    setBusy(false);
    await Promise.all([loadModerationQueue(), loadReels()]);
  }

  function beginRemix(reel: Reel, style: RemixStyle) {
    setError("");
    setNotice("");
    stopCamera();
    setVideoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setCaption("");
    setRemixSource(reel);
    setRemixStyle(style);
    window.sessionStorage.setItem("openvoice-active-tab", "reels");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!session) return <p className="rounded border border-[#333] bg-[#141414] p-5 text-gray-300">Sign in to watch and post Reels.</p>;

  return (
    <section className="space-y-4 pb-4 text-white">
      <header className="flex items-center justify-between rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-wide" style={{ color: GOLD }}>Reels</h2>
          <p className="text-sm text-gray-400">Short videos, reactions, and remixes.</p>
        </div>
        <button type="button" onClick={() => void loadReels()} className="rounded bg-[#292929] px-3 py-2 text-sm">Refresh</button>
      </header>

      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded border border-[#665000] bg-[#2a2208] p-3 text-sm text-yellow-100">{notice}</p>}
      {isReelsBanned && <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">This account is banned from posting and interacting with Reels.</p>}
      <p className="rounded border border-[#333] bg-[#141414] p-3 text-sm text-gray-400">
        New Reels are reviewed before they appear. Confirmed nudity means a ban from Reels. Reports help admins review published videos.
      </p>

      {!isReelsBanned && <div className="space-y-3 rounded-lg border border-[#333] bg-[#141414] p-4">
        <h3 className="font-semibold">{remixSource ? `Remix ${remixSource.display_name}'s Reel` : "Post a Reel"}</h3>
        {remixSource && (
          <div className="flex gap-2">
            <button type="button" disabled={busy || recording} onClick={() => setRemixStyle("duet")} className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${remixStyle === "duet" ? "text-black" : "bg-[#292929]"}`} style={remixStyle === "duet" ? { background: GOLD } : undefined}>Side-by-side Duet</button>
            <button type="button" disabled={busy || recording} onClick={() => setRemixStyle("react_after")} className={`rounded px-3 py-2 text-sm disabled:opacity-50 ${remixStyle === "react_after" ? "text-black" : "bg-[#292929]"}`} style={remixStyle === "react_after" ? { background: GOLD } : undefined}>React after</button>
            <button type="button" disabled={busy || recording} onClick={() => { stopCamera(); setRemixSource(null); setVideoFile(null); }} className="ml-auto rounded px-3 py-2 text-sm text-gray-300 disabled:opacity-50">Cancel</button>
          </div>
        )}
        {cameraStream && (
          <div className="space-y-2">
            <video ref={cameraRef} autoPlay muted playsInline className="aspect-video max-h-72 w-full rounded bg-black object-contain" />
            <p className="text-sm text-gray-400">{recording ? `Recording ${recordingSeconds}/${MAX_DURATION_SECONDS}s` : "Camera is ready. Recording stops at 60 seconds."}</p>
            {!recording ? (
              <button type="button" onClick={startRecording} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold">Start recording</button>
            ) : (
              <button type="button" onClick={finishRecording} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold">Stop recording</button>
            )}
          </div>
        )}
        <label className="block text-sm text-gray-300">
          {remixSource ? "Choose a reaction video from your gallery" : "Choose a video from your device"}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            disabled={busy || recording}
            onChange={(event) => setVideoFile(event.currentTarget.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-[#333] file:px-3 file:py-2 file:text-white disabled:opacity-50"
          />
        </label>
        {!cameraStream ? (
          <button type="button" onClick={() => void startCamera()} disabled={busy} className="rounded border border-[#555] px-3 py-2 text-sm disabled:opacity-50">
            Record with camera
          </button>
        ) : (
          <button type="button" onClick={stopCamera} disabled={recording} className="rounded border border-[#555] px-3 py-2 text-sm disabled:opacity-50">
            Close camera
          </button>
        )}
        {videoFile && <p className="text-sm text-green-300">Selected: {videoFile.name}</p>}
        <label className="block text-sm text-gray-300">
          Caption
          <textarea maxLength={280} value={caption} onChange={(event) => setCaption(event.target.value)} className="mt-1 block min-h-20 w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white" />
        </label>
        <p className="text-xs text-gray-500">MP4, WebM, or QuickTime · up to 60 seconds · 50 MB maximum. Follow the OpenVoice rules: no nudity, sexual content, threats, violence, doxxing, or harassment.</p>
        <button type="button" onClick={() => void publishReel()} disabled={!videoFile || busy || recording || isReelsBanned} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
          {busy ? "Posting…" : remixSource ? "Post remix" : "Post Reel"}
        </button>
      </div>}

      {isAdmin && (
        <section className="space-y-3 rounded-lg border border-[#665000] bg-[#141414] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold" style={{ color: GOLD }}>Reels moderation queue</h3>
            <button type="button" onClick={() => void loadModerationQueue()} className="rounded bg-[#292929] px-3 py-2 text-sm">Refresh</button>
          </div>
          <p className="text-sm text-gray-400">New uploads stay private until approved. If you confirm nudity, remove the Reel and ban the creator from Reels.</p>
          {moderationQueue.map((reel) => (
            <article key={reel.id} className="space-y-2 rounded border border-[#333] p-3">
              <p className="font-semibold">{reel.display_name}{reel.username ? <span className="ml-2 text-sm text-gray-400">@{reel.username}</span> : null}</p>
              <p className="text-xs text-gray-500">Submitted {new Date(reel.created_at).toLocaleString()} · {reel.report_count} pending report(s)</p>
              {!!reel.report_reasons.length && <p className="text-sm text-yellow-100">Reported for: {reel.report_reasons.join(", ").replaceAll("_", " ")}</p>}
              {!!reel.report_details.length && <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">{reel.report_details.map((detail, index) => <li key={`${reel.id}-report-${index}`}>{detail}</li>)}</ul>}
              {reel.source_video_url && (
                <div>
                  <p className="text-xs text-gray-400">Original · {reel.source_display_name}</p>
                  <video src={reel.source_video_url} controls playsInline preload="metadata" className="max-h-64 w-full rounded bg-black object-contain" />
                </div>
              )}
              {reel.video_url ? (
                <video src={reel.video_url} controls playsInline preload="metadata" className="max-h-64 w-full rounded bg-black object-contain" />
              ) : <p className="text-sm text-red-300">Video file was already removed. You can still resolve the report.</p>}
              {reel.caption && <p className="text-sm">{reel.caption}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void reviewReel(reel, "approve")} className="rounded bg-green-800 px-3 py-2 text-sm disabled:opacity-50">Approve</button>
                <button type="button" disabled={busy} onClick={() => void reviewReel(reel, "remove")} className="rounded bg-[#333] px-3 py-2 text-sm disabled:opacity-50">Remove</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Remove all of this creator’s Reels and ban them from Reels for confirmed nudity?")) {
                      void reviewReel(reel, "ban_for_nudity");
                    }
                  }}
                  className="rounded bg-red-800 px-3 py-2 text-sm disabled:opacity-50"
                >
                  Confirmed nudity: remove & ban
                </button>
              </div>
            </article>
          ))}
          {!moderationQueue.length && <p className="text-sm text-gray-400">No Reels need review.</p>}
        </section>
      )}

      {loading ? <p className="p-4 text-gray-400">Loading Reels…</p> : reels.length ? (
        <div className="space-y-4">
          {reels.map((reel) => (
            <article key={reel.id} className="space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{reel.display_name}{reel.username ? <span className="ml-2 text-sm text-gray-400">@{reel.username}</span> : null}</p>
                  <p className="text-xs text-gray-500">{new Date(reel.created_at).toLocaleString()}</p>
                  {reel.source_reel_id && <p className="text-xs text-yellow-100">Remix of {reel.source_display_name ?? "another Reel"}{reel.source_username ? ` (@${reel.source_username})` : ""}</p>}
                </div>
                {(reel.user_id === session.user.id || isAdmin) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Delete this Reel?")) void deleteReel(reel);
                    }}
                    className="rounded border border-[#444] px-3 py-2 text-sm text-gray-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
              {reel.remix_style === "duet" && reel.source_video_url ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Original · {reel.source_display_name}</p>
                    <video src={reel.source_video_url} controls playsInline preload="metadata" className="aspect-[9/16] max-h-[32rem] w-full rounded bg-black object-contain" />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Duet · {reel.display_name}</p>
                    <video src={reel.video_url} controls playsInline preload="metadata" className="aspect-[9/16] max-h-[32rem] w-full rounded bg-black object-contain" />
                  </div>
                </div>
              ) : reel.remix_style === "react_after" && reel.source_video_url ? (
                <div className="space-y-2">
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Original · {reel.source_display_name}</p>
                    <video src={reel.source_video_url} controls playsInline preload="metadata" className="aspect-video max-h-[32rem] w-full rounded bg-black object-contain" />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-400">Reaction · {reel.display_name}</p>
                    <video src={reel.video_url} controls playsInline preload="metadata" className="aspect-video max-h-[32rem] w-full rounded bg-black object-contain" />
                  </div>
                </div>
              ) : (
                <video src={reel.video_url} controls playsInline preload="metadata" className="max-h-[70vh] w-full rounded bg-black object-contain" />
              )}
              {reel.source_caption && <p className="text-sm text-gray-400">Original: {reel.source_caption}</p>}
              {reel.caption && <p className="whitespace-pre-wrap">{reel.caption}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void toggleLike(reel)} disabled={busy || isReelsBanned || reel.user_id === session.user.id} className="rounded border border-[#444] px-3 py-2 text-sm disabled:opacity-50">
                  {reel.liked_by_me ? "♥ Liked" : "♡ Like"} · {reel.like_count}
                </button>
                <button type="button" disabled={busy || recording || isReelsBanned} onClick={() => beginRemix(reel, "duet")} className="rounded border border-[#444] px-3 py-2 text-sm disabled:opacity-50">Side-by-side Duet</button>
                <button type="button" disabled={busy || recording || isReelsBanned} onClick={() => beginRemix(reel, "react_after")} className="rounded border border-[#444] px-3 py-2 text-sm disabled:opacity-50">React after</button>
                {reel.user_id !== session.user.id && !isAdmin && !isReelsBanned && (
                  <button type="button" onClick={() => setReportTarget(reportTarget === reel.id ? null : reel.id)} className="ml-auto rounded border border-[#444] px-3 py-2 text-sm text-gray-300">Report</button>
                )}
              </div>
              {reportTarget === reel.id && (
                <div className="space-y-2 rounded border border-[#444] p-3">
                  <label className="block text-sm">Reason
                    <select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)} className="mt-1 block w-full rounded border border-[#444] bg-[#0a0a0a] p-2 text-white">
                      <option value="nudity_or_sexual_content">Nudity or sexual content</option>
                      <option value="violence_or_threats">Violence or threats</option>
                      <option value="harassment_or_doxxing">Harassment or doxxing</option>
                      <option value="spam_or_other">Spam or other</option>
                    </select>
                  </label>
                  <textarea maxLength={500} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Details (optional)" className="block w-full rounded border border-[#444] bg-[#0a0a0a] p-2 text-white" />
                  <button type="button" onClick={() => void submitReport(reel)} className="rounded bg-[#333] px-3 py-2 text-sm">Send report</button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : <p className="rounded border border-[#333] bg-[#141414] p-4 text-gray-400">No Reels yet. Post a short video to start the feed.</p>}
    </section>
  );
}
