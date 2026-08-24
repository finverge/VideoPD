"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, Users } from "lucide-react";
import { LakshyaLogo } from "@/components/BrandHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LiveCallRoom } from "@/components/LiveCallRoom";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type State = "loading" | "invalid" | "name" | "call";

const ROLE_COPY: Record<string, { label: string; body: (contextName: string | null) => string }> = {
  VOCATIONAL_STUDENT: {
    label: "Join as training institute",
    body: (name) => `You've been invited to a short live call to confirm ${name ? `the borrower's enrollment at ${name}` : "the borrower's course enrollment"}.`,
  },
  BUSINESS_OWNER: {
    label: "Join as business contact",
    body: (name) => `You've been invited to a short live call to help verify ${name ? `${name}'s` : "the borrower's business"} premises.`,
  },
};
const DEFAULT_ROLE_COPY = {
  label: "Join verification call",
  body: () => "You've been invited to join a live video call as part of a loan verification.",
};

// 3rd-party call guest entry point — a training institute contact
// (VOCATIONAL_STUDENT) or a business/workshop contact (BUSINESS_OWNER)
// joining the live call to show their premises alongside the borrower. A
// deliberately minimal page: it shows nothing about the application beyond
// the segment and the one relevant business/institute name, none of the
// borrower's other VideoPD steps or financial data. It only validates the
// link is real (api/call/[token], not api/videopd/[token] — see that
// route's comment for why they're separate) and joins the same call room
// the borrower's and underwriter's own pages use, keyed by this token.
export default function CallGuestPage() {
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<State>("loading");
  const [name, setName] = useState("");
  const [role, setRole] = useState<{ segment: string | null; contextName: string | null }>({ segment: null, contextName: null });

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/call/${params.token}`);
      if (!res.ok) {
        setState("invalid");
        return;
      }
      const data = await res.json();
      setRole({ segment: data.segment ?? null, contextName: data.contextName ?? null });
      setState("name");
    })();
  }, [params.token]);

  const copy = (role.segment && ROLE_COPY[role.segment]) || DEFAULT_ROLE_COPY;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-5 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        <LakshyaLogo size="sm" />
        <ThemeToggle />
      </div>

      {state === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-sprout-500" />
        </div>
      )}

      {state === "invalid" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <ShieldCheck className="h-8 w-8 text-red-400" />
          <p className="text-sm font-medium text-ink-600 dark:text-ink-300">This call link is invalid or has expired.</p>
        </div>
      )}

      {state === "name" && (
        <Card>
          <Users className="mx-auto mb-4 h-10 w-10 text-sprout-500" />
          <h1 className="mb-2 text-center text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">{copy.label}</h1>
          <p className="mb-6 text-center text-sm text-ink-500 dark:text-ink-400">{copy.body(role.contextName)} Enter your name to continue.</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mb-4"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) setState("call");
            }}
          />
          <Button className="w-full" disabled={!name.trim()} onClick={() => setState("call")}>
            Continue
          </Button>
        </Card>
      )}

      {state === "call" && (
        <Card>
          <h1 className="mb-4 text-center text-lg font-bold text-ink-900 dark:text-white">Verification call</h1>
          <LiveCallRoom roomId={params.token} displayName={name.trim()} />
        </Card>
      )}
    </main>
  );
}
