"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type ProfileRow = {
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  viewers_public: boolean | null;
  is_admin: boolean | null;
};

type Viewer = {
  viewer_id: string;
  viewed_at: string;
  profiles: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

const GOLD = "#f5b301";
const RED = "#d7261e";
const inputCls =
  "w-full rounded border border-[#333] bg-[#1c1c1c] p-2 text-white placeholder-gray-500 outline-none focus:border-[#f5b301]";

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
}: {
  profileId: string;
  session: Session | null;
  onBack?: () => void;
}) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [viewersPublic, setViewersPublic] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const isOwn = !!session && session.user.id === profileId;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, username, bio, avatar_url, cover_url, viewers_public, is_admin")
      .eq("id", profileId)
      .single();
    setProfile(data as ProfileRow | null);

    const { data: v } = await supabase
      .from("profile_views")
      .select("viewer_id, viewed_at, profiles!profile_views_viewer_id_fkey(display_name, username, avatar_url)")
      .eq("profile_id", profileId)
      .order("viewed_at", { ascending: false })
      .limit(20);
    setViewers((v as unknown as Viewer[]) ?? []);
  }, [profileId]);

  useEffect(() => {
    async function run() {
      if (session && session.user.id !== profileId) {
        await supabase.from("profile_views").upsert(
          {
            profile_id: profileId,
            viewer_id: session.user.id,
            viewed_at: new Date().toISOString(),
          },
          { onConflict: "profile_id,viewer_id" }
        );
      }
      load();
    }
    run();
  }, [profileId, session, load]);

  function startEdit() {
    setName(profile?.display_name ?? "");
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setViewersPublic(profile?.viewers_public ?? true);
    setAvatarFile(null);
    setCoverFile(null);
    setMsg("");
    setEditing(true);
  }

  async function save() {
    if (!session || saving) return;
    setSaving(true);
    setMsg("");
    try {
      let avatarUrl = profile?.avatar_url ?? null;
      let coverUrl = profile?.cover_url ?? null;
      if (avatarFile) avatarUrl = await uploadImage(session.user.id, avatarFile);
      if (coverFile) coverUrl = await uploadImage(session.user.id, coverFile);

      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name.trim() || null,
          username: cleanUsername || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
          cover_url: coverUrl,
          viewers_public: viewersPublic,
        })
        .eq("id", session.user.id);
      if (error) throw new Error(error.message);
      setEditing(false);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    }
    setSaving(false);
  }

  if (!profile) return <p className="text-gray-400">Loading profile...</p>;

  const shownName = profile.display_name || profile.username || "No name yet";
  const initial = shownName.charAt(0).toUpperCase();

  return (
    <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#141414]">
      {onBack && (
        <button onClick={onBack} className="p-3 text-sm text-gray-400 hover:text-white">
          ← Back
        </button>
      )}

      <div
        className="h-36 w-full bg-cover bg-center"
        style={{
          backgroundColor: "#1c1c1c",
          backgroundImage: profile.cover_url
            ? "url('" + profile.cover_url + "')"
            : "linear-gradient(135deg, " + GOLD + ", " + RED + ")",
        }}
      />

      <div className="px-4 pb-4">
        <div className="-mt-12 flex items-end justify-between">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt=""
              className="h-24 w-24 rounded-full border-4 border-[#141414] object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-[#141414] text-4xl font-bold text-black"
              style={{ background: GOLD }}>
              {initial}
            </div>
          )}
          {isOwn && !editing && (
            <button onClick={startEdit} className="rounded border border-[#555] px-4 py-2 text-sm font-semibold">
              Edit profile
            </button>
          )}
        </div>

        {!editing ? (
          <div className="mt-3 space-y-1">
            <h2 className="text-2xl font-bold">
              {shownName}
              {profile.is_admin && (
                <span className="ml-2 rounded px-2 py-0.5 align-middle text-xs text-white" style={{ background: RED }}>
                  ADMIN
                </span>
              )}
            </h2>
            {profile.username && <p className="text-sm text-gray-400">@{profile.username}</p>}
            {profile.bio && <p className="whitespace-pre-wrap break-words pt-2">{profile.bio}</p>}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input className={inputCls} placeholder="Display name" value={name}
              onChange={(e) => setName(e.target.value)} />
            <input className={inputCls} placeholder="Username (letters, numbers, _)" value={username}
              onChange={(e) => setUsername(e.target.value)} />
            <textarea className={inputCls} rows={3} placeholder="Bio" value={bio}
              onChange={(e) => setBio(e.target.value)} />
            <label className="block text-sm text-gray-400">
              Profile photo
              <input type="file" accept="image/*" className="mt-1 block text-sm"
                onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="block text-sm text-gray-400">
              Cover photo
              <input type="file" accept="image/*" className="mt-1 block text-sm"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={viewersPublic}
                onChange={(e) => setViewersPublic(e.target.checked)} />
              Let everyone see who viewed my profile
            </label>
            <p className="text-xs" style={{ color: RED }}>
              No nudity. Photos that break this rule get removed and the account can be banned.
            </p>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="rounded px-5 py-2 font-bold text-black disabled:opacity-50" style={{ background: GOLD }}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="rounded border border-[#555] px-5 py-2">
                Cancel
              </button>
            </div>
            {msg && <p className="text-sm text-red-500">{msg}</p>}
          </div>
        )}

        <div className="mt-6 border-t border-[#2a2a2a] pt-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider" style={{ color: GOLD }}>
            Who viewed this profile
          </h3>
          {!isOwn && profile.viewers_public === false ? (
            <p className="text-sm text-gray-400">This person keeps their viewers private.</p>
          ) : viewers.length === 0 ? (
            <p className="text-sm text-gray-400">No views yet.</p>
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
      </div>
    </div>
  );
}
