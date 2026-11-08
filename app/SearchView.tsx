"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "./LanguageContext";

type SearchProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
};

type SearchPost = {
  id: number;
  user_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  profiles: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

type SearchTab = "people" | "posts";
type RequestState = "friends" | "outgoing" | "incoming" | "none";
const RECENT_SEARCHES_LIMIT = 6;
const PEOPLE_PAGE_SIZE = 30;

function getRecentSearches(userId: string): string[] {
  try {
    const stored = window.localStorage.getItem(`openvoice:recent-searches:${userId}`);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((term): term is string => typeof term === "string").slice(0, RECENT_SEARCHES_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export default function SearchView({
  userId,
  onOpenProfile,
}: {
  userId: string;
  onOpenProfile: (userId: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("people");
  const [profiles, setProfiles] = useState<SearchProfile[]>([]);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchedTerm, setSearchedTerm] = useState("");
  const [searchedTab, setSearchedTab] = useState<SearchTab>("people");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SearchProfile[]>([]);
  const [suggestionStates, setSuggestionStates] = useState<Record<string, RequestState>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsHasMore, setSuggestionsHasMore] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [friendBusy, setFriendBusy] = useState<string | null>(null);
  const [friendError, setFriendError] = useState("");
  const term = query.trim().replace(/[%_\\]/g, (character) => `\\${character}`);

  useEffect(() => {
    const timer = window.setTimeout(() => setRecentSearches(getRecentSearches(userId)), 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setSuggestionError("");
      try {
        const { data: requestData, error: requestError } = await supabase
          .from("friend_requests")
          .select("requester_id, addressee_id, status")
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
        if (requestError) throw new Error(requestError.message);

        const requestStates: Record<string, RequestState> = {};
        for (const request of requestData ?? []) {
          const otherUserId = request.requester_id === userId ? request.addressee_id : request.requester_id;
          if (request.status === "accepted") requestStates[otherUserId] = "friends";
          else if (request.status === "pending") {
            requestStates[otherUserId] = request.requester_id === userId ? "outgoing" : "incoming";
          }
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url, bio")
          .neq("id", userId)
          .order("display_name", { ascending: true, nullsFirst: false })
          .range(0, PEOPLE_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);

        if (!active) return;
        setSuggestions((data ?? []) as SearchProfile[]);
        setSuggestionsHasMore((data ?? []).length === PEOPLE_PAGE_SIZE);
        setSuggestionStates(requestStates);
        setSuggestionsLoading(false);
      } catch (error) {
        if (!active) return;
        setSuggestionError(error instanceof Error ? error.message : t("Could not load suggested people."));
        setSuggestionsLoading(false);
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId, t]);

  async function loadMorePeople() {
    if (suggestionsLoading || !suggestionsHasMore) return;
    setSuggestionsLoading(true);
    setSuggestionError("");
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, bio")
        .neq("id", userId)
        .order("display_name", { ascending: true, nullsFirst: false })
        .range(suggestions.length, suggestions.length + PEOPLE_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const nextProfiles = (data ?? []) as SearchProfile[];
      setSuggestions((current) => [...current, ...nextProfiles]);
      setSuggestionsHasMore(nextProfiles.length === PEOPLE_PAGE_SIZE);
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : t("Could not load suggested people."));
    } finally {
      setSuggestionsLoading(false);
    }
  }

  useEffect(() => {
    if (!term) return;

    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchedTerm(term);
      setSearchedTab(tab);
      setSearchError("");
      const pattern = `%${term}%`;
      try {
        if (tab === "people") {
          const [byName, byUsername] = await Promise.all([
            supabase.from("profiles")
              .select("id, display_name, username, avatar_url, bio")
              .ilike("display_name", pattern)
              .neq("id", userId)
              .limit(25),
            supabase.from("profiles")
              .select("id, display_name, username, avatar_url, bio")
              .ilike("username", pattern)
              .neq("id", userId)
              .limit(25),
          ]);
          if (byName.error) throw new Error(byName.error.message);
          if (byUsername.error) throw new Error(byUsername.error.message);
          const unique = new Map<string, SearchProfile>();
          for (const profile of [...(byName.data ?? []), ...(byUsername.data ?? [])] as SearchProfile[]) {
            unique.set(profile.id, profile);
          }
          if (active) setProfiles([...unique.values()].slice(0, 40));
        } else {
          const { data, error } = await supabase
            .from("posts")
            .select("id, user_id, content, image_url, created_at, profiles!posts_user_id_fkey(display_name, username, avatar_url)")
            .ilike("content", pattern)
            .order("created_at", { ascending: false })
            .limit(30);
          if (error) throw new Error(error.message);
          if (active) setPosts((data as unknown as SearchPost[]) ?? []);
        }
      } catch (error) {
        if (active) setSearchError(error instanceof Error ? error.message : t("Search failed. Please try again."));
      } finally {
        if (active) setSearching(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term, tab, userId, t]);

  function rememberSearch(searchTerm: string) {
    const normalized = searchTerm.trim();
    if (!normalized) return;
    const updated = [normalized, ...recentSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())]
      .slice(0, RECENT_SEARCHES_LIMIT);
    setRecentSearches(updated);
    try {
      window.localStorage.setItem(`openvoice:recent-searches:${userId}`, JSON.stringify(updated));
    } catch {
      // Recent searches are a convenience and remain usable for the current page view.
    }
  }

  function selectRecentSearch(searchTerm: string) {
    setQuery(searchTerm);
    rememberSearch(searchTerm);
  }

  async function addFriend(profileId: string) {
    if (friendBusy) return;
    setFriendBusy(profileId);
    setFriendError("");
    try {
      const { error } = await supabase.rpc("create_friend_request", { target_user: profileId });
      if (error) throw new Error(error.message);
      setSuggestionStates((current) => ({ ...current, [profileId]: "outgoing" }));
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : t("Could not send friend request."));
    } finally {
      setFriendBusy(null);
    }
  }

  const displayedResults = tab === "people" ? profiles.length > 0 : posts.length > 0;
  const currentSearchDone = !!term && term === searchedTerm && tab === searchedTab && !searching;

  return (
    <section className="space-y-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-4 text-white">
      <header>
        <h2 className="text-xl font-bold">{t("Search people and posts")}</h2>
        <p className="mt-1 text-sm text-gray-400">{t("Browse OpenVoice members or search by name, username, or post.")}</p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          rememberSearch(term);
        }}
        className="flex gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("Search people and posts")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search by name, username, or post...")}
            autoComplete="off"
            className="w-full rounded-full border border-[#444] bg-[#1c1c1c] px-4 py-3 text-white outline-none placeholder:text-gray-500 focus:border-[#f5b301]"
          />
        </label>
        <button type="submit" className="rounded-full bg-[#f5b301] px-4 font-bold text-black">{t("Search")}</button>
      </form>

      <div className="flex gap-2" role="tablist" aria-label={t("Search type")}>
        {(["people", "posts"] as const).map((searchTab) => (
          <button
            key={searchTab}
            type="button"
            role="tab"
            aria-selected={tab === searchTab}
            onClick={() => setTab(searchTab)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${
              tab === searchTab ? "border-[#f5b301] bg-[#f5b301] text-black" : "border-[#444] text-gray-300"
            }`}
          >
            {t(searchTab === "people" ? "People" : "Posts")}
          </button>
        ))}
      </div>

      {!term && recentSearches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("Recent searches")}</h3>
            <button
              type="button"
              onClick={() => {
                setRecentSearches([]);
                try {
                  window.localStorage.removeItem(`openvoice:recent-searches:${userId}`);
                } catch {
                  setFriendError(t("Could not clear recent searches."));
                }
              }}
              className="text-xs text-gray-400 underline"
            >
              {t("Clear")}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => selectRecentSearch(item)}
                className="rounded-full border border-[#444] px-3 py-1.5 text-sm text-gray-200 hover:border-[#f5b301]"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {!term && tab === "people" && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">{t("People on OpenVoice")}</h3>
          {suggestionsLoading && suggestions.length === 0 && <p className="text-sm text-gray-400">{t("Loading people...")}</p>}
          {suggestionError && <p role="alert" className="text-sm text-red-300">{suggestionError}</p>}
          {!suggestionsLoading && !suggestionError && suggestions.length === 0 && (
            <p className="text-sm text-gray-400">{t("No other members found.")}</p>
          )}
          {friendError && <p role="alert" className="text-sm text-red-300">{friendError}</p>}
          <div className="space-y-2">
            {suggestions.map((profile) => {
              const name = profile.display_name || profile.username || t("OpenVoice member");
              const requestState = suggestionStates[profile.id] ?? "none";
              return (
                <div key={profile.id} className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3">
                  <button type="button" onClick={() => onOpenProfile(profile.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <ProfileAvatar profile={profile} name={name} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{name}</span>
                      {profile.username && <span className="block truncate text-sm text-gray-400">@{profile.username}</span>}
                    </span>
                  </button>
                  {requestState === "none" && (
                    <button
                      type="button"
                      onClick={() => void addFriend(profile.id)}
                      disabled={friendBusy !== null}
                      className="shrink-0 rounded-full bg-[#f5b301] px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
                    >
                      {friendBusy === profile.id ? t("Please wait...") : t("Add friend")}
                    </button>
                  )}
                  {requestState === "outgoing" && <span className="shrink-0 text-xs text-gray-400">{t("Friend request sent")}</span>}
                  {requestState === "incoming" && (
                    <button type="button" onClick={() => onOpenProfile(profile.id)} className="shrink-0 text-xs text-[#f5b301]">
                      {t("Respond to request")}
                    </button>
                  )}
                  {requestState === "friends" && <span className="shrink-0 text-xs text-gray-400">{t("Friends")}</span>}
                </div>
              );
            })}
          </div>
          {suggestionsHasMore && (
            <button
              type="button"
              onClick={() => void loadMorePeople()}
              disabled={suggestionsLoading}
              className="w-full rounded-full border border-[#555] px-4 py-2 text-sm font-semibold text-white hover:border-[#f5b301] disabled:opacity-50"
            >
              {suggestionsLoading ? t("Loading people...") : t("Load more people")}
            </button>
          )}
        </section>
      )}

      {!term && tab === "posts" && (
        <p className="text-sm text-gray-400">{t("Search for a word or phrase to find posts.")}</p>
      )}

      {term && (term !== searchedTerm || searching) && (
        <p className="text-sm text-gray-400">{t("Searching...")}</p>
      )}
      {term && term === searchedTerm && tab === searchedTab && searchError && (
        <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{searchError}</p>
      )}
      {currentSearchDone && !searchError && !displayedResults && (
        <p className="text-sm text-gray-400">{t("No results found.")}</p>
      )}

      {tab === "people" && term === searchedTerm && tab === searchedTab && profiles.length > 0 && (
        <div className="space-y-2">
          {profiles.map((profile) => {
            const name = profile.display_name || profile.username || t("OpenVoice member");
            return (
              <button
                type="button"
                key={profile.id}
                onClick={() => onOpenProfile(profile.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3 text-left hover:border-[#f5b301]"
              >
                <ProfileAvatar profile={profile} name={name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{name}</span>
                  {profile.username && <span className="block truncate text-sm text-gray-400">@{profile.username}</span>}
                  {profile.bio && <span className="mt-1 line-clamp-2 block text-sm text-gray-400">{profile.bio}</span>}
                </span>
                <span className="shrink-0 text-sm text-[#f5b301]">{t("View profile")}</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === "posts" && term === searchedTerm && tab === searchedTab && posts.length > 0 && (
        <div className="space-y-2">
          {posts.map((post) => {
            const author = post.profiles?.display_name || post.profiles?.username || t("Anonymous");
            return (
              <article key={post.id} className="space-y-2 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3">
                <button type="button" onClick={() => onOpenProfile(post.user_id)} className="flex items-center gap-2 text-left">
                  <ProfileAvatar profile={post.profiles ?? { avatar_url: null }} name={author} />
                  <span>
                    <span className="block text-sm font-semibold">{author}</span>
                    <span className="block text-xs text-gray-500">{new Date(post.created_at).toLocaleDateString()}</span>
                  </span>
                </button>
                <p className="whitespace-pre-wrap break-words text-sm text-gray-200">{post.content}</p>
                {post.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.image_url} alt="" className="max-h-80 w-full rounded-lg object-cover" loading="lazy" />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProfileAvatar({ profile, name }: { profile: { avatar_url: string | null }; name: string }) {
  return profile.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={profile.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#333] text-lg font-bold">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
