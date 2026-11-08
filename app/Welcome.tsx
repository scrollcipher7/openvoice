"use client";
import { useState } from "react";
import { Anton } from "next/font/google";

const anton = Anton({ subsets: ["latin"], weight: "400" });

const GOLD = "#f5b301";
const RED = "#d7261e";

const RULES = [
  "You must be 18 or older.",
  "Speak your truth. Opinions are never censored.",
  "No nudity, no sexual content, and no links to adult sites.",
  "No threats, violence, or illegal content.",
  "No harassment or doxxing.",
  "One real person, one account. No fake profiles.",
  "Dating is for verified, US-ID members only.",
  "Break the rules and your posts get removed and your account can be banned.",
];

const inputCls =
  "w-full rounded bg-[#1c1c1c] border border-[#333] p-3 text-white placeholder-gray-500 outline-none focus:border-[#f5b301]";

function LogoMark({ size }: { size: number }) {
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

export default function Welcome({
  email,
  setEmail,
  password,
  setPassword,
  msg,
  onLogIn,
  onSignUp,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  msg: string;
  onLogIn: () => void;
  onSignUp: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] bg-cover bg-center px-4 py-10 text-white"
      style={{
        backgroundImage:
          "linear-gradient(rgba(10,10,10,0.75), rgba(10,10,10,0.92)), url('/bg.png')",
      }}
    >
      <style>{`
        @keyframes ov-pop {
          0% { transform: scale(0.2) rotate(-12deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes ov-rise {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .ov-pop { animation: ov-pop 0.9s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
        .ov-rise { animation: ov-rise 0.6s ease 0.7s both; }
        .ov-rise2 { animation: ov-rise 0.6s ease 1s both; }
      `}</style>

      <div className="mx-auto max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="ov-pop">
            <LogoMark size={110} />
          </div>
          <h1 className={anton.className + " ov-pop text-5xl uppercase leading-none tracking-wider"}>
            Open<span style={{ color: GOLD }}>Voice</span>
          </h1>
          <p className={anton.className + " ov-rise text-xl uppercase tracking-wide"} style={{ color: RED }}>
            Speak your truth. No censors.
          </p>
        </div>

        <div className="ov-rise space-y-3 rounded-lg border border-[#2a2a2a] bg-[#141414]/95 p-5">
          <input className={inputCls} placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <input className={inputCls} placeholder="Password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} />

          <button onClick={onLogIn}
            className={anton.className + " w-full rounded py-3 text-lg uppercase tracking-wider text-black"}
            style={{ background: GOLD }}>
            Log in
          </button>

          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-gray-500">
            <div className="h-px flex-1 bg-[#2a2a2a]" />
            New here?
            <div className="h-px flex-1 bg-[#2a2a2a]" />
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1" />
            <span>I am 18 or older and I agree to the OpenVoice rules below.</span>
          </label>

          <button onClick={onSignUp} disabled={!agreed}
            className={anton.className + " w-full rounded border py-3 text-lg uppercase tracking-wider disabled:opacity-40"}
            style={{ borderColor: GOLD, color: GOLD }}>
            Create account
          </button>

          {msg && <p className="text-sm text-red-500">{msg}</p>}
        </div>

        <div className="ov-rise2 rounded-lg border border-[#2a2a2a] bg-[#141414]/95 p-5">
          <h2 className={anton.className + " mb-3 text-xl uppercase tracking-wider"} style={{ color: GOLD }}>
            House rules
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-200">
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
