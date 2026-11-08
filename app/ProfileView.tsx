"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useLanguage } from "./LanguageContext";
import ProfileReportButton from "./ProfileReportButton";

type ProfileRow = {
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  viewers_public: boolean | null;
  is_admin: boolean | null;
  hometown: string | null;
  relationship_status: string | null;
  looking_for: string | null;
  interests: string | null;
  favorite_music: string | null;
  favorite_movies: string | null;
  website: string | null;
};

type Viewer = {
  viewer_id: string;
  viewed_at: string;
  profiles: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

type FriendRequest = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "declined";
};

type FriendState = "loading" | "none" | "outgoing" | "incoming" | "friends";

const GOLD = "#f5b301";
const RED = "#d7261e";
const ADULT = /(porn|xxx|xvideos|xnxx|xhamster|redtube|youporn|spankbang|chaturbate|onlyfans|fansly|brazzers|erome|rule34|hentai|camsoda|stripchat|livejasmin|bongacams)/i;
const inputCls =
  "w-full rounded border border-[#333] bg-[#1c1c1c] p-2 text-white placeholder-gray-500 outline-none focus:border-[#f5b301]";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="overflow-hidden rounded border border-[#2a2a2a]">
      <div className="px-3 py-1 text-sm font-bold uppercase tracking-wider text-black" style={{ background: GOLD }}>
        {t(title)}
      </div>
      <div className="space-y-1 bg-[#1c1c1c] p-3 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="break-words">
      <span className="text-gray-400">{label}: </span>
      {value}
    </p>
  );
}

async function uploadImage(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files can be uploaded.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const path = userId + "/" + Date.now() + "-" + safeName;
  const { error } = await supabase.storage.from("profile-images").upload(path, file);
  if (error) throw new Error(error.message);
  return supabase.storage.from("profile-images").getPublicUrl(path).data.publicUrl;
}

export default function ProfileView({
  profileId,
  session,
  onBack,
  onMessage,
}: {
  profileId: string;
  session: Session | null;
  onBack?: () => void;
  onMessage?: (userId: string) => void;
}) {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [hometown, setHometown] = useState("");
  const [relationship, setRelationship] = useState("");
  const [lookingFor, setLookingFor] = useState("");
  const [interests, setInterests] = useState("");
  const [music, setMusic] = useState("");
  const [movies, setMovies] = useState("");
  const [website, setWebsite] = useState("");
  const [viewersPublic, setViewersPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<"avatar" | "cover" | null>(null);
  const [msg, setMsg] = useState("");
  const [friendState, setFriendState] = useState<FriendState>("loading");
  const [friendRequestId, setFriendRequestId] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<"feedback" | "suggestion">("feedback");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const isOwn = !!session && session.user.id === profileId;

  const loadFriendState = useCallback(async (): Promise<FriendState> => {
    if (!session || session.user.id === profileId) {
      setFriendState("none");
      setFriendRequestId(null);
      return "none";
    }

    setFriendState("loading");
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, requester_id, addressee_id, status")
      .or(`and(requester_id.eq.${session.user.id},addressee_id.eq.${profileId}),and(requester_id.eq.${profileId},addressee_id.eq.${session.user.id})`);
    if (error) throw new Error(error.message);

    const requests = (data ?? []) as FriendRequest[];
    const accepted = requests.find((request) => request.status === "accepted");
    const incoming = requests.find((request) =>
      request.status === "pending" && request.requester_id === profileId);
    const outgoing = requests.find((request) =>
      request.status === "pending" && request.requester_id === session.user.id);
    const current = accepted ?? incoming ?? outgoing;
    const nextState: FriendState = accepted ? "friends" : incoming ? "incoming" : outgoing ? "outgoing" : "none";
    setFriendRequestId(current?.id ?? null);
    setFriendState(nextState);
    return nextState;
  }, [profileId, session]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "display_name, username, bio, avatar_url, cover_url, viewers_public, is_admin, hometown, relationship_status, looking_for, interests, favorite_music, favorite_movies, website"
      )
      .eq("id", profileId)
      .single();
    if (error) throw new Error(error.message);
    setProfile(data as ProfileRow | null);

    const { data: v, error: viewersError } = await supabase
      .from("profile_views")
      .select("viewer_id, viewed_at, profiles!profile_views_viewer_id_fkey(display_name, username, avatar_url)")
      .eq("profile_id", profileId)
      .order("viewed_at", { ascending: false })
      .limit(20);
    if (viewersError) throw new Error(viewersError.message);
    setViewers((v as unknown as Viewer[]) ?? []);
  }, [profileId]);

  useEffect(() => {
    async function run() {
      if (session && session.user.id !== profileId) {
        const { error } = await supabase.from("profile_views").upsert(
          {
            profile_id: profileId,
            viewer_id: session.user.id,
            viewed_at: new Date().toISOString(),
          },
          { onConflict: "profile_id,viewer_id" }
        );
        if (error) setMsg(error.message);
      }
      try {
        await load();
      } catch (error) {
        setMsg(error instanceof Error ? error.message : t("Could not load profile."));
      }
    }
    run();
  }, [profileId, session, load, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFriendState().catch((error: unknown) => {
        setFriendState("none");
        setMsg(error instanceof Error ? error.message : t("Could not load friend status."));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFriendState, t]);

  async function sendFriendRequest() {
    if (!session || friendBusy) return;
    setFriendBusy(true);
    setMsg("");
    try {
      const { error } = await supabase.rpc("create_friend_request", { target_user: profileId });
      if (error) throw new Error(error.message);
      const nextState = await loadFriendState();
      setMsg(t(nextState === "friends"
        ? "Friend request accepted. You are now friends."
        : "Friend request sent."));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("Could not send friend request."));
    } finally {
      setFriendBusy(false);
    }
  }

  async function respondToFriendRequest(accept: boolean) {
    if (!friendRequestId || friendBusy) return;
    setFriendBusy(true);
    setMsg("");
    try {
      const { error } = await supabase.rpc("respond_friend_request", {
        target_request: friendRequestId,
        accept_request: accept,
      });
      if (error) throw new Error(error.message);
      await loadFriendState();
      setMsg(t(accept ? "Friend request accepted. You are now friends." : "Friend request declined."));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("Could not update friend request."));
    } finally {
      setFriendBusy(false);
    }
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || feedbackBusy || !feedbackText.trim()) return;
    setFeedbackBusy(true);
    setFeedbackMessage("");
    const { error } = await supabase.from("profile_feedback").insert({
      user_id: session.user.id,
      category: feedbackCategory,
      content: feedbackText.trim(),
    });
    if (error) {
      setFeedbackMessage(error.message);
    } else {
      setFeedbackText("");
      setFeedbackMessage(t("Thanks for helping improve OpenVoice."));
    }
    setFeedbackBusy(false);
  }

  function startEdit() {
    setName(profile?.display_name ?? "");
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setHometown(profile?.hometown ?? "");
    setRelationship(profile?.relationship_status ?? "");
    setLookingFor(profile?.looking_for ?? "");
    setInterests(profile?.interests ?? "");
    setMusic(profile?.favorite_music ?? "");
    setMovies(profile?.favorite_movies ?? "");
    setWebsite(profile?.website ?? "");
    setViewersPublic(profile?.viewers_public ?? true);
    setMsg("");
    setEditing(true);
  }

  async function changeProfilePhoto(event: React.ChangeEvent<HTMLInputElement>, field: "avatar_url" | "cover_url") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!session || !file || photoBusy) return;
    setPhotoBusy(field === "avatar_url" ? "avatar" : "cover");
    setMsg("");
    try {
      const imageUrl = await uploadImage(session.user.id, file);
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: imageUrl })
        .eq("id", session.user.id);
      if (error) throw new Error(error.message);
      await load();
      setMsg(t(field === "avatar_url" ? "Profile photo updated." : "Cover photo updated."));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("Could not update photo."));
    } finally {
      setPhotoBusy(null);
    }
  }

  async function save() {
    if (!session || saving) return;
    setSaving(true);
    setMsg("");
    try {
      let site = website.trim();
      if (site) {
        if (!/^https?:\/\//i.test(site)) site = "https://" + site;
        let host = "";
        try {
          host = new URL(site).hostname;
        } catch {
          throw new Error("That website link doesn't look valid.");
        }
        if (ADULT.test(host)) throw new Error("That kind of link is not allowed on OpenVoice.");
      }

      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name.trim() || null,
          username: cleanUsername || null,
          bio: bio.trim() || null,
          hometown: hometown.trim() || null,
          relationship_status: relationship.trim() || null,
          looking_for: lookingFor.trim() || null,
          interests: interests.trim() || null,
          favorite_music: music.trim() || null,
          favorite_movies: movies.trim() || null,
          website: site || null,
          viewers_public: viewersPublic,
        })
        .eq("id", session.user.id);
      if (error) throw new Error(error.message);
      setEditing(false);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("Could not save."));
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return <p className={msg ? "text-sm text-red-500" : "text-gray-400"}>{msg || t("Loading profile...")}</p>;
  }

  const shownName = profile.display_name || profile.username || t("No name yet");
  const initial = shownName.charAt(0).toUpperCase();
  const hasBasic = !!(profile.hometown || profile.relationship_status || profile.looking_for || profile.website);
  const safeSite = profile.website && /^https?:\/\//i.test(profile.website) ? profile.website : null;

  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#141414]">
      {onBack && (
        <button onClick={onBack} className="p-3 text-sm text-gray-400 hover:text-white">
          ← {t("Back")}
        </button>
      )}

      <div
        className="relative h-52 w-full bg-cover bg-center sm:h-60"
        style={{
          backgroundColor: "#1c1c1c",
          backgroundImage: profile.cover_url
            ? "url('" + profile.cover_url + "')"
            : "linear-gradient(135deg, " + GOLD + ", " + RED + ")",
        }}
      >
        {isOwn && !editing && (
          <label className="absolute bottom-3 right-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-black/75 px-3 py-2 text-sm font-semibold text-white hover:bg-black">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            {photoBusy === "cover" ? t("Uploading...") : t("Change cover")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label={t("Change cover")}
              disabled={photoBusy !== null}
              onChange={(event) => void changeProfilePhoto(event, "cover_url")}
            />
          </label>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="-mt-16 flex items-end justify-between">
          <div className="relative">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt=""
                className="h-32 w-32 rounded-full border-4 border-[#141414] object-cover sm:h-36 sm:w-36" />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-[#141414] text-5xl font-bold text-black sm:h-36 sm:w-36"
                style={{ background: GOLD }}>
                {initial}
              </div>
            )}
            {isOwn && !editing && (
              <label className="absolute bottom-1 right-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-2 border-[#141414] bg-[#f5b301] text-black shadow-lg hover:bg-[#ffca28]">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
                <span className="sr-only">{t("Change profile photo")}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={t("Change profile photo")}
                  disabled={photoBusy !== null}
                  onChange={(event) => void changeProfilePhoto(event, "avatar_url")}
                />
              </label>
            )}
          </div>
          {isOwn && !editing && (
            <button onClick={startEdit} className="rounded border border-[#555] px-4 py-2 text-sm font-semibold">
              {t("Edit profile")}
            </button>
          )}
        </div>

        {!editing ? (
          <div className="mt-3 space-y-3">
            <div>
              <h2 className="text-2xl font-bold">
                {shownName}
                {profile.is_admin && (
                  <span className="ml-2 rounded px-2 py-0.5 align-middle text-xs text-white" style={{ background: RED }}>
                    {t("ADMIN")}
                  </span>
                )}
              </h2>
              {profile.username && <p className="text-sm text-gray-400">@{profile.username}</p>}
              {!isOwn && session && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {friendState === "loading" && (
                    <span className="rounded border border-[#555] px-4 py-2 text-sm text-gray-400">
                      {t("Checking friend status...")}
                    </span>
                  )}
                  {friendState === "none" && (
                    <button
                      onClick={() => void sendFriendRequest()}
                      disabled={friendBusy}
                      className="rounded px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                      style={{ background: GOLD }}
                    >
                      {friendBusy ? t("Please wait...") : t("Add friend")}
                    </button>
                  )}
                  {friendState === "outgoing" && (
                    <span className="rounded border border-[#555] px-4 py-2 text-sm text-gray-300">
                      {t("Friend request sent")}
                    </span>
                  )}
                  {friendState === "incoming" && (
                    <>
                      <button
                        onClick={() => void respondToFriendRequest(true)}
                        disabled={friendBusy}
                        className="rounded px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
                        style={{ background: GOLD }}
                      >
                        {t("Accept request")}
                      </button>
                      <button
                        onClick={() => void respondToFriendRequest(false)}
                        disabled={friendBusy}
                        className="rounded border border-[#555] px-4 py-2 text-sm disabled:opacity-50"
                      >
                        {t("Decline")}
                      </button>
                    </>
                  )}
                  {friendState === "friends" && (
                    <>
                      <span className="rounded border border-[#555] px-4 py-2 text-sm text-gray-300">
                        {t("Friends")}
                      </span>
                      {onMessage && (
                        <button
                          onClick={() => onMessage(profileId)}
                          className="rounded px-4 py-2 text-sm font-bold text-black"
                          style={{ background: GOLD }}
                        >
                          {t("Message")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {!isOwn && session && (
                <ProfileReportButton profileId={profileId} session={session} />
              )}
              {msg && !editing && <p role="status" className="mt-2 text-sm text-gray-300">{t(msg)}</p>}
            </div>

            {profile.bio && (
              <Section title="About me">
                <p className="whitespace-pre-wrap break-words">{profile.bio}</p>
              </Section>
            )}

            {hasBasic && (
              <Section title="Basic info">
                <Row label={t("Hometown")} value={profile.hometown} />
                <Row label={t("Relationship status")} value={profile.relationship_status} />
                <Row label={t("Looking for")} value={profile.looking_for} />
                {safeSite && (
                  <p className="break-all">
                    <span className="text-gray-400">{t("Website")}: </span>
                    <a href={safeSite} target="_blank" rel="noopener noreferrer nofollow" style={{ color: GOLD }}>
                      {safeSite}
                    </a>
                  </p>
                )}
              </Section>
            )}

            {profile.interests && (
              <Section title="Interests">
                <p className="whitespace-pre-wrap break-words">{profile.interests}</p>
              </Section>
            )}
            {profile.favorite_music && (
              <Section title="Favorite music">
                <p className="whitespace-pre-wrap break-words">{profile.favorite_music}</p>
              </Section>
            )}
            {profile.favorite_movies && (
              <Section title="Favorite movies">
                <p className="whitespace-pre-wrap break-words">{profile.favorite_movies}</p>
              </Section>
            )}

            {isOwn && !profile.bio && !hasBasic && !profile.interests && (
              <p className="text-sm text-gray-400">{t("Tap Edit profile to fill in your page.")}</p>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input className={inputCls} placeholder={t("Display name")} value={name}
              onChange={(e) => setName(e.target.value)} />
            <input className={inputCls} placeholder={t("Username (letters, numbers, _)")} value={username}
              onChange={(e) => setUsername(e.target.value)} />
            <textarea className={inputCls} rows={3} placeholder={t("About me")} value={bio}
              onChange={(e) => setBio(e.target.value)} />
            <input className={inputCls} placeholder={t("Hometown (city, state only)")} value={hometown}
              onChange={(e) => setHometown(e.target.value)} />
            <input className={inputCls} placeholder={t("Relationship status")} value={relationship}
              onChange={(e) => setRelationship(e.target.value)} />
            <input className={inputCls} placeholder={t("Looking for (friendship, networking, dating...)")} value={lookingFor}
              onChange={(e) => setLookingFor(e.target.value)} />
            <textarea className={inputCls} rows={2} placeholder={t("Interests")} value={interests}
              onChange={(e) => setInterests(e.target.value)} />
            <textarea className={inputCls} rows={2} placeholder={t("Favorite music")} value={music}
              onChange={(e) => setMusic(e.target.value)} />
            <textarea className={inputCls} rows={2} placeholder={t("Favorite movies")} value={movies}
              onChange={(e) => setMovies(e.target.value)} />
            <input className={inputCls} placeholder={t("Website")} value={website}
              onChange={(e) => setWebsite(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={viewersPublic}
                onChange={(e) => setViewersPublic(e.target.checked)} />
              {t("Let everyone see who viewed my profile")}
            </label>
            <p className="text-xs" style={{ color: RED }}>
              {t("No nudity. Photos that break this rule get removed and the account can be banned.")}
            </p>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="rounded px-5 py-2 font-bold text-black disabled:opacity-50" style={{ background: GOLD }}>
                {saving ? t("Saving...") : t("Save")}
              </button>
              <button onClick={() => setEditing(false)} className="rounded border border-[#555] px-5 py-2">
                {t("Cancel")}
              </button>
            </div>
            {msg && <p className="text-sm text-red-500">{t(msg)}</p>}
          </div>
        )}

        <div className="mt-6 border-t border-[#2a2a2a] pt-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
            {t("Who viewed this profile")}
          </h3>
          {!isOwn && profile.viewers_public === false ? (
            <p className="text-sm text-gray-400">{t("This person keeps their viewers private.")}</p>
          ) : viewers.length === 0 ? (
            <p className="text-sm text-gray-400">{t("No views yet.")}</p>
          ) : (
            <ul className="space-y-2">
              {viewers.map((v) => (
                <li key={v.viewer_id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {v.profiles?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.profiles.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-black"
                        style={{ background: GOLD }}>
                        {(v.profiles?.display_name || v.profiles?.username || "A").charAt(0).toUpperCase()}
                      </span>
                    )}
                    {v.profiles?.display_name || v.profiles?.username || "Anonymous"}
                  </span>
                  <span className="text-xs text-gray-500">{new Date(v.viewed_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {msg && !editing && <p role="status" className="mt-3 text-sm text-gray-300">{t(msg)}</p>}

        {isOwn && !profile.is_admin && (
          <form onSubmit={submitFeedback} className="mt-6 space-y-3 border-t border-[#2a2a2a] pt-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                {t("Feedback or suggestion")}
              </h3>
              <p className="mt-1 text-sm text-gray-400">
                {t("Tell us what you would change or what you would like added.")}
              </p>
            </div>
            <div className="flex gap-2">
              {(["feedback", "suggestion"] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFeedbackCategory(category)}
                  aria-pressed={feedbackCategory === category}
                  className="rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: feedbackCategory === category ? GOLD : "#555",
                    color: feedbackCategory === category ? GOLD : "#d1d5db",
                  }}
                >
                  {t(category === "feedback" ? "Feedback" : "Suggestion")}
                </button>
              ))}
            </div>
            <textarea
              className={inputCls}
              rows={4}
              maxLength={2000}
              required
              value={feedbackText}
              onChange={(event) => setFeedbackText(event.target.value)}
              placeholder={t("Write your feedback or suggestion...")}
            />
            <button
              type="submit"
              disabled={feedbackBusy || !feedbackText.trim()}
              className="rounded px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
              style={{ background: GOLD }}
            >
              {feedbackBusy ? t("Sending...") : t("Send feedback")}
            </button>
            {feedbackMessage && <p role="status" className="text-sm text-gray-300">{t(feedbackMessage)}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
