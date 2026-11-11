"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "./LanguageContext";

type LiveStream = {
  id: string;
  host_id: string;
  title: string;
  status: "live" | "ended";
  created_at: string;
  profiles: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

type LiveMessage = {
  id: string;
  live_id: string;
  user_id: string;
  content: string;
  created_at: string;
  display_name: string;
};

type GuestRequest = {
  id: string;
  user_id: string;
  status: "pending" | "approved" | "denied" | "left";
  created_at: string;
  profiles: { display_name: string | null; username: string | null } | null;
};

type Participant = {
  user_id: string;
  role: "host" | "guest" | "viewer";
  name: string;
};

type Signal =
  | { kind: "offer"; fromId: string; toId: string; description: RTCSessionDescriptionInit }
  | { kind: "answer"; fromId: string; toId: string; description: RTCSessionDescriptionInit }
  | { kind: "candidate"; fromId: string; toId: string; candidate: RTCIceCandidateInit };

type PeerState = { peer: RTCPeerConnection; role: Participant["role"] };
type RemoteVideo = { userId: string; name: string; role: Participant["role"]; stream: MediaStream };
type Layout = "panel" | "grid";
type RoomRole = "host" | "viewer" | "guest";

const GOLD = "#f5b301";
const LIVE_TOPIC = "openvoice-live:";
const MAX_LIVE_VIEWERS = 5;

function nameFor(stream: LiveStream) {
  return stream.profiles?.display_name || stream.profiles?.username || "OpenVoice member";
}

function LiveVideo({ stream, muted = false, className }: { stream: MediaStream; muted?: boolean; className: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLVideoElement>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    const startPlayback = () => {
      const tracks = stream.getTracks();
      console.log("[Live] LiveVideo play tracks:", tracks.map((tr) => `${tr.kind} enabled=${tr.enabled}`), "muted=", muted);
      // Start muted to bypass autoplay policy, then unmute if requested
      video.muted = true;
      void video.play().then(() => {
        if (!active) return;
        if (!muted) {
          video.muted = false;
          console.log("[Live] LiveVideo unmuted after play");
        }
        setPlaybackBlocked(false);
      }).catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        console.warn("[Live] LiveVideo play failed:", cause);
        setPlaybackBlocked(true);
      });
    };
    video.srcObject = stream;
    video.onloadedmetadata = startPlayback;
    startPlayback();
    return () => {
      active = false;
      video.onloadedmetadata = null;
      video.pause();
      video.srcObject = null;
    };
  }, [stream, muted]);

  return (
    <>
      <video ref={ref} autoPlay playsInline controls muted={muted} className={className} />
      {playbackBlocked && (
        <button
          type="button"
          onClick={() => {
            const video = ref.current;
            if (!video) return;
            void video.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/70 p-3 text-center text-sm text-white"
        >
          {t("Video is ready. Tap to show video.")}
        </button>
      )}
    </>
  );
}

function VideoTile({
  stream,
  name,
  muted = false,
  className,
}: {
  stream: MediaStream;
  name: string;
  muted?: boolean;
  className: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className}`}>
      <LiveVideo stream={stream} muted={muted} className="h-full w-full object-cover" />
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs">{name}</span>
    </div>
  );
}

function LiveRoom({
  live,
  session,
  myName,
  initialRole,
  initialStream,
  onClose,
}: {
  live: LiveStream;
  session: Session;
  myName: string;
  initialRole: RoomRole;
  initialStream: MediaStream | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [role, setRole] = useState<RoomRole>(initialRole);
  const [localStream, setLocalStream] = useState<MediaStream | null>(initialStream);
  const [remotes, setRemotes] = useState<RemoteVideo[]>([]);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingGuests, setPendingGuests] = useState<GuestRequest[]>([]);
  const [guestRequestId, setGuestRequestId] = useState<string | null>(null);
  const [guestRequestStatus, setGuestRequestStatus] = useState("");
  const [layout, setLayout] = useState<Layout>("panel");
  const [viewerCount, setViewerCount] = useState(0);
  const [cameraStopped, setCameraStopped] = useState(false);
  const [restartingCamera, setRestartingCamera] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const roleRef = useRef<RoomRole>(initialRole);
  const localStreamRef = useRef<MediaStream | null>(initialStream);
  const participantsRef = useRef(new Map<string, Participant>());
  const peersRef = useRef(new Map<string, PeerState>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const sessionIdRef = useRef(session.user.id);
  const myNameRef = useRef(myName);
  const tRef = useRef(t);

  const setRoomRole = useCallback((next: RoomRole) => {
    roleRef.current = next;
    setRole(next);
  }, []);

  const setRoomStream = useCallback((next: MediaStream | null) => {
    localStreamRef.current = next;
    setLocalStream(next);
  }, []);

  // Keep refs in sync so the main WebRTC effect doesn't need volatile deps
  useEffect(() => { sessionIdRef.current = session.user.id; }, [session.user.id]);
  useEffect(() => { myNameRef.current = myName; }, [myName]);
  useEffect(() => { tRef.current = t; }, [t]);

  // Sync local stream when the parent prop changes (e.g., host camera starts after mount)
  useEffect(() => {
    if (initialStream) {
      localStreamRef.current = initialStream;
      setLocalStream(initialStream);
    }
  }, [initialStream]);

  // When the local stream becomes available after peers are already created,
  // add the tracks to existing peers and re-negotiate
  useEffect(() => {
    if (!localStream || role === "viewer") return;
    const peers = peersRef.current;
    if (peers.size === 0) return;
    for (const [userId, { peer }] of peers) {
      // Replace senders with the new stream's tracks
      for (const track of localStream.getTracks()) {
        const sender = peer.getSenders?.().find((s) => s.track?.kind === track.kind);
        if (sender) {
          void sender.replaceTrack(track);
        } else {
          peer.addTrack(track, localStream);
        }
      }
      // Re-negotiate to let the remote side know about the tracks
      void peer.createOffer().then((offer) => {
        return peer.setLocalDescription(offer).then(() => {
          // Send the new offer via the channel
          const channel = channelRef.current;
          if (!channel) return;
          return channel.send({
            type: "broadcast",
            event: "signal",
            payload: { kind: "offer", fromId: sessionIdRef.current, toId: userId, description: offer },
          });
        });
      }).catch(() => {});
    }
  }, [localStream, role]);

  const loadGuestRequests = useCallback(async () => {
    if (roleRef.current !== "host") return;
    const { data, error: resultError } = await supabase
      .from("live_guest_requests")
      .select("id, user_id, status, created_at, profiles!live_guest_requests_user_id_fkey(display_name, username)")
      .eq("live_id", live.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (resultError) {
      setError(resultError.message);
      return;
    }
    setPendingGuests((data ?? []) as unknown as GuestRequest[]);
  }, [live.id]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const peerMap = peersRef.current;
    const pendingCandidatesMap = new Map<string, RTCIceCandidateInit[]>();

    const t = tRef.current;
    const myId = sessionIdRef.current;
    const myNameVal = myNameRef.current;

    function broadcastSignal(payload: { kind: string; fromId: string; toId?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
      if (!channel) throw new Error(t("The Live connection is not ready yet."));
      return channel.send({ type: "broadcast", event: "signal", payload }).then((result) => {
        if (result !== "ok") throw new Error(t("Could not send Live connection data."));
      });
    }

    function closePeer(userId: string) {
      const current = peerMap.get(userId);
      if (current) {
        current.peer.close();
        peerMap.delete(userId);
      }
      pendingCandidatesMap.delete(userId);
      setRemotes((items) => items.filter((item) => item.userId !== userId));
    }

    function buildPeer(remoteUserId: string): RTCPeerConnection {
      console.log("[Live] buildPeer for", remoteUserId.slice(0, 6), "myRole=", roleRef.current, "iceServers=", iceServersRef.current.length);
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current, iceTransportPolicy: "all" });
      const stream = localStreamRef.current;
      if (stream && roleRef.current !== "viewer") {
        console.log("[Live] adding tracks:", stream.getTracks().map((tr) => tr.kind));
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      } else {
        console.log("[Live] no outgoing stream, stream=", !!stream, "role=", roleRef.current);
      }
      peerMap.set(remoteUserId, { peer: pc, role: "viewer" });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          void broadcastSignal({ kind: "candidate", fromId: myId, toId: remoteUserId, candidate: e.candidate.toJSON() }).catch((c) => {
            if (active) setError(c instanceof Error ? c.message : t("Could not send Live connection data."));
          });
        }
      };

      pc.ontrack = (e) => {
        console.log("[Live] *** ontrack *** from=", remoteUserId.slice(0, 6), "streams=", e.streams.length);
        const s = e.streams[0];
        if (!s) return;
        const tracks = s.getTracks();
        console.log("[Live] ontrack tracks:", tracks.map((tr) => `${tr.kind} enabled=${tr.enabled} muted=${tr.muted} readyState=${tr.readyState}`));
        const p = participantsRef.current.get(remoteUserId) ?? { user_id: remoteUserId, role: "host", name: "Remote" };
        setRemotes((items) => [
          ...items.filter((it) => it.userId !== remoteUserId),
          { userId: remoteUserId, name: p.name, role: p.role, stream: s },
        ]);
      };

      pc.onconnectionstatechange = () => {
        console.log("[Live] state:", pc.connectionState, "to=", remoteUserId.slice(0, 6));
        if (pc.connectionState === "failed" && active) {
          setError(t("A Live video connection failed. Check your connection."));
          closePeer(remoteUserId);
        }
      };

      return pc;
    }

    async function connect() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError) throw new Error(authError.message);
        if (!authData.session) throw new Error(t("Sign in again before joining a Live."));

        // Fetch TURN credentials
        let turnOk = false;
        try {
          console.log("[Live] fetching TURN credentials");
          const response = await fetch("/api/dating/turn-credentials", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authData.session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ targetLiveId: live.id }),
          });
          console.log("[Live] TURN response:", response.status);
          const result = await response.json() as { iceServers?: RTCIceServer[]; error?: string };
          if (response.ok && result.iceServers?.length) {
            iceServersRef.current = result.iceServers;
            turnOk = true;
            console.log("[Live] TURN configured:", result.iceServers.length);
          } else {
            console.warn("[Live] TURN not available:", result.error);
          }
        } catch (cause) {
          console.warn("[Live] TURN fetch error:", cause);
        }
        if (!active) return;
        if (!turnOk) {
          iceServersRef.current = [{ urls: "stun:stun.l.google.com:19302" }];
          console.log("[Live] using STUN fallback");
        }

        // Create Supabase channel
        channel = supabase.channel(`${LIVE_TOPIC}${live.id}`, {
          config: { private: true, broadcast: { self: false }, presence: { key: myId } },
        });
        channelRef.current = channel;

        // Handle incoming WebRTC signals
        channel.on("broadcast", { event: "signal" }, ({ payload }) => {
          if (!payload || typeof payload !== "object") return;
          const sig = payload as { kind?: string; fromId?: string; toId?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          if (!sig.kind || !sig.fromId) return;
          if (sig.fromId === myId) return; // skip own
          console.log("[Live] signal:", sig.kind, "from=", sig.fromId?.slice(0, 6));
          void handleIncomingSignal(sig as { kind: string; fromId: string; toId?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit });
        });

        // Handle chat messages
        channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
          const message = (payload as { message?: LiveMessage } | null)?.message;
          if (!message?.id || message.live_id !== live.id) return;
          setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message].slice(-100));
        });

        // Handle presence sync — just track viewer count
        channel.on("presence", { event: "sync" }, () => {
          if (!channel || !active) return;
          const states = channel.presenceState<Participant>();
          const next = new Map<string, Participant>();
          for (const entries of Object.values(states)) {
            for (const entry of entries) {
              if (entry.user_id && entry.role && entry.name) next.set(entry.user_id, entry);
            }
          }
          participantsRef.current = next;
          const listed = [...next.values()];
          console.log("[Live] presence:", listed.map((p) => `${p.user_id.slice(0, 6)} (${p.role})`));
          setViewerCount(listed.filter((p) => p.role === "viewer").length);
        });

        async function handleIncomingSignal(sig: { kind: string; fromId: string; toId?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
          if (!active) return;
          const remoteId = sig.fromId;
          let pc = peerMap.get(remoteId)?.peer;

          if (!pc) {
            // For viewers: any offer means the host is sending video — accept it
            // For hosts: any answer/candidate from a viewer — handle it
            if (sig.kind === "offer" && roleRef.current === "viewer") {
              pc = buildPeer(remoteId);
              // Add recvonly transceivers before setRemoteDescription
              pc.addTransceiver("video", { direction: "recvonly" });
              pc.addTransceiver("audio", { direction: "recvonly" });
            } else if (sig.kind === "request-offer" && roleRef.current === "host") {
              // A viewer wants video — create peer and send offer
              pc = buildPeer(remoteId);
              participantsRef.current.set(remoteId, { user_id: remoteId, role: "viewer", name: "Viewer" });
            } else {
              // answer/candidate for existing peer
              if (!pc) return;
            }
          }

          try {
            if (sig.kind === "offer" && roleRef.current === "viewer") {
              console.log("[Live] accepting offer from", remoteId.slice(0, 6));
              await pc!.setRemoteDescription(sig.description!);
              for (const c of pendingCandidatesMap.get(remoteId) ?? []) await pc!.addIceCandidate(c);
              pendingCandidatesMap.delete(remoteId);
              const answer = await pc!.createAnswer();
              console.log("[Live] answer SDP video:", answer.sdp?.includes("m=video"), "audio:", answer.sdp?.includes("m=audio"));
              await pc!.setLocalDescription(answer);
              await broadcastSignal({ kind: "answer", fromId: myId, toId: remoteId, description: answer });
              console.log("[Live] answer sent");
            } else if (sig.kind === "answer" && roleRef.current !== "viewer") {
              console.log("[Live] got answer from", remoteId.slice(0, 6));
              await pc.setRemoteDescription(sig.description!);
              for (const c of pendingCandidatesMap.get(remoteId) ?? []) await pc.addIceCandidate(c);
              pendingCandidatesMap.delete(remoteId);
            } else if (sig.kind === "candidate") {
              if (pc.remoteDescription) {
                await pc.addIceCandidate(sig.candidate!);
              } else {
                pendingCandidatesMap.set(remoteId, [...(pendingCandidatesMap.get(remoteId) ?? []), sig.candidate!]);
              }
            } else if (sig.kind === "request-offer" && roleRef.current === "host") {
              console.log("[Live] sending offer to", remoteId.slice(0, 6));
              const offer = await pc!.createOffer();
              console.log("[Live] offer SDP video:", offer.sdp?.includes("m=video"), "audio:", offer.sdp?.includes("m=audio"), "senders:", pc!.getSenders().map((s) => s.track?.kind));
              await pc!.setLocalDescription(offer);
              await broadcastSignal({ kind: "offer", fromId: myId, toId: remoteId, description: offer });
              console.log("[Live] offer sent");
            }
          } catch (cause) {
            console.error("[Live] signal error:", cause);
            if (active) setError(cause instanceof Error ? cause.message : t("Could not connect to this Live."));
          }
        }

        channel.subscribe(async (status) => {
          console.log("[Live] subscribe:", status);
          if (!active) return;
          if (status === "SUBSCRIBED") {
            await channel?.track({
              user_id: myId,
              role: roleRef.current,
              name: myNameVal || t("OpenVoice member"),
            });
            setLoading(false);

            // If viewer: request an offer from the host
            if (roleRef.current === "viewer") {
              console.log("[Live] viewer requesting offer");
              const states = channel!.presenceState<Participant>();
              let hostId: string | null = null;
              for (const entries of Object.values(states)) {
                for (const entry of entries) {
                  if (entry.role === "host") hostId = entry.user_id;
                }
              }
              if (hostId) {
                console.log("[Live] found host:", hostId.slice(0, 6));
                participantsRef.current.set(hostId, { user_id: hostId, role: "host", name: "Host" });
                await broadcastSignal({ kind: "request-offer", fromId: myId, toId: hostId }).catch((c) => {
                  console.error("[Live] request-offer failed:", c);
                  if (active) setError(t("Could not request video from host."));
                });
              } else {
                console.warn("[Live] no host found in presence, will retry");
              }

              // Retry requesting offer every 3s if no peer connecting yet
              let retryCount = 0;
              const retryInterval = window.setInterval(() => {
                if (!active) { window.clearInterval(retryInterval); return; }
                const hasPeer = [...peerMap.values()].some(({ peer }) => peer.connectionState === "connected" || peer.connectionState === "connecting");
                if (hasPeer) { window.clearInterval(retryInterval); return; }
                retryCount++;
                if (retryCount > 10) {
                  window.clearInterval(retryInterval);
                  if (active) setError(t("Could not connect to the host video. Try refreshing."));
                  return;
                }
                console.log("[Live] retry request-offer (", retryCount, ")");
                const st = channel?.presenceState<Participant>();
                let hId: string | null = null;
                if (st) {
                  for (const entries of Object.values(st)) {
                    for (const entry of entries) {
                      if (entry.role === "host") hId = entry.user_id;
                    }
                  }
                }
                if (hId) void broadcastSignal({ kind: "request-offer", fromId: myId, toId: hId }).catch(() => {});
              }, 3000);
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setLoading(false);
            setError(t("Could not join this Live. Check the Supabase Realtime settings and migrations."));
          }
        });

        // Load chat history
        const { data: priorMessages, error: messagesError } = await supabase
          .from("live_chat_messages")
          .select("id, live_id, user_id, content, created_at, profiles!live_chat_messages_user_id_fkey(display_name, username)")
          .eq("live_id", live.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (!messagesError && active) {
          const list = (priorMessages ?? []).reverse().map((row) => {
            const item = row as unknown as {
              id: string; live_id: string; user_id: string; content: string; created_at: string;
              profiles: { display_name: string | null; username: string | null } | null;
            };
            return { ...item, display_name: item.profiles?.display_name || item.profiles?.username || t("OpenVoice member") };
          });
          setMessages(list);
        }
      } catch (cause) {
        if (active) {
          setLoading(false);
          setError(cause instanceof Error ? t(cause.message) : t("Could not join this Live."));
        }
      }
    }

    void connect();
    return () => {
      active = false;
      void channel?.untrack();
      if (channel) void supabase.removeChannel(channel);
      channelRef.current = null;
      peerMap.forEach(({ peer }) => peer.close());
      peerMap.clear();
    };
  }, [live.id]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.track({
      user_id: session.user.id,
      role,
      name: myName || t("OpenVoice member"),
    }).then((result) => {
      if (result !== "ok") setError(t("Live presence could not be updated."));
    });
  }, [localStream, myName, role, session.user.id, t]);

  useEffect(() => {
    if (role !== "host") return;
    void loadGuestRequests();
    const timer = window.setInterval(() => void loadGuestRequests(), 3000);
    return () => window.clearInterval(timer);
  }, [loadGuestRequests, role]);

  useEffect(() => {
    if (!guestRequestId || role !== "viewer") return;
    let active = true;
    let starting = false;
    const check = async () => {
      const { data, error: queryError } = await supabase
        .from("live_guest_requests")
        .select("status")
        .eq("id", guestRequestId)
        .maybeSingle();
      if (queryError) {
        setError(queryError.message);
        return;
      }
      if (!active || !data) return;
      if (data.status === "denied" || data.status === "left") {
        setGuestRequestStatus(t("Your request to join was not approved."));
        setGuestRequestId(null);
      } else if (data.status === "approved" && !starting) {
        starting = true;
        try {
          const { error: joinError } = await supabase.rpc("join_live_guest", { target_live: live.id });
          if (joinError) throw new Error(joinError.message);
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          setRoomStream(stream);
          setRoomRole("guest");
          setGuestRequestStatus(t("You joined the Live as a guest."));
        } catch (cause) {
          setError(cause instanceof Error ? t(cause.message) : t("Could not join as a guest."));
          const { error: leaveError } = await supabase.rpc("leave_live_guest", { target_live: live.id });
          if (leaveError) setError(`${cause instanceof Error ? t(cause.message) : t("Could not join as a guest.")} ${leaveError.message}`);
          starting = false;
          setGuestRequestId(null);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [guestRequestId, live.id, role, setRoomRole, setRoomStream, t]);

  useEffect(() => {
    if (role === "viewer" || !localStream) {
      setCameraStopped(false);
      return;
    }
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
      setCameraStopped(true);
      return;
    }
    const updateCameraState = () => setCameraStopped(videoTrack.readyState === "ended");
    updateCameraState();
    videoTrack.addEventListener("ended", updateCameraState);
    return () => videoTrack.removeEventListener("ended", updateCameraState);
  }, [localStream, role]);

  useEffect(() => {
    if (role !== "viewer" && role !== "guest") return;
    const timer = window.setInterval(() => {
      const fn = role === "guest" ? "heartbeat_live_guest" : "heartbeat_live_viewer";
      void supabase.rpc(fn, { target_live: live.id }).then(({ error: heartbeatError }) => {
        if (heartbeatError) setError(heartbeatError.message);
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [live.id, role]);

  async function sendChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: insertError } = await supabase.from("live_chat_messages")
        .insert({ live_id: live.id, user_id: session.user.id, content })
        .select("id, live_id, user_id, content, created_at")
        .single();
      if (insertError) throw new Error(insertError.message);
      const message: LiveMessage = { ...data, display_name: myName || t("OpenVoice member") };
      const broadcastResult = await channelRef.current?.send({
        type: "broadcast",
        event: "chat-message",
        payload: { message },
      });
      if (broadcastResult !== "ok") throw new Error(t("The Live chat is not connected."));
      setMessages((items) => [...items, message].slice(-100));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("Could not send the Live message."));
    } finally {
      setBusy(false);
    }
  }

  async function requestToJoin() {
    if (busy || guestRequestId) return;
    setBusy(true);
    setError("");
    try {
      // Check if there's already a pending request
      const { data: existing } = await supabase
        .from("live_guest_requests")
        .select("id, status")
        .eq("live_id", live.id)
        .eq("user_id", session.user.id)
        .in("status", ["pending", "approved"])
        .maybeSingle();
      if (existing) {
        setGuestRequestId(existing.id);
        setGuestRequestStatus(existing.status === "approved"
          ? t("You have been approved. Waiting to join...")
          : t("Request sent. Waiting for the host."));
        return;
      }
      const { data, error: requestError } = await supabase.rpc("request_live_guest", { target_live: live.id });
      if (requestError) {
        // If duplicate key error, a request was already created — fetch it
        if (requestError.message?.includes("duplicate key")) {
          const { data: fallback } = await supabase
            .from("live_guest_requests")
            .select("id, status")
            .eq("live_id", live.id)
            .eq("user_id", session.user.id)
            .in("status", ["pending", "approved"])
            .maybeSingle();
          if (fallback) {
            setGuestRequestId(fallback.id);
            setGuestRequestStatus(t("Request sent. Waiting for the host."));
          }
        } else {
          setError(t(requestError.message));
        }
      } else {
        setGuestRequestId(data);
        setGuestRequestStatus(t("Request sent. Waiting for the host."));
      }
    } catch {
      setError(t("Could not send your request to join."));
    } finally {
      setBusy(false);
    }
  }

  async function hostDecision(request: GuestRequest, approve: boolean) {
    const { error: decisionError } = await supabase.rpc(
      approve ? "approve_live_guest" : "deny_live_guest",
      { target_request: request.id },
    );
    if (decisionError) setError(t(decisionError.message));
    else await loadGuestRequests();
  }

  async function restartCamera() {
    if (restartingCamera) return;
    setRestartingCamera(true);
    setError("");
    let replacement: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t("Live video needs camera and microphone access on a secure connection."));
      }
      replacement = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
      for (const { peer } of peersRef.current.values()) {
        for (const track of replacement.getTracks()) {
          const sender = peer.getSenders().find((item) => item.track?.kind === track.kind);
          if (sender) await sender.replaceTrack(track);
          else peer.addTrack(track, replacement);
        }
      }
      const previous = localStreamRef.current;
      setRoomStream(replacement);
      previous?.getTracks().forEach((track) => track.stop());
      setCameraStopped(false);
    } catch (cause) {
      replacement?.getTracks().forEach((track) => track.stop());
      setError(cause instanceof Error ? t(cause.message) : t("Could not restart the camera."));
    } finally {
      setRestartingCamera(false);
    }
  }

  async function closeRoom() {
    if (busy) return;
    setBusy(true);
    let closeError: string | null = null;
    if (role === "host") {
      const { error: endError } = await supabase.from("live_streams")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", live.id)
        .eq("host_id", session.user.id);
      if (endError) closeError = endError.message;
    } else if (role === "guest") {
      const { error: leaveError } = await supabase.rpc("leave_live_guest", { target_live: live.id });
      if (leaveError) closeError = leaveError.message;
    } else {
      const { error: leaveError } = await supabase.rpc("leave_live_viewer", { target_live: live.id });
      if (leaveError) closeError = leaveError.message;
    }
    setBusy(false);
    if (closeError) {
      setError(closeError);
      return;
    }
    onClose();
  }

  const broadcasters = remotes.filter((item) => item.role === "host" || item.role === "guest");
  const hostVideo = broadcasters.find((item) => item.role === "host");
  const guestVideos = broadcasters.filter((item) => item.role === "guest");
  const hostStream = hostVideo?.stream ?? (role === "host" ? localStream : null);
  const hostName = hostVideo?.name ?? `${t("You")} · ${t("Host")}`;
  const guestTiles = guestVideos.map((guest) => ({
    key: guest.userId,
    stream: guest.stream,
    name: `${guest.name} · ${t("Guest")}`,
    muted: false,
  }));
  if (role === "guest" && localStream) {
    guestTiles.push({
      key: session.user.id,
      stream: localStream,
      name: t("You"),
      muted: true,
    });
  }
  return (
    <section className="space-y-3 rounded-xl border border-[#333] bg-[#111] p-3 text-white">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{live.title || t("Live video")}</p>
          <p className="text-xs text-gray-400">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
            {t("LIVE")} · {viewerCount} {t("viewers")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={loading} onClick={() => setLayout((current) => current === "panel" ? "grid" : "panel")} className="rounded border border-[#444] px-2 py-1 text-xs">
            {layout === "panel" ? t("Grid layout") : t("Panel layout")}
          </button>
          <button type="button" disabled={busy} onClick={() => void closeRoom()} className="rounded bg-red-700 px-3 py-1 text-sm">
            {role === "host" ? t("End Live") : t("Leave")}
          </button>
        </div>
      </header>

      {loading && <p className="text-sm text-gray-400">{t("Connecting to Live...")}</p>}
      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-200">{error}</p>}
      {cameraStopped && (role === "host" || role === "guest") && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-yellow-700 bg-yellow-950/40 p-3 text-sm text-yellow-100">
          <span>{t("Your camera stopped. Restart it to show your video.")}</span>
          <button type="button" disabled={restartingCamera} onClick={() => void restartCamera()} className="rounded bg-yellow-500 px-3 py-1 font-semibold text-black disabled:opacity-50">
            {restartingCamera ? t("Restarting camera...") : t("Restart camera")}
          </button>
        </div>
      )}
      {layout === "panel" ? (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
          {hostStream ? (
            <VideoTile stream={hostStream} name={hostName} muted={role === "host"} className="row-span-2 aspect-[9/16] max-h-[60vh]" />
          ) : (
            <div className="row-span-2 flex aspect-[9/16] max-h-[60vh] items-center justify-center rounded-lg bg-black px-2 text-center text-sm text-gray-400">
              {t("Waiting for the host video...")}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {guestTiles.map((guest) => (
              <VideoTile key={guest.key} stream={guest.stream} name={guest.name} muted={guest.muted} className="aspect-[3/4]" />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {hostStream ? (
            <VideoTile stream={hostStream} name={hostName} muted={role === "host"} className="aspect-[3/4]" />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-black px-2 text-center text-sm text-gray-400">
              {t("Waiting for the host video...")}
            </div>
          )}
          {guestTiles.map((guest) => (
            <VideoTile key={guest.key} stream={guest.stream} name={guest.name} muted={guest.muted} className="aspect-[3/4]" />
          ))}
        </div>
      )}

      {role === "viewer" && !guestRequestId && (
        <button type="button" disabled={busy} onClick={() => void requestToJoin()} className="rounded bg-[#292929] px-3 py-2 text-sm disabled:opacity-50">
          {t("Request to join live")}
        </button>
      )}
      {guestRequestStatus && <p role="status" className="text-sm text-gray-300">{guestRequestStatus}</p>}
      {role === "host" && pendingGuests.length > 0 && (
        <section className="space-y-2 rounded-lg border border-[#333] p-3">
          <h3 className="font-semibold">{t("Requests to join")}</h3>
          {pendingGuests.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{request.profiles?.display_name || request.profiles?.username || t("OpenVoice member")}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => void hostDecision(request, true)} className="rounded bg-green-800 px-2 py-1">{t("Approve")}</button>
                <button type="button" onClick={() => void hostDecision(request, false)} className="rounded bg-[#333] px-2 py-1">{t("Decline")}</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-[#333] p-3">
        <h3 className="font-semibold">{t("Live chat")}</h3>
        <div className="max-h-44 space-y-2 overflow-y-auto" aria-live="polite">
          {messages.map((message) => (
            <p key={message.id} className="break-words text-sm">
              <span className="font-semibold text-yellow-100">{message.display_name}: </span>{message.content}
            </p>
          ))}
          {!messages.length && <p className="text-sm text-gray-500">{t("Say hello in the chat.")}</p>}
        </div>
        <form onSubmit={(event) => void sendChat(event)} className="flex gap-2">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} className="min-w-0 flex-1 rounded border border-[#444] bg-[#0a0a0a] px-3 py-2 text-sm" placeholder={t("Write a message...")} />
          <button disabled={busy || !draft.trim()} className="rounded px-3 py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ background: GOLD }}>{t("Send")}</button>
        </form>
      </section>
    </section>
  );
}

export default function LiveView({
  session,
  myName,
  createOpen,
  onCreateHandled,
}: {
  session: Session;
  myName: string;
  createOpen: boolean;
  onCreateHandled: () => void;
}) {
  const { t } = useLanguage();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [activeLive, setActiveLive] = useState<LiveStream | null>(null);
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const [title, setTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxViewersText = `${t("Live supports up to")} ${MAX_LIVE_VIEWERS} ${t("viewers and 2 guests. Guests need your approval. Viewers can switch between Panel and Grid layouts.")}`;

  const loadStreams = useCallback(async () => {
    const { data, error: resultError } = await supabase
      .from("live_streams")
      .select("id, host_id, title, status, created_at, profiles!live_streams_host_id_fkey(display_name, username, avatar_url)")
      .eq("status", "live")
      .order("created_at", { ascending: false });
    if (resultError) {
      setError(resultError.message);
      setLoading(false);
      return;
    }
    setStreams((data ?? []) as unknown as LiveStream[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStreams(), 0);
    const refresh = window.setInterval(() => void loadStreams(), 10000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(refresh);
    };
  }, [loadStreams]);

  useEffect(() => {
    if (createOpen) setShowCreate(true);
  }, [createOpen]);

  async function startLive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t("Live video needs camera and microphone access on a secure connection."));
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
      const { data, error: insertError } = await supabase.from("live_streams")
        .insert({ host_id: session.user.id, title: title.trim() })
        .select("id, host_id, title, status, created_at, profiles!live_streams_host_id_fkey(display_name, username, avatar_url)")
        .single();
      if (insertError) throw new Error(insertError.message);
      setHostStream(stream);
      setActiveLive(data as unknown as LiveStream);
      setShowCreate(false);
      setTitle("");
      onCreateHandled();
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      setError(cause instanceof Error ? t(cause.message) : t("Could not start your Live."));
    } finally {
      setBusy(false);
    }
  }

  async function joinLive(live: LiveStream) {
    setBusy(true);
    setError("");
    if (live.host_id === session.user.id) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
        setHostStream(stream);
        setActiveLive(live);
      } catch (cause) {
        setError(cause instanceof Error ? t(cause.message) : t("Could not resume your Live."));
      }
      setBusy(false);
      return;
    }
    const { error: joinError } = await supabase.rpc("join_live_viewer", { target_live: live.id });
    if (joinError) {
      setError(t(joinError.message));
      setBusy(false);
      return;
    }
    setActiveLive(live);
    setBusy(false);
  }

  async function closeLiveRoom() {
    setActiveLive(null);
    setHostStream(null);
    await loadStreams();
  }

  return (
    <section className="space-y-3 rounded-xl border border-[#2a2a2a] bg-[#141414] p-3 text-white">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">{t("Live")}</h2>
          <p className="text-xs text-gray-400">{t("Watch live videos, chat, or request to join.")}</p>
        </div>
        {!activeLive && (
          <button type="button" onClick={() => setShowCreate(true)} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold">
            {t("Go Live")}
          </button>
        )}
      </header>

      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-200">{error}</p>}

      {showCreate && !activeLive && (
        <form onSubmit={(event) => void startLive(event)} className="space-y-3 rounded-lg border border-[#333] bg-[#0d0d0d] p-3">
          <h3 className="font-semibold">{t("Start a live video")}</h3>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className="w-full rounded border border-[#444] bg-[#0a0a0a] px-3 py-2" placeholder={t("Add a title (optional)")} />
          <p className="text-xs text-gray-400">{maxViewersText}</p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-red-700 px-4 py-2 font-semibold disabled:opacity-50">{busy ? t("Starting...") : t("Start Live")}</button>
            <button type="button" disabled={busy} onClick={() => { setShowCreate(false); onCreateHandled(); }} className="rounded border border-[#555] px-4 py-2">{t("Cancel")}</button>
          </div>
        </form>
      )}

      {activeLive ? (
        <LiveRoom
          live={activeLive}
          session={session}
          myName={myName}
          initialRole={activeLive.host_id === session.user.id ? "host" : "viewer"}
          initialStream={hostStream}
          onClose={() => void closeLiveRoom()}
        />
      ) : loading ? (
        <p className="text-sm text-gray-400">{t("Loading live videos...")}</p>
      ) : streams.length ? (
        <div className="space-y-2">
          {streams.map((stream) => (
            <article key={stream.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#333] bg-[#0d0d0d] p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{stream.title || t("Live video")}</p>
                <p className="truncate text-sm text-gray-400">{nameFor(stream)}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void joinLive(stream)} className="shrink-0 rounded bg-red-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">{stream.host_id === session.user.id ? t("Resume Live") : t("Watch Live")}</button>
            </article>
          ))}
        </div>
      ) : <p className="text-sm text-gray-400">{t("No one is live right now.")}</p>}
    </section>
  );
}