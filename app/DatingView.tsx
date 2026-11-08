"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import DatingSelfieCall from "./DatingSelfieCall";
import DatingMatchCall from "./DatingMatchCall";

const GOLD = "#f5b301";
const PHOTO_SLOTS: PhotoSlot[] = ["photo_1", "photo_2", "photo_3", "meme", "ai"];
const ICEBREAKERS = [
  "What’s something you’ve been excited about lately?",
  "What would your ideal first date look like?",
  "What song have you had on repeat?",
];

function photoLabel(slot: PhotoSlot): string {
  if (slot === "meme") return "Meme";
  if (slot === "ai") return "AI-generated photo";
  return `Photo ${slot.slice(-1)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getOwnDatingImagePath(imageUrl: string, userId: string): string {
  const marker = "/storage/v1/object/public/profile-images/";
  if (!imageUrl.includes(marker)) return "";
  try {
    const path = decodeURIComponent(imageUrl.split(marker)[1]);
    return path.startsWith(`${userId}/dating/`) ? path : "";
  } catch {
    return "";
  }
}

function makeDatingPhotoPath(userId: string, slot: PhotoSlot, fileName: string): string {
  const extension = fileName.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  return `${userId}/dating/${slot}-${Date.now()}.${extension}`;
}

type DatingProfile = {
  gender: "" | "male" | "female";
  is_transgender: boolean;
  about: string;
  city: string;
  looking_for: "" | "friendship" | "dating" | "marriage";
  interests: string;
  is_visible: boolean;
};

type PhotoSlot = "photo_1" | "photo_2" | "photo_3" | "meme" | "ai";
type DatingPhoto = { slot: PhotoSlot; image_url: string };

type DatingCandidate = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  age: number;
  gender: "male" | "female";
  is_transgender: boolean;
  city: string;
  about: string;
  looking_for: "friendship" | "dating" | "marriage";
  interests: string;
  photos: DatingPhoto[];
};

type DatingMatch = {
  match_id: string;
  other_user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  matched_at: string;
};

type DatingMessage = {
  id: number;
  sender_id: string;
  content: string;
  created_at: string;
};

const emptyProfile: DatingProfile = {
  gender: "",
  is_transgender: false,
  about: "",
  city: "",
  looking_for: "dating",
  interests: "",
  is_visible: false,
};

export default function DatingView({
  session,
  onOpenProfile,
}: {
  session: Session | null;
  onOpenProfile: (userId: string) => void;
}) {
  const [profile, setProfile] = useState<DatingProfile>(emptyProfile);
  const [photos, setPhotos] = useState<DatingPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState<PhotoSlot | null>(null);
  const [birthDate, setBirthDate] = useState({ month: "", day: "", year: "" });
  const [savedDateOfBirth, setSavedDateOfBirth] = useState(false);
  const [adultAttested, setAdultAttested] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("not_started");
  const [candidates, setCandidates] = useState<DatingCandidate[]>([]);
  const [matches, setMatches] = useState<DatingMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState<DatingMatch | null>(null);
  const [messages, setMessages] = useState<DatingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<"profile" | "discover" | "matches">("profile");

  const loadOverview = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setError("");
    const [privateResult, profileResult, verificationResult, photosResult] = await Promise.all([
      supabase.from("dating_private").select("date_of_birth").eq("user_id", session.user.id).maybeSingle(),
      supabase.from("dating_profiles")
        .select("gender, is_transgender, about, city, looking_for, interests, is_visible")
        .eq("user_id", session.user.id)
        .maybeSingle(),
      supabase.from("dating_verifications").select("status").eq("user_id", session.user.id).maybeSingle(),
      supabase.from("dating_profile_photos").select("slot, image_url").eq("user_id", session.user.id),
    ]);

    const failed = privateResult.error || profileResult.error || verificationResult.error || photosResult.error;
    if (failed) {
      setError(failed.message);
      setLoading(false);
      return;
    }

    const savedDob = privateResult.data?.date_of_birth ?? "";
    const [year = "", month = "", day = ""] = savedDob.split("-");
    setBirthDate(savedDob ? { month, day, year } : { month: "", day: "", year: "" });
    setSavedDateOfBirth(Boolean(savedDob));
    setAdultAttested(Boolean(savedDob));
    const savedProfile = profileResult.data ? { ...emptyProfile, ...profileResult.data } : emptyProfile;
    if (!["friendship", "dating", "marriage"].includes(savedProfile.looking_for)) {
      savedProfile.looking_for = "dating";
    }
    setProfile(savedProfile);
    setPhotos((photosResult.data ?? []) as DatingPhoto[]);
    setVerificationStatus(verificationResult.data?.status ?? "not_started");
    setLoading(false);
  }, [session]);

  const loadMatches = useCallback(async () => {
    const { data, error: resultError } = await supabase.rpc("get_dating_matches");
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setMatches((data ?? []) as DatingMatch[]);
  }, []);

  const loadMessages = useCallback(async (matchId: string) => {
    const { data, error: resultError } = await supabase
      .from("dating_messages")
      .select("id, sender_id, content, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setMessages((data ?? []) as DatingMessage[]);
  }, []);

  const refreshVerificationStatus = useCallback(async () => {
    if (!session) return;
    const { data, error: resultError } = await supabase
      .from("dating_verifications")
      .select("status")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setVerificationStatus(data?.status ?? "not_started");
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  useEffect(() => {
    if (!session || (verificationStatus !== "requested" && verificationStatus !== "in_progress")) return;
    const timer = window.setInterval(() => void refreshVerificationStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshVerificationStatus, session, verificationStatus]);

  useEffect(() => {
    if (!activeMatch || verificationStatus !== "selfie_checked") return;
    const timer = window.setInterval(() => void loadMessages(activeMatch.match_id), 5000);
    return () => window.clearInterval(timer);
  }, [activeMatch, loadMessages, verificationStatus]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setError("");
    setNotice("");
    if (!birthDate.month || !birthDate.day || !/^\d{4}$/.test(birthDate.year)) {
      setError("Enter your full date of birth using month, day, and a four-digit year.");
      return;
    }
    if (!adultAttested) {
      setError("Enter your date of birth and confirm that you are at least 18.");
      return;
    }
    const dateOfBirth = `${birthDate.year}-${birthDate.month.padStart(2, "0")}-${birthDate.day.padStart(2, "0")}`;
    const parsedDateOfBirth = new Date(`${dateOfBirth}T00:00:00`);
    if (
      Number.isNaN(parsedDateOfBirth.getTime())
      || parsedDateOfBirth.getFullYear() !== Number(birthDate.year)
      || parsedDateOfBirth.getMonth() !== Number(birthDate.month) - 1
      || parsedDateOfBirth.getDate() !== Number(birthDate.day)
    ) {
      setError("Enter a valid date of birth.");
      return;
    }
    if (parsedDateOfBirth > new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate())) {
      setError("Dating is only available to people who are at least 18.");
      return;
    }

    setSaving(true);
    const { error: dobError } = await supabase.from("dating_private").upsert({
      user_id: session.user.id,
      date_of_birth: dateOfBirth,
      self_attested_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (dobError) {
      setError(dobError.message);
      setSaving(false);
      return;
    }

    const { error: profileError } = await supabase.from("dating_profiles").upsert({
      user_id: session.user.id,
      ...profile,
      is_visible: verificationStatus === "selfie_checked" && profile.is_visible,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (profileError) {
      setSavedDateOfBirth(true);
      setError(`Your private date of birth was saved, but the dating profile could not be saved: ${profileError.message}`);
      setSaving(false);
      return;
    }

    setSavedDateOfBirth(true);
    setNotice("Dating profile saved. Your birth date stays private.");
    setSaving(false);
  }

  async function requestSelfieCheck() {
    setError("");
    setNotice("");
    const { error: resultError } = await supabase.rpc("request_dating_verification");
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setVerificationStatus("requested");
    setNotice("Request recorded. Your profile remains hidden until an admin reviews your live selfie check.");
  }

  async function loadDiscovery() {
    setError("");
    const { data, error: resultError } = await supabase.rpc("get_dating_profiles");
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setCandidates((data ?? []) as DatingCandidate[]);
  }

  async function changePhoto(slot: PhotoSlot, file: File | undefined) {
    if (!session || !file) return;
    setError("");
    setNotice("");
    if (!savedDateOfBirth) {
      setError("Save your date of birth and confirm you are 18 or older before adding Dating photos.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Choose a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Each Dating photo must be under 5 MB.");
      return;
    }

    setPhotoBusy(slot);
    try {
      const oldPhoto = photos.find((photo) => photo.slot === slot);
      const path = makeDatingPhotoPath(session.user.id, slot, file.name);
      const { error: uploadError } = await supabase.storage.from("profile-images").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      const imageUrl = supabase.storage.from("profile-images").getPublicUrl(path).data.publicUrl;
      const { error: saveError } = await supabase.from("dating_profile_photos").upsert({
        user_id: session.user.id,
        slot,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,slot" });
      if (saveError) {
        const { error: cleanupError } = await supabase.storage.from("profile-images").remove([path]);
        throw new Error(cleanupError
          ? `Could not save this photo: ${saveError.message}. The uploaded file also could not be removed: ${cleanupError.message}`
          : `Could not save this photo: ${saveError.message}`);
      }

      setPhotos((current) => [...current.filter((photo) => photo.slot !== slot), { slot, image_url: imageUrl }]);
      if (oldPhoto) {
        const oldPath = getOwnDatingImagePath(oldPhoto.image_url, session.user.id);
        if (oldPath) {
          const { error: removeError } = await supabase.storage.from("profile-images").remove([oldPath]);
          if (removeError) setError(`New photo saved, but the previous file could not be removed: ${removeError.message}`);
        }
      }
      setNotice(`${photoLabel(slot)} saved. You can replace or remove it any time.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this photo.");
    } finally {
      setPhotoBusy(null);
    }
  }

  async function removePhoto(slot: PhotoSlot) {
    if (!session) return;
    setError("");
    setNotice("");
    setPhotoBusy(slot);
    try {
      const photo = photos.find((item) => item.slot === slot);
      const { error: deleteError } = await supabase.from("dating_profile_photos")
        .delete()
        .eq("user_id", session.user.id)
        .eq("slot", slot);
      if (deleteError) throw new Error(deleteError.message);
      setPhotos((current) => current.filter((item) => item.slot !== slot));
      if (photo) {
        const path = getOwnDatingImagePath(photo.image_url, session.user.id);
        if (path) {
          const { error: removeError } = await supabase.storage.from("profile-images").remove([path]);
          if (removeError) {
            setError(`Photo removed from your Dating profile, but its storage file could not be removed: ${removeError.message}`);
            return;
          }
        }
      }
      setNotice(`${photoLabel(slot)} removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this photo.");
    } finally {
      setPhotoBusy(null);
    }
  }

  async function likeProfile(candidate: DatingCandidate) {
    if (!session) return;
    setError("");
    const { error: resultError } = await supabase.from("dating_likes").insert({
      liker_id: session.user.id,
      target_id: candidate.user_id,
    });
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setCandidates((current) => current.filter((item) => item.user_id !== candidate.user_id));
    setNotice("Interest sent.");
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !activeMatch) return;
    const content = draft.trim();
    if (!content) return;
    setError("");
    const { error: resultError } = await supabase.from("dating_messages").insert({
      match_id: activeMatch.match_id,
      sender_id: session.user.id,
      content,
    });
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setDraft("");
    await loadMessages(activeMatch.match_id);
  }

  if (!session) {
    return <p className="rounded border border-[#333] bg-[#141414] p-5 text-gray-300">Sign in to set up an in-app dating profile.</p>;
  }

  if (loading) {
    return <p className="rounded border border-[#333] bg-[#141414] p-5 text-gray-300">Loading dating profile…</p>;
  }

  return (
    <section className="space-y-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4 text-white">
      <header>
        <h2 className="text-2xl font-bold uppercase tracking-wide" style={{ color: GOLD }}>OpenVoice Dating</h2>
        <p className="mt-1 text-sm text-gray-400">Profiles, matches, and messages stay inside OpenVoice.</p>
      </header>

      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded border border-[#665000] bg-[#2a2208] p-3 text-sm text-yellow-100">{notice}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#333] bg-[#1c1c1c] p-3">
        <p className="text-sm text-gray-300">
          Connected to your OpenVoice account. Your OpenVoice name, username, and profile photo appear in Dating; Dating details and photos stay separate.
        </p>
        <button
          type="button"
          onClick={() => onOpenProfile(session.user.id)}
          className="shrink-0 rounded border border-[#665000] px-3 py-2 text-sm font-semibold hover:bg-[#292929]"
        >
          View my OpenVoice profile
        </button>
      </div>

      <div className="rounded border border-[#665000] bg-[#211b08] p-3 text-sm text-yellow-100">
        Your date of birth is private and is used only for the 18+ self-attestation. A self-attestation is not formal age verification.
        Discovery unlocks only after a reviewer checks a live selfie against your profile photo when available. This does not verify your identity or age. OpenVoice does not record or store video, but cannot prevent capture outside the app; no ID is collected.
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[#333] pb-3">
        <button onClick={() => setSection("profile")} className="rounded px-3 py-2 text-sm" style={{ background: section === "profile" ? GOLD : "#292929", color: section === "profile" ? "#111" : "#fff" }}>My profile</button>
        <button
          onClick={() => {
            setSection("discover");
            if (verificationStatus === "selfie_checked") void loadDiscovery();
          }}
          disabled={verificationStatus !== "selfie_checked"}
          className="rounded px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: section === "discover" ? GOLD : "#292929", color: section === "discover" ? "#111" : "#fff" }}
        >Discover</button>
        <button
          onClick={() => {
            setSection("matches");
            if (verificationStatus === "selfie_checked") void loadMatches();
          }}
          disabled={verificationStatus !== "selfie_checked"}
          className="rounded px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: section === "matches" ? GOLD : "#292929", color: section === "matches" ? "#111" : "#fff" }}
        >Matches & chat</button>
      </div>

      {section === "profile" && (
        <div className="space-y-4">
          <form onSubmit={saveProfile} className="space-y-4">
            <label className="block text-sm">
              Gender
              <select
                required
                value={profile.gender}
                onChange={(event) => {
                  const gender = event.target.value;
                  if (gender === "male" || gender === "female") setProfile({ ...profile, gender });
                }}
                className="mt-1 block w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white"
              >
                <option value="" disabled>Select gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={profile.is_transgender}
                onChange={(event) => setProfile({ ...profile, is_transgender: event.target.checked })}
                className="mt-1 accent-yellow-500"
              />
              <span>
                I’m transgender <span className="block text-xs text-gray-500">Optional. Only shown on your Dating profile if you choose this.</span>
              </span>
            </label>
            <label className="block text-sm">
              Date of birth (private)
              <span className="mt-1 grid grid-cols-3 gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="bday-month"
                  aria-label="Birth month"
                  placeholder="MM"
                  maxLength={2}
                  pattern="[0-9]*"
                  required
                  value={birthDate.month}
                  onChange={(event) => setBirthDate({ ...birthDate, month: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                  className="min-w-0 rounded border border-[#444] bg-[#0a0a0a] p-3 text-white"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="bday-day"
                  aria-label="Birth day"
                  placeholder="DD"
                  maxLength={2}
                  pattern="[0-9]*"
                  required
                  value={birthDate.day}
                  onChange={(event) => setBirthDate({ ...birthDate, day: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                  className="min-w-0 rounded border border-[#444] bg-[#0a0a0a] p-3 text-white"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="bday-year"
                  aria-label="Birth year"
                  placeholder="YYYY"
                  maxLength={4}
                  pattern="[0-9]*"
                  required
                  value={birthDate.year}
                  onChange={(event) => setBirthDate({ ...birthDate, year: event.target.value.replace(/\D/g, "").slice(0, 4) })}
                  className="min-w-0 rounded border border-[#444] bg-[#0a0a0a] p-3 text-white"
                />
              </span>
              <span className="mt-1 block text-xs text-gray-500">Enter month, day, and year. Use Tab to move between fields.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={adultAttested} onChange={(event) => setAdultAttested(event.target.checked)} className="mt-1 accent-yellow-500" />
              I confirm that I am at least 18 years old.
            </label>
            <label className="block text-sm">
              About me
              <textarea maxLength={600} value={profile.about} onChange={(event) => setProfile({ ...profile, about: event.target.value })} className="mt-1 block min-h-24 w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white" />
            </label>
            <label className="block text-sm">
              City
              <input maxLength={120} value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} className="mt-1 block w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white" />
            </label>
            <label className="block text-sm">
              Looking for
              <select required value={profile.looking_for} onChange={(event) => {
                const lookingFor = event.target.value;
                if (lookingFor === "friendship" || lookingFor === "dating" || lookingFor === "marriage") {
                  setProfile({ ...profile, looking_for: lookingFor });
                }
              }} className="mt-1 block w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white">
                <option value="friendship">Friendship</option>
                <option value="dating">Dating</option>
                <option value="marriage">Marriage</option>
              </select>
            </label>
            <label className="block text-sm">
              Interests
              <textarea maxLength={600} value={profile.interests} onChange={(event) => setProfile({ ...profile, interests: event.target.value })} className="mt-1 block min-h-20 w-full rounded border border-[#444] bg-[#0a0a0a] p-3 text-white" />
            </label>
            {verificationStatus === "selfie_checked" && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={profile.is_visible} onChange={(event) => setProfile({ ...profile, is_visible: event.target.checked })} className="accent-yellow-500" />
                Show my profile in dating discovery
              </label>
            )}
            <button disabled={saving} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>
              {saving ? "Saving…" : "Save dating profile"}
            </button>
          </form>

          <div className="space-y-3 rounded border border-[#333] p-4">
            <div>
              <h3 className="font-semibold">Dating photos</h3>
              <p className="mt-1 text-sm text-gray-400">Add up to 3 regular photos, 1 meme, and 1 AI-generated photo of yourself. Replace or remove each image whenever you like. AI photos are labeled in discovery.</p>
            </div>
            {!savedDateOfBirth && <p className="text-sm text-yellow-100">Save your birth date and 18+ confirmation before uploading.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {PHOTO_SLOTS.map((slot) => {
                const photo = photos.find((item) => item.slot === slot);
                return (
                  <div key={slot} className="space-y-2 rounded border border-[#333] p-3">
                    <p className="text-sm font-semibold">{photoLabel(slot)}</p>
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.image_url} alt={photoLabel(slot)} className="h-40 w-full rounded object-cover" />
                    )}
                    <label className="block text-sm text-gray-300">
                      {photo ? "Change photo" : "Add photo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        disabled={!savedDateOfBirth || photoBusy !== null}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          void changePhoto(slot, input.files?.[0]).finally(() => { input.value = ""; });
                        }}
                        className="mt-1 block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-[#333] file:px-3 file:py-2 file:text-white disabled:opacity-50"
                      />
                    </label>
                    {photo && <button type="button" disabled={photoBusy !== null} onClick={() => void removePhoto(slot)} className="rounded border border-red-500 px-3 py-1 text-sm text-red-300 disabled:opacity-50">
                      {photoBusy === slot ? "Saving…" : "Remove"}
                    </button>}
                    {photoBusy === slot && <p className="text-xs text-gray-400">Uploading…</p>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded border border-[#333] p-4">
            <p className="font-semibold">Selfie check status: <span style={{ color: GOLD }}>{verificationStatus.replaceAll("_", " ")}</span></p>
            {!savedDateOfBirth && <p className="mt-2 text-sm text-gray-400">Save your date of birth and profile before requesting a check.</p>}
            <button type="button" onClick={() => void refreshVerificationStatus()} className="mt-3 rounded bg-[#292929] px-4 py-2 text-sm">Refresh status</button>
            {verificationStatus !== "selfie_checked" && (
              <button
                onClick={() => void requestSelfieCheck()}
                disabled={!savedDateOfBirth || verificationStatus === "requested" || verificationStatus === "in_progress"}
                className="mt-3 rounded bg-[#292929] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verificationStatus === "requested" ? "Check requested" : verificationStatus === "in_progress" ? "Live check in progress" : "Request in-app selfie check"}
              </button>
            )}
            {verificationStatus === "requested" && (
              <p className="mt-3 text-sm text-gray-300">
                Your request is waiting for an OpenVoice admin to start the live check from Admin → Dating selfie checks. Your camera stays off while you wait. When the status changes to “in progress,” start the camera below and allow camera access in your browser.
              </p>
            )}
            {verificationStatus === "in_progress" && <p className="mt-3 text-sm text-gray-300">An admin has started your check. Press “Start live selfie check” below when you are ready, then allow camera access in your browser.</p>}
          </div>
          {verificationStatus === "in_progress" && (
            <DatingSelfieCall userId={session.user.id} role="applicant" />
          )}
        </div>
      )}

      {section === "discover" && (
        verificationStatus !== "selfie_checked" ? (
          <p className="text-gray-400">Discovery is locked until your in-app live video selfie check is approved.</p>
        ) : candidates.length ? (
          <div className="space-y-3">
            {candidates.map((candidate) => (
              <article key={candidate.user_id} className="rounded border border-[#333] p-4">
                {candidate.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.avatar_url} alt="" className="mb-3 h-24 w-24 rounded-full object-cover" />
                )}
                <h3 className="text-xl font-semibold">{candidate.display_name}, {candidate.age}</h3>
                <button
                  type="button"
                  onClick={() => onOpenProfile(candidate.user_id)}
                  className="mt-1 text-sm text-yellow-300 underline underline-offset-2"
                >
                  View OpenVoice profile
                </button>
                <p className="text-sm capitalize text-gray-300">{candidate.gender}</p>
                {candidate.is_transgender && <p className="text-sm text-gray-300">Transgender</p>}
                <p className="text-sm text-gray-300">Looking for: {capitalize(candidate.looking_for)}</p>
                {candidate.city && <p className="text-sm text-gray-400">{candidate.city}</p>}
                <p className="mt-2 whitespace-pre-wrap">{candidate.about}</p>
                {candidate.interests && <p className="mt-2 text-sm"><span className="text-gray-400">Interests: </span>{candidate.interests}</p>}
                {!!candidate.photos.length && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {candidate.photos.map((photo) => (
                      <figure key={photo.slot} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.image_url} alt={photoLabel(photo.slot)} className="h-40 w-full rounded object-cover" />
                        {photo.slot === "meme" || photo.slot === "ai" ? (
                          <figcaption className="absolute bottom-1 left-1 rounded bg-black/80 px-2 py-1 text-xs">{photoLabel(photo.slot)}</figcaption>
                        ) : null}
                      </figure>
                    ))}
                  </div>
                )}
                <button onClick={() => void likeProfile(candidate)} className="mt-4 rounded px-4 py-2 font-semibold text-black" style={{ background: GOLD }}>Like</button>
              </article>
            ))}
          </div>
        ) : <p className="text-gray-400">No profiles to show right now.</p>
      )}

      {section === "matches" && (
        verificationStatus !== "selfie_checked" ? (
          <p className="text-gray-400">Matches and chat are locked until your in-app live video selfie check is approved.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_2fr]">
            <div className="space-y-2">
              {matches.map((match) => (
                <button key={match.match_id} onClick={() => {
                  setActiveMatch(match);
                  void loadMessages(match.match_id);
                }} className="block w-full rounded border border-[#333] p-3 text-left hover:border-[#665000]">
                  {match.display_name}
                  {match.username && <span className="block text-xs text-gray-400">@{match.username}</span>}
                </button>
              ))}
              {!matches.length && <p className="text-sm text-gray-400">No mutual matches yet.</p>}
            </div>
            <div className="rounded border border-[#333] p-3">
              {activeMatch ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{activeMatch.display_name}</h3>
                    <button
                      type="button"
                      onClick={() => onOpenProfile(activeMatch.other_user_id)}
                      className="text-sm text-yellow-300 underline underline-offset-2"
                    >
                      View OpenVoice profile
                    </button>
                  </div>
                  <DatingMatchCall
                    key={activeMatch.match_id}
                    matchId={activeMatch.match_id}
                    otherName={activeMatch.display_name}
                  />
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {messages.map((message) => (
                      <p key={message.id} className={`max-w-[85%] rounded p-2 text-sm ${message.sender_id === session.user.id ? "ml-auto bg-[#665000]" : "bg-[#292929]"}`}>
                        {message.content}
                      </p>
                    ))}
                  </div>
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-gray-400">Conversation starters</p>
                    <div className="flex flex-wrap gap-2">
                      {ICEBREAKERS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => setDraft(prompt)}
                          className="rounded-full border border-[#444] px-3 py-1 text-left text-xs text-gray-300 hover:border-[#f5b301]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <form onSubmit={sendMessage} className="mt-3 flex gap-2">
                    <input maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message" className="min-w-0 flex-1 rounded border border-[#444] bg-[#0a0a0a] p-2 text-white" />
                    <button className="rounded px-3 font-semibold text-black" style={{ background: GOLD }}>Send</button>
                  </form>
                </>
              ) : <p className="text-sm text-gray-400">Choose a mutual match to open your private chat.</p>}
            </div>
          </div>
        )
      )}
    </section>
  );
}
