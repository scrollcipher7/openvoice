"use client";
import { useEffect, useState } from "react";
import { Anton } from "next/font/google";
import { supabase } from "@/lib/supabase";
import PostActions from "./PostActions";
import ProfileView from "./ProfileView";
import ReportButton from "./ReportButton";
import AdminPanel from "./AdminPanel";
import type { Session } from "@supabase/supabase-js";

const anton = Anton({ subsets: ["latin"], weight: "400" });

const GOLD = "#f5b301";
const RED = "#d7261e";

type Post = {
  id: number;
  user_id: string;
  content: string;
  image_url: string | null;
  link_url: string | null;
  created_at: string;
  profiles: {
    username: string | null;
    display_name: string | null;
    is_admin: boolean | null;
  } | null;
};

type Tab = "home" | "reels" | "messages" | "dating" | "profile";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "reels", label: "Reels", icon: "🎬" },
  { id: "messages", label: "Messages", icon: "💬" },
  { id: "dating", label: "Dating", icon: "🔥" },
  { id: "profile", label: "Profile", icon: "👤" },
];

type Embed =
  | { kind: "iframe"; src: string; height: number }
  | { kind: "link"; href: string; host: string };

function parseEmbed(raw: string): Embed | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;

  if (host === "youtu.be") {
    const id = path.slice(1);
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}`, height: 315 };
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = u.searchParams.get("v") || path.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}`, height: 315 };
  }
  if (host === "open.spotify.com") {
    const m = path.match(/\/(track|album|playlist|episode|show|artist)\/(\w+)/);
    if (m) {
      const small = m[1] === "track" || m[1] === "episode";
      return { kind: "iframe", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: small ? 152 : 352 };
    }
  }
  if (host === "soundcloud.com") {
    return { kind: "iframe", src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(raw)}`, height: 166 };
  }
  if (host === "vimeo.com") {
    const id = path.match(/^\/(\d+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}`, height: 315 };
  }
  if (host === "music.apple.com") {
    return { kind: "iframe", src: `https://embed.music.apple.com${path}${u.search}`, height: 175 };
  }
  if (host === "tiktok.com") {
    const id = path.match(/\/video\/(\d+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.tiktok.com/embed/v2/${id}`, height: 740 };
  }
  return { kind: "link", href: raw, host };
}

function LinkPreview({ url }: { url: string }) {
  const e = parseEmbed(url);
  if (!e) return null;
  if (e.kind === "iframe") {
    return (
      <iframe
        src={e.src}
        height={e.height}
        className="w-full rounded border-0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    );
  }
  return (
    <a href={e.href} target="_blank" rel="noopener noreferrer"
      className="block rounded border border-[#333] bg-[#1c1c1c] p-3 hover:border-[#f5b301]">
      <p className="text-xs uppercase tracking-wide text-gray-400">{e.host}</p>
      <p className="break-all" style={{ color: GOLD }}>{e.href}</p>
    </a>
  );
}

function LogoMark({ size = 36 }: { size?: number }) {
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

function Logo({ big = false }: { big?: boolean }) {
  const textSize = big ? "text-4xl" : "text-2xl";
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={big ? 52 : 36} />
      <span className={anton.className + " uppercase leading-none tracking-wider " + textSize}>
        Open<span style={{ color: GOLD }}>Voice</span>
      </span>
    </div>
  );
}

const inputCls =
  "w-full rounded bg-[#1c1c1c] border border-[#333] p-2 text-white placeholder-gray-500 outline-none focus:border-[#f5b301]";

function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-8 text-center">
      <h2 className={`${anton.className} text-3xl uppercase tracking-wider`} style={{ color: GOLD }}>{title}</h2>
      <p className="mt-2 text-gray-400">{text}</p>
      <p className="mt-4 inline-block rounded px-3 py-1 text-xs uppercase tracking-widest text-white" style={{ background: RED }}>
        Coming soon
      </p>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myName, setMyName] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [posting, setPosting] = useState(false);

  async function loadPosts() {
    const { data } = await supabase
      .from("posts")
      .select("id, user_id, content, image_url, link_url, created_at, profiles(username, display_name, is_admin)")
      .order("created_at", { ascending: false });
    setPosts((data as unknown as Post[]) ?? []);
  }

  async function loadMe(s: Session | null) {
    if (!s) {
      setIsAdmin(false);
      setMyName("");
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("is_admin, display_name, username")
      .eq("id", s.user.id)
      .single();
    setIsAdmin(!!data?.is_admin);
    setMyName(data?.display_name || data?.username || "");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadMe(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      loadMe(s);
      if (s) setMsg("");
    });
    loadPosts();
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "");
  }

  async function logIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "");
  }

  async function createPost() {
    if (!session || posting) return;
    let link = linkUrl.trim();
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    if (link && !parseEmbed(link)) return setMsg("That link doesn't look valid.");
    if (!text.trim() && !link && !file) return;
    if (file && !file.type.startsWith("image/")) return setMsg("Only image files can be uploaded.");
    if (file && file.size > 5 * 1024 * 1024) return setMsg("Image must be under 5 MB.");

    setPosting(true);
    setMsg("");
    let imageUrl: string | null = null;

    if (file) {
      const safeName = file.name.replace(/[^\w.-]/g, "_");
      const filePath = `${session.user.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("post-images").upload(filePath, file);
      if (upErr) {
        setPosting(false);
        return setMsg(upErr.message);
      }
      imageUrl = supabase.storage.from("post-images").getPublicUrl(filePath).data.publicUrl;
    }

    const { error } = await supabase.from("posts").insert({
      user_id: session.user.id,
      content: text.trim(),
      image_url: imageUrl,
      link_url: link || null,
    });
    setPosting(false);
    if (error) return setMsg(error.message);
    setText("");
    setLinkUrl("");
    setFile(null);
    setFileKey((k) => k + 1);
    loadPosts();
  }

  async function deletePost(id: number) {
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) return setMsg(error.message);
    loadPosts();
  }

  const initial = (myName || session?.user.email || "?").charAt(0).toUpperCase();

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] bg-cover bg-fixed bg-center pb-24 text-white md:pb-8"
      style={{
        backgroundImage:
          "linear-gradient(rgba(10,10,10,0.7), rgba(10,10,10,0.88)), url('/bg.png')",
      }}
    >
      <header className="sticky top-0 z-20 border-b border-[#2a2a2a] bg-[#0a0a0a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); setViewingId(null); }}
                className={`${anton.className} rounded px-3 py-2 text-sm uppercase tracking-wider ${
                  tab === t.id ? "text-black" : "text-gray-300 hover:bg-[#1c1c1c]"
                }`}
                style={tab === t.id ? { background: GOLD } : undefined}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-black"
            style={{ background: session ? GOLD : "#333" }}>
            {session ? initial : "?"}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 p-4">
        {tab === "home" && (
          <>
            {!session ? (
              <div className="space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414] p-5">
                <Logo big />
                <p className={`${anton.className} text-xl uppercase tracking-wide`} style={{ color: RED }}>
                  Speak your truth. No censors.
                </p>
                <input className={inputCls} placeholder="Email" value={email}
                  onChange={(e) => setEmail(e.target.value)} />
                <input className={inputCls} placeholder="Password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={logIn}
                    className={`${anton.className} rounded px-5 py-2 uppercase tracking-wider text-black`}
                    style={{ background: GOLD }}>Log in</button>
                  <button onClick={signUp}
                    className={`${anton.className} rounded border border-[#555] px-5 py-2 uppercase tracking-wider`}>
                    Sign up</button>
                </div>
                {msg && <p className="text-sm text-red-500">{msg}</p>}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
                <textarea className={inputCls} rows={3} placeholder="What's on your mind?"
                  value={text} onChange={(e) => setText(e.target.value)} />
                <input className={inputCls}
                  placeholder="Paste a link (YouTube, Spotify, SoundCloud, TikTok, Amazon Music...)"
                  value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                <input key={fileKey} type="file" accept="image/*" className="text-sm text-gray-400"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div>
                  <button onClick={createPost} disabled={posting}
                    className={`${anton.className} rounded px-6 py-2 uppercase tracking-wider text-black disabled:opacity-50`}
                    style={{ background: GOLD }}>
                    {posting ? "Posting..." : "Post"}
                  </button>
                </div>
                {msg && <p className="text-sm text-red-500">{msg}</p>}
              </div>
            )}

            {posts.map((p) => (
              <article key={p.id} className="space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-black"
                      style={{ background: GOLD }}>
                      {(p.profiles?.display_name || p.profiles?.username || "A").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold">
                        <button
                          onClick={() => { setViewingId(p.user_id); setTab("profile"); }}
                          className="hover:underline"
                        >
                          {p.profiles?.display_name || p.profiles?.username || "Anonymous"}
                        </button>
                        {p.profiles?.is_admin && (
                          <span className="ml-2 rounded px-2 py-0.5 text-xs text-white" style={{ background: RED }}>ADMIN</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{new Date(p.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  {session && (isAdmin || session.user.id === p.user_id) && (
                    <button onClick={() => deletePost(p.id)} className="text-sm text-red-500">Delete</button>
                  )}
                </div>
                {p.content && <p className="whitespace-pre-wrap break-words">{p.content}</p>}
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className="w-full rounded" />
                )}
                {p.link_url && <LinkPreview url={p.link_url} />}
                <PostActions postId={p.id} session={session} isAdmin={isAdmin} />
                {session && session.user.id !== p.user_id && <ReportButton postId={p.id} session={session} />}
              </article>
            ))}
          </>
        )}

        {tab === "reels" && <ComingSoon title="Reels" text="Short videos from the streets." />}
        {tab === "messages" && <ComingSoon title="Messages" text="Talk straight, one on one." />}
        {tab === "dating" && <ComingSoon title="Dating" text="Real people only. 18+ and verified." />}

        {tab === "profile" && (session || viewingId) && (
          <ProfileView
            key={viewingId ?? "me"}
            profileId={(viewingId ?? session?.user.id) as string}
            session={session}
            onBack={viewingId ? () => { setViewingId(null); setTab("home"); } : undefined}
          />
        )}
        {tab === "profile" && session && isAdmin && !viewingId && (
          <AdminPanel isAdmin={isAdmin} />
        )}
        {tab === "profile" && !session && !viewingId && (
          <div className="space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414] p-6 text-center">
            <p className="text-gray-400">Log in from the Home tab to see your profile.</p>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 grid grid-cols-5 border-t border-[#2a2a2a] bg-[#0a0a0a] pb-2 md:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setViewingId(null); }}
            className={`${anton.className} flex flex-col items-center gap-1 py-2 text-[11px] uppercase tracking-wider ${
              tab === t.id ? "" : "text-gray-400"
            }`}
            style={tab === t.id ? { color: GOLD } : undefined}>
            <span className="text-xl">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}