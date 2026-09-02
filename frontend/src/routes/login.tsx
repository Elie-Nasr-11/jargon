import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Eye, EyeOff } from "lucide-react";
import { AmbientBackdrop } from "@/components/AmbientBackdrop";
import { ThemeToggle } from "@/components/ThemeToggle";
import { prefersReducedMotion } from "@/lib/motion";
import { fetchPrimaryRole, getSession, roleHomeNav, signIn } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Sign in — Jargon" }, { name: "description", content: "Sign in to Jargon." }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getSession()
      .then(async (session) => {
        if (!alive || !session) return;
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (alive) navigate({ ...roleHomeNav(role), replace: true });
      })
      .catch(() => {
        // Stay on the login page; the submit action will surface auth errors.
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  useEffect(() => {
    // GSAP ignores the CSS reduced-motion block — skip the entrance choreography entirely
    // and land on the settled layout.
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-anim='word']", {
        y: 18,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.06,
      });
      gsap.from("[data-anim='pill']", {
        y: 8,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
        delay: 0.05,
      });
      gsap.from("[data-anim='card']", {
        y: 18,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        delay: 0.25,
      });
      gsap.from("[data-anim='sub']", {
        y: 10,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
        delay: 0.4,
      });
    }, wrapRef);
    return () => ctx.revert();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const session = await signIn(email.trim(), password);
      const role = session
        ? await fetchPrimaryRole(session.access_token, session.user.id)
        : "student";
      if (prefersReducedMotion()) {
        navigate(roleHomeNav(role));
      } else {
        gsap.to(wrapRef.current, {
          opacity: 0,
          y: -8,
          duration: 0.35,
          ease: "power2.in",
          onComplete: () => {
            navigate(roleHomeNav(role));
          },
        });
      }
    } catch (error) {
      setMessage((error as Error).message || "Could not sign in.");
      setSubmitting(false);
    }
  };

  const headline = "Learn anything,\nin your own words.".split(" ");

  return (
    // R53: the login speaks the same language as the app it opens — the page ladder
    // (dot-grid background from <body>), hairline card, one blue accent — instead of
    // the old full-strength rainbow wash. The ambient stays as a whisper at the
    // working-surface intensity, tinted neutral like the consoles.
    <div className="relative min-h-screen overflow-hidden">
      <AmbientBackdrop intensity={0.16} hue="--ambient-neutral" />
      <ThemeToggle floating />
      <div
        ref={wrapRef}
        className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16"
      >
        {/* The brand pill: a quiet hairline chip with the aurora rationed to one dot. */}
        <div
          data-anim="pill"
          className="inline-flex items-center gap-2 rounded-pill border border-border bg-depth-card px-4 py-1.5 shadow-card"
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{
              background:
                "linear-gradient(135deg, var(--aurora-1), var(--aurora-2), var(--aurora-3))",
            }}
          />
          <span className="text-[13px] font-medium leading-none tracking-tight text-foreground">
            Jargon AI tutor
          </span>
        </div>

        <h1 className="font-serif mt-7 max-w-[720px] text-center text-[36px] leading-[1.08] tracking-tight text-foreground sm:text-[46px]">
          {headline.map((w, i) => (
            <span key={i} data-anim="word" className="inline-block">
              {w}
              {i < headline.length - 1 ? "\u00A0" : ""}
            </span>
          ))}
        </h1>

        <p
          data-anim="sub"
          className="mt-4 max-w-md text-center text-[15px] leading-relaxed text-muted-foreground"
        >
          Hyper-personal lessons that meet you where you are. One conversation at a time.
        </p>

        <div data-anim="card" className="mt-10 w-full max-w-[400px]">
          <div className="rounded-card border border-border bg-depth-card shadow-raised">
            <form onSubmit={onSubmit} className="space-y-5 p-7">
              <div>
                <label className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@somewhere.com"
                  className="jargon-input mt-1.5 w-full text-[15px]"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="jargon-input w-full pr-10 text-[15px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-[16px] w-[16px]" strokeWidth={1.6} />
                    ) : (
                      <Eye className="h-[16px] w-[16px]" strokeWidth={1.6} />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary w-full py-3 text-[14px] active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {submitting ? "Signing in..." : "Continue"}
              </button>
              {message && (
                <p role="alert" className="text-center text-[12.5px] leading-relaxed text-danger">
                  {message}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
