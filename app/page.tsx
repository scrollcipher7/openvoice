"use client";
import { useCallback, useEffect, useState } from "react";
import { Anton } from "next/font/google";
import { supabase } from "@/lib/supabase";
import PostActions from "./PostActions";
import ProfileView from "./ProfileView";
import ReportButton from "./ReportButton";
import AdminPanel from "./AdminPanel";
import Welcome from "./Welcome";
import TopBar from "./TopBar";
import Composer from "./Composer";
import BottomBar from "./BottomBar";
import DatingView from "./DatingView";
import ReelsView from "./ReelsView";
import FriendsMessenger from "./FriendsMessenger";
import AlertsView from "./AlertsView";
import StoriesView from "./StoriesView";
import LiveView from "./LiveView";
import { useLanguage } from "./LanguageContext";
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
    avatar_url: string | null;
    is_admin: boolean | null;
  } | null;
};

type Tab = "home" | "reels" | "live" | "messages" | "dating" | "alerts" | "search" | "profile";

function isTab(value: string | null): value is Tab {
  return value === "home"
    || value === "reels"
    || value === "live"
    || value === "messages"
    || value === "dating"
    || value === "alerts"
    || value === "search"
    || value === "profile";
}

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

function ComingSoon({ title, text }: { title: string; text: string }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-8 text-center">
      <h2 className={`${anton.className} text-3xl uppercase tracking-wider`} style={{ color: GOLD }}>{t(title)}</h2>
      <p className="mt-2 text-gray-400">{t(text)}</p>
      <p className="mt-4 inline-block rounded px-3 py-1 text-xs uppercase tracking-widest text-white" style={{ background: RED }}>
        {t("Coming soon")}
      </p>
    </div>
  );
}

export default function Home() {
  const { language, t } = useLanguage();
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myName, setMyName] = useState("");
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "home";
    const savedTab = window.sessionStorage.getItem("openvoice-active-tab");
    return isTab(savedTab) ? savedTab : "home";
  });
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [returnTab, setReturnTab] = useState<Tab>("home");
  const [messageUserId, setMessageUserId] = useState<string | null>(null);
  const [pendingPostId, setPendingPostId] = useState<number | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [posting, setPosting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);
  const [liveCreateOpen, setLiveCreateOpen] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);

  async function loadPosts() {
    try {
      const { data, error } = await supabase
      .from("posts")
      .select("id, user_id, content, image_url, link_url, created_at, profiles!posts_user_id_fkey(username, display_name, avatar_url, is_admin)")
      .order("created_at", { ascending: false });
      if (error) {
        setMsg(`Could not load posts: ${error.message}`);
        return;
      }
      setPosts((data as unknown as Post[]) ?? []);
    } catch (error) {
      setMsg(error instanceof Error ? `Could not load posts: ${error.message}` : "Could not load posts.");
    }
  }

  async function loadMe(s: Session | null) {
    if (!s) {
      setIsAdmin(false);
      setMyName("");
      setMyAvatar(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("is_admin, display_name, username, avatar_url")
      .eq("id", s.user.id)
      .single();
    setIsAdmin(!!data?.is_admin);
    setMyName(data?.display_name || data?.username || "");
    setMyAvatar(data?.avatar_url ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadMe(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      loadMe(s);
      if (s) setMsg("");
    });
    loadPosts();
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadUnreadAlerts = useCallback(async () => {
    if (!session) {
      setUnreadAlerts(0);
      return;
    }
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) {
      setMsg(error.message);
      return;
    }
    setUnreadAlerts(count ?? 0);
  }, [session]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadUnreadAlerts(), 0);
    const timer = window.setInterval(() => void loadUnreadAlerts(), 15000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadUnreadAlerts]);

  useEffect(() => {
    if (tab !== "home" || pendingPostId === null) return;
    const postExists = posts.some((post) => post.id === pendingPostId);
    const timer = window.setTimeout(() => {
      if (!postExists) {
        setMsg(t("This post is no longer available."));
        setPendingPostId(null);
        return;
      }
      document.getElementById(`post-${pendingPostId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingPostId(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [pendingPostId, posts, tab, t]);

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "");
  }

  async function logIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "");
  }

  async function signInWithGoogle() {
    setMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setMsg(error.message);
  }

  async function createPost(): Promise<boolean> {
    if (!session || posting) return false;
    let link = linkUrl.trim();
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    if (link && !parseEmbed(link)) {
      setMsg("That link doesn't look valid.");
      return false;
    }
    if (!text.trim() && !link && !file) return false;
    if (file && !file.type.startsWith("image/")) {
      setMsg("Only image files can be uploaded.");
      return false;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setMsg("Image must be under 5 MB.");
      return false;
    }

    setPosting(true);
    setMsg("");
    try {
      let imageUrl: string | null = null;

      if (file) {
        const safeName = file.name.replace(/[^\w.-]/g, "_");
        const filePath = `${session.user.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("post-images").upload(filePath, file);
        if (upErr) {
          setMsg(upErr.message);
          return false;
        }
        imageUrl = supabase.storage.from("post-images").getPublicUrl(filePath).data.publicUrl;
      }

      const { error } = await supabase.from("posts").insert({
        user_id: session.user.id,
        content: text.trim(),
        image_url: imageUrl,
        link_url: link || null,
      });
      if (error) {
        setMsg(error.message);
        return false;
      }

      setText("");
      setLinkUrl("");
      setFile(null);
      setFileKey((k) => k + 1);
      loadPosts();
      return true;
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not create post.");
      return false;
    } finally {
      setPosting(false);
    }
  }

  async function deletePost(id: number) {
    const { error } = await supabase.from("posts").delete().eq("id", id);
    setMenuId(null);
    if (error) return setMsg(error.message);
    loadPosts();
  }

  function go(nextTab: Tab) {
    setTab(nextTab);
    window.sessionStorage.setItem("openvoice-active-tab", nextTab);
    setViewingId(null);
    setMenuId(null);
  }

  function openProfile(userId: string) {
    setReturnTab(tab);
    setViewingId(userId);
    setTab("profile");
    window.sessionStorage.setItem("openvoice-active-tab", "profile");
    setMenuId(null);
  }

  function openMessages(userId?: string) {
    setMessageUserId(userId ?? null);
    go("messages");
  }

  function openPost(postId: number) {
    setPendingPostId(postId);
    go("home");
  }

  const updateUnreadAlerts = useCallback((count: number) => {
    setUnreadAlerts(count);
  }, []);

  const initial = (myName || session?.user.email || "?").charAt(0).toUpperCase();

  if (!ready) return <div className="min-h-screen bg-[#0a0a0a]" />;
  if (!session) {
    return (
      <Welcome
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        msg={msg}
        onLogIn={logIn}
        onSignUp={signUp}
        onGoogleSignIn={signInWithGoogle}
      />
    );
  }

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] bg-cover bg-fixed bg-center pb-28 text-white"
      style={{
        backgroundImage:
          "linear-gradient(rgba(10,10,10,0.7), rgba(10,10,10,0.88)), url('/bg.png')",
      }}
    >
      <TopBar
        onCreatePost={() => {
          go("home");
          setStoryComposerOpen(false);
          setComposerOpen(true);
        }}
        onCreateReel={() => {
          setComposerOpen(false);
          setStoryComposerOpen(false);
          go("reels");
        }}
        onCreateStory={() => {
          setComposerOpen(false);
          go("home");
          setStoryComposerOpen(true);
        }}
        onCreateLive={() => {
          setComposerOpen(false);
          setStoryComposerOpen(false);
          go("live");
          setLiveCreateOpen(true);
        }}
        onSearch={() => go("search")}
        onMessages={() => openMessages()}
      />

      <main className="mx-auto max-w-xl space-y-3 p-3">
        {tab === "home" && (
          <>
            {msg && !composerOpen && <p className="text-sm text-red-500">{t(msg)}</p>}
            <StoriesView
              session={session}
              avatarUrl={myAvatar}
              createOpen={storyComposerOpen}
              onCreateHandled={() => setStoryComposerOpen(false)}
              onCreateStory={() => {
                setComposerOpen(false);
                setStoryComposerOpen(true);
              }}
            />
            <Composer
              avatarUrl={myAvatar}
              initial={initial}
              open={composerOpen}
              setOpen={setComposerOpen}
              text={text}
              setText={setText}
              linkUrl={linkUrl}
              setLinkUrl={setLinkUrl}
              setFile={setFile}
              fileKey={fileKey}
              posting={posting}
              msg={msg}
              onPost={createPost}
              onCreateLive={() => {
                go("live");
                setLiveCreateOpen(true);
              }}
            />

            {posts.map((p) => {
              const own = session.user.id === p.user_id;
              const name = p.profiles?.display_name || p.profiles?.username || t("Anonymous");
              return (
                <article id={`post-${p.id}`} key={p.id} className="space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
                  <div className="flex items-start justify-between">
                    <button onClick={() => openProfile(p.user_id)} className="flex items-center gap-3 text-left">
                      {p.profiles?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.profiles.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-black"
                          style={{ background: GOLD }}>
                          {name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold">
                          {name}
                          {p.profiles?.is_admin && (
                            <span className="ml-2 rounded px-2 py-0.5 text-xs text-white" style={{ background: RED }}>
                              ADMIN
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(p.created_at).toLocaleString(language === "es" ? "es-US" : "en-US")}</p>
                      </div>
                    </button>

                    <div className="relative">
                      <button
                        onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                        aria-label={t("More")}
                        className="px-2 text-xl leading-none text-gray-400 hover:text-white"
                      >
                        •••
                      </button>
                      {menuId === p.id && (
                        <div className="absolute right-0 z-10 mt-1 w-48 space-y-3 rounded border border-[#333] bg-[#1c1c1c] p-3">
                          {(isAdmin || own) && (
                            <button onClick={() => deletePost(p.id)} className="block text-sm text-red-500">
                              {t("Delete post")}
                            </button>
                          )}
                          {!own && <ReportButton postId={p.id} session={session} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {p.content && <p className="whitespace-pre-wrap break-words">{p.content}</p>}
                  {p.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="w-full rounded" />
                  )}
                  {p.link_url && <LinkPreview url={p.link_url} />}
                  <PostActions postId={p.id} session={session} isAdmin={isAdmin} />
                </article>
              );
            })}
          </>
        )}

        {tab === "reels" && <ReelsView session={session} isAdmin={isAdmin} />}
        {tab === "live" && (
          <LiveView
            session={session}
            myName={myName}
            createOpen={liveCreateOpen}
            onCreateHandled={() => setLiveCreateOpen(false)}
          />
        )}
        {tab === "messages" && (
          <FriendsMessenger
            session={session}
            initialUserId={messageUserId}
            onOpenProfile={openProfile}
          />
        )}
        {tab === "dating" && <DatingView session={session} onOpenProfile={openProfile} />}
        {tab === "alerts" && (
          <AlertsView
            onOpenProfile={openProfile}
            onOpenReportQueue={() => go("profile")}
            onOpenFeedback={() => go("profile")}
            onOpenMessages={openMessages}
            onOpenPost={openPost}
            onUnreadCount={updateUnreadAlerts}
          />
        )}
        {tab === "search" && <ComingSoon title="Search" text="Find people and posts." />}

        {tab === "profile" && (session || viewingId) && (
          <ProfileView
            key={viewingId ?? "me"}
            profileId={viewingId ?? session.user.id}
            session={session}
            onBack={viewingId ? () => go(returnTab) : undefined}
            onMessage={openMessages}
          />
        )}
        {tab === "profile" && (
          <>
            {isAdmin && !viewingId && (
              <AdminPanel isAdmin={isAdmin} onMessageReportedProfile={openMessages} />
            )}
            {!viewingId && (
              <button
                onClick={() => supabase.auth.signOut()}
                className={anton.className + " w-full rounded border border-[#555] py-3 uppercase tracking-wider"}
              >
                {t("Log out")}
              </button>
            )}
          </>
        )}
      </main>

      <BottomBar
        tab={tab === "messages" || tab === "search" ? "" : tab}
        onSelect={(id) => go(id as Tab)}
        avatarUrl={myAvatar}
        initial={initial}
        alertCount={unreadAlerts}
      />
    </div>
  );
}