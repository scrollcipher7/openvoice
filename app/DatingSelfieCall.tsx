"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Role = "applicant" | "reviewer";
type Signal =
  | { type: "ready" }
  | { type: "offer"; description: RTCSessionDescriptionInit; challenge: string }
  | { type: "answer"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "hangup" };

const CHALLENGES = [
  "Look directly at the camera, then slowly turn your head to the left and back.",
  "Look directly at the camera, then slowly turn your head to the right and back.",
  "Look directly at the camera, blink twice, then smile.",
];

export default function DatingSelfieCall({
  userId,
  role,
  displayName,
  onConnected,
}: {
  userId: string;
  role: Role;
  displayName?: string;
  onConnected?: () => void;
}) {
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const reviewerReady = useRef(false);
  const readyResponseSent = useRef(false);
  const offerCreated = useRef(false);
  const [connected, setConnected] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState("");
  const [channelReady, setChannelReady] = useState(false);

  const sendSignal = useCallback(async (signal: Signal) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("The live check connection is closed.");
    const result = await channel.send({ type: "broadcast", event: "signal", payload: signal });
    if (result !== "ok") throw new Error("Could not send live check signaling. Please reconnect and try again.");
  }, []);

  const getPeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;
    const peer = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: "relay",
    });
    peerRef.current = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({ type: "candidate", candidate: event.candidate.toJSON() }).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not send a connection candidate.");
        });
      }
    };
    peer.ontrack = (event) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
      setConnected(true);
      onConnected?.();
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") {
        setError("A direct video connection could not be made on this network. Please try another network.");
      }
      if (peer.connectionState === "disconnected" || peer.connectionState === "closed") {
        setConnected(false);
      }
    };
    return peer;
  }, [onConnected, sendSignal]);

  useEffect(() => {
    let active = true;

    async function flushCandidates(peer: RTCPeerConnection) {
      for (const candidate of pendingCandidates.current) {
        await peer.addIceCandidate(candidate);
      }
      pendingCandidates.current = [];
    }

    async function handleSignal(signal: Signal) {
      try {
        if (signal.type === "ready" && role === "applicant") {
          reviewerReady.current = true;
          if (localStreamRef.current && !offerCreated.current) {
            const peer = getPeer();
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            offerCreated.current = true;
            const nextChallenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
            setChallenge(nextChallenge);
            await sendSignal({ type: "offer", description: offer, challenge: nextChallenge });
          }
          return;
        }
        if (signal.type === "ready" && role === "reviewer" && !readyResponseSent.current) {
          readyResponseSent.current = true;
          await sendSignal({ type: "ready" });
          return;
        }

        if (signal.type === "offer" && role === "reviewer") {
          setChallenge(signal.challenge);
          const peer = getPeer();
          await peer.setRemoteDescription(signal.description);
          await flushCandidates(peer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal({ type: "answer", description: answer });
          return;
        }

        if (signal.type === "answer" && role === "applicant") {
          const peer = peerRef.current;
          if (!peer) throw new Error("The video connection is not ready.");
          await peer.setRemoteDescription(signal.description);
          await flushCandidates(peer);
          return;
        }

        if (signal.type === "candidate") {
          const peer = peerRef.current;
          if (peer?.remoteDescription) {
            await peer.addIceCandidate(signal.candidate);
          } else {
            pendingCandidates.current.push(signal.candidate);
          }
          return;
        }

        if (signal.type === "hangup") {
          peerRef.current?.close();
          peerRef.current = null;
          setConnected(false);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "The live check connection failed.");
      }
    }

    async function connectToRoom() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError) throw new Error(authError.message);
        if (!authData.session) throw new Error("Sign in again before starting the live check.");
        const response = await fetch("/api/dating/turn-credentials", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authData.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targetUserId: userId }),
        });
        const result = await response.json() as { iceServers?: RTCIceServer[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not prepare private video.");
        if (!result.iceServers?.length) throw new Error("The relay service returned no video servers.");
        iceServersRef.current = result.iceServers;
        if (!active) return;

        const channel = supabase.channel(`dating-selfie:${userId}`, { config: { private: true } });
        channelRef.current = channel;
        channel
          .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (payload && typeof payload === "object" && "type" in payload) {
              void handleSignal(payload as Signal);
            }
          })
          .subscribe((status) => {
            if (!active) return;
            if (status === "SUBSCRIBED") {
              setChannelReady(true);
              if (role === "reviewer") {
                void sendSignal({ type: "ready" }).catch((cause: unknown) => {
                  if (active) setError(cause instanceof Error ? cause.message : "Could not notify the applicant.");
                });
              } else {
                void sendSignal({ type: "ready" }).catch((cause: unknown) => {
                  if (active) setError(cause instanceof Error ? cause.message : "Could not notify the reviewer.");
                });
              }
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setChannelReady(false);
              setError("Could not connect to the private live check room. Check Realtime access and try again.");
            }
          });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not prepare the private video connection.");
      }
    }

    void connectToRoom();

    return () => {
      active = false;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current?.close();
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [getPeer, role, sendSignal, userId]);

  async function startCamera() {
    setError("");
    setLoading(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires a supported browser and a secure HTTPS connection.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" },
      });
      localStreamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      setCameraOn(true);
      const peer = getPeer();
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      if (reviewerReady.current) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        offerCreated.current = true;
        const nextChallenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
        setChallenge(nextChallenge);
        await sendSignal({ type: "offer", description: offer, challenge: nextChallenge });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not access your camera. Check browser permissions.");
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setCameraOn(false);
    } finally {
      setLoading(false);
    }
  }

  async function endCall() {
    setError("");
    try {
      const channel = channelRef.current;
      if (channel) {
        const result = await channel.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "hangup" } satisfies Signal,
        });
        if (result !== "ok") setError("The live check ended locally, but the other person may still see a connected screen.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the live check cleanly.");
    } finally {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      setCameraOn(false);
      setConnected(false);
      offerCreated.current = false;
      pendingCandidates.current = [];
      if (localVideo.current) localVideo.current.srcObject = null;
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
    }
  }

  return (
    <div className="space-y-3 rounded border border-[#444] p-4">
      <p className="font-semibold">{role === "applicant" ? "Live selfie check" : `Live selfie check${displayName ? ` — ${displayName}` : ""}`}</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!channelReady && <p className="text-sm text-gray-400">Preparing the private relay connection…</p>}
      {role === "applicant" && (
        <p className="text-sm text-gray-300">
          Your camera is off until you start it. Video travels through an encrypted relay to the assigned reviewer. OpenVoice does not record or store it, but cannot prevent someone from capturing it outside the app. You can stop sharing at any time.
        </p>
      )}
      {role === "applicant" && challenge && <p className="rounded bg-[#292929] p-3 text-sm text-yellow-100">Please do this while the reviewer watches: {challenge}</p>}
      {role === "applicant" ? (
        <video ref={localVideo} autoPlay muted playsInline className="max-h-80 w-full rounded bg-black object-contain" />
      ) : (
        <>
          {challenge && <p className="rounded bg-[#292929] p-3 text-sm text-yellow-100">Ask the applicant to do this: {challenge}</p>}
          <video ref={remoteVideo} autoPlay playsInline className="max-h-96 w-full rounded bg-black object-contain" />
          {!connected && <p className="text-sm text-gray-400">Waiting for the applicant to start their camera…</p>}
        </>
      )}
      <p className="text-sm text-gray-400">
        {connected ? "Live video connected." : cameraOn ? "Camera is on; waiting for the reviewer…" : role === "reviewer" ? "Waiting for a live connection." : "Camera is off."}
      </p>
      {role === "applicant" && (
        <div className="flex gap-2">
          {!cameraOn ? (
            <button type="button" onClick={() => void startCamera()} disabled={!channelReady || loading} className="rounded px-4 py-2 font-semibold text-black disabled:opacity-50" style={{ background: "#f5b301" }}>
              {loading ? "Starting camera…" : "Start live selfie check"}
            </button>
          ) : (
            <button type="button" onClick={() => void endCall()} className="rounded border border-red-500 px-4 py-2 text-red-300">Stop camera</button>
          )}
        </div>
      )}
      {role === "reviewer" && (
        <button type="button" onClick={() => void endCall()} className="rounded border border-[#555] px-4 py-2 text-sm">End live session</button>
      )}
    </div>
  );
}
