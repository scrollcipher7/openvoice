"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type CallMode = "audio" | "video";
type CallPhase = "idle" | "calling" | "incoming" | "connecting" | "connected";
type CallSignal =
  | { type: "offer"; mode: CallMode; description: RTCSessionDescriptionInit }
  | { type: "answer"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "hangup" }
  | { type: "decline" };

export default function DatingMatchCall({
  matchId,
  otherName,
}: {
  matchId: string;
  otherName: string;
}) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const pendingOffer = useRef<{ mode: CallMode; description: RTCSessionDescriptionInit } | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const phaseRef = useRef<CallPhase>("idle");
  const modeRef = useRef<CallMode>("audio");
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [mode, setMode] = useState<CallMode>("audio");
  const [channelReady, setChannelReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const setCallPhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setCallMode = useCallback((next: CallMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const sendSignal = useCallback(async (signal: CallSignal) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("The private call room is not connected.");
    const result = await channel.send({ type: "broadcast", event: "signal", payload: signal });
    if (result !== "ok") throw new Error("Could not send call signal. Check your connection and try again.");
  }, []);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
  }, []);

  const resetCall = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    stopLocalMedia();
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
    pendingOffer.current = null;
    pendingCandidates.current = [];
    setCallPhase("idle");
  }, [setCallPhase, stopLocalMedia]);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    async function addQueuedCandidates(peer: RTCPeerConnection) {
      for (const candidate of pendingCandidates.current) await peer.addIceCandidate(candidate);
      pendingCandidates.current = [];
    }

    async function handleSignal(signal: CallSignal) {
      try {
        if (signal.type === "offer") {
          if (phaseRef.current !== "idle") {
            await sendSignal({ type: "decline" });
            return;
          }
          pendingOffer.current = { mode: signal.mode, description: signal.description };
          setCallMode(signal.mode);
          setCallPhase("incoming");
          return;
        }
        if (signal.type === "decline") {
          resetCall();
          setError(`${otherName} declined the call.`);
          return;
        }
        if (signal.type === "hangup") {
          resetCall();
          return;
        }
        if (signal.type === "candidate") {
          const peer = peerRef.current;
          if (peer?.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidates.current.push(signal.candidate);
          return;
        }
        if (signal.type === "answer") {
          const peer = peerRef.current;
          if (!peer || phaseRef.current !== "calling") return;
          await peer.setRemoteDescription(signal.description);
          await addQueuedCandidates(peer);
          setCallPhase("connecting");
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "The call could not be connected.");
          resetCall();
        }
      }
    }

    async function connect() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError) throw new Error(authError.message);
        if (!authData.session) throw new Error("Sign in again before starting a call.");
        const response = await fetch("/api/dating/turn-credentials", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authData.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetMatchId: matchId }),
        });
        const result = await response.json() as { iceServers?: RTCIceServer[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Calls are not available for this match.");
        if (!result.iceServers?.length) throw new Error("The relay service returned no video servers.");
        if (!active) return;
        iceServersRef.current = result.iceServers;

        const channel = supabase.channel(`dating-call:${matchId}`, { config: { private: true } });
        channelRef.current = channel;
        cleanup = () => {
          peerRef.current?.close();
          stopLocalMedia();
          void supabase.removeChannel(channel);
          channelRef.current = null;
        };
        channel
          .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (payload && typeof payload === "object" && "type" in payload) {
              void handleSignal(payload as CallSignal);
            }
          })
          .subscribe((status) => {
            if (!active) return;
            if (status === "SUBSCRIBED") {
              setChannelReady(true);
              setLoading(false);
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setChannelReady(false);
              setLoading(false);
              setError("Could not join this match’s private call room.");
            }
          });

      } catch (cause) {
        if (active) {
          setLoading(false);
          setError(cause instanceof Error ? cause.message : "Calls could not be prepared.");
        }
      }
    }

    void connect();
    return () => {
      active = false;
      cleanup?.();
    };
  }, [matchId, otherName, resetCall, sendSignal, setCallMode, setCallPhase, stopLocalMedia]);

  useEffect(() => {
    if (phase !== "calling") return;
    const timer = window.setTimeout(() => {
      if (phaseRef.current === "calling") {
        resetCall();
        setError("No answer. You can try calling again.");
      }
    }, 45000);
    return () => window.clearTimeout(timer);
  }, [phase, resetCall]);

  function createPeer(): RTCPeerConnection {
    const peer = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: "relay",
    });
    peerRef.current = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({ type: "candidate", candidate: event.candidate.toJSON() }).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not send the call connection data.");
        });
      }
    };
    peer.ontrack = (event) => {
      if (modeRef.current === "video" && remoteVideo.current) {
        remoteVideo.current.srcObject = event.streams[0];
      } else if (remoteAudio.current) {
        remoteAudio.current.srcObject = event.streams[0];
      }
      setCallPhase("connected");
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") {
        setError("The call connection failed. Check your network and try again.");
        resetCall();
      } else if (peer.connectionState === "disconnected" || peer.connectionState === "closed") {
        resetCall();
      }
    };
    return peer;
  }

  async function getMedia(callMode: CallMode): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Calls require a supported browser and a secure HTTPS connection.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callMode === "video" ? { facingMode: "user" } : false,
    });
    localStreamRef.current = stream;
    if (callMode === "video" && localVideo.current) localVideo.current.srcObject = stream;
    return stream;
  }

  async function startCall(callMode: CallMode) {
    setError("");
    setCallMode(callMode);
    setCallPhase("calling");
    try {
      const stream = await getMedia(callMode);
      const peer = createPeer();
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", mode: callMode, description: offer });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the call.");
      resetCall();
    }
  }

  async function acceptCall() {
    const offer = pendingOffer.current;
    if (!offer) return;
    setError("");
    setCallPhase("connecting");
    try {
      const stream = await getMedia(offer.mode);
      const peer = createPeer();
      await peer.setRemoteDescription(offer.description);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      for (const candidate of pendingCandidates.current) await peer.addIceCandidate(candidate);
      pendingCandidates.current = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal({ type: "answer", description: answer });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept the call.");
      resetCall();
    }
  }

  async function declineCall() {
    try {
      await sendSignal({ type: "decline" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not decline the call cleanly.");
    } finally {
      resetCall();
    }
  }

  async function endCall() {
    try {
      await sendSignal({ type: "hangup" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the call cleanly.");
    } finally {
      resetCall();
    }
  }

  return (
    <section className="space-y-3 rounded border border-[#333] p-3" aria-label="Audio and video calls">
      <div>
        <h4 className="font-semibold">Call {otherName}</h4>
        <p className="text-xs text-gray-400">The other person must have this match chat open to receive a call. Calls are not recorded or stored by OpenVoice, but could be captured outside the app.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {loading && <p className="text-sm text-gray-400">Connecting to private call service…</p>}
      {!loading && !channelReady && <p className="text-sm text-gray-400">Calls are unavailable right now.</p>}

      {phase === "idle" && channelReady && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void startCall("audio")} className="rounded border border-[#555] px-3 py-2 text-sm">Audio call</button>
          <button type="button" onClick={() => void startCall("video")} className="rounded px-3 py-2 text-sm font-semibold text-black" style={{ background: "#f5b301" }}>Video call</button>
        </div>
      )}
      {phase === "incoming" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm">{mode === "video" ? "Incoming video call" : "Incoming audio call"} from {otherName}</p>
          <button type="button" onClick={() => void acceptCall()} className="rounded px-3 py-2 text-sm font-semibold text-black" style={{ background: "#f5b301" }}>Accept</button>
          <button type="button" onClick={() => void declineCall()} className="rounded border border-red-500 px-3 py-2 text-sm text-red-300">Decline</button>
        </div>
      )}
      {(phase === "calling" || phase === "connecting" || phase === "connected") && (
        <div className="space-y-2">
          <p className="text-sm text-gray-300">
            {phase === "calling" ? `Calling ${otherName}…` : phase === "connecting" ? "Connecting call…" : mode === "video" ? "Video call connected." : "Audio call connected."}
          </p>
          {mode === "video" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <video ref={localVideo} autoPlay muted playsInline className="max-h-64 w-full rounded bg-black object-contain" />
              <video ref={remoteVideo} autoPlay playsInline className="max-h-64 w-full rounded bg-black object-contain" />
            </div>
          )}
          <audio ref={remoteAudio} autoPlay />
          <button type="button" onClick={() => void endCall()} className="rounded border border-red-500 px-3 py-2 text-sm text-red-300">End call</button>
        </div>
      )}
    </section>
  );
}
