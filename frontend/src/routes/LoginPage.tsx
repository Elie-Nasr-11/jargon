import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import gsap from "gsap";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { signIn, signUp } from "@/lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");

  useEffect(() => {
    const target = wrapRef.current;
    if (!target) return;
    const context = gsap.context(() => {
      gsap.from("[data-anim='pill']", {
        opacity: 0,
        y: 10,
        duration: 0.6,
        ease: "power2.out",
      });
      gsap.from("[data-anim='title']", {
        opacity: 0,
        y: 18,
        duration: 0.8,
        ease: "power3.out",
        delay: 0.12,
      });
      gsap.from("[data-anim='copy']", {
        opacity: 0,
        y: 14,
        duration: 0.7,
        ease: "power2.out",
        delay: 0.24,
      });
      gsap.from("[data-anim='card']", {
        opacity: 0,
        y: 22,
        duration: 0.8,
        ease: "power3.out",
        delay: 0.3,
      });
    }, target);
    return () => context.revert();
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setMessageIsError(false);
    try {
      if (isSignup) {
        const result = await signUp({ email, password, name, grade });
        if (result.session) {
          navigate({ to: "/chat" });
        } else {
          setMessage("Account created. If email confirmation is enabled, confirm your email and sign in.");
        }
      } else {
        await signIn(email, password);
        navigate({ to: "/chat" });
      }
    } catch (error) {
      setMessageIsError(true);
      setMessage((error as Error).message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <AmbientCanvas intensity={0.85} />
      <div className="page-layer">
        <div className="stage-frame">
          <div className="auth-screen" ref={wrapRef}>
            <div className="auth-column">
              <div className="auth-pill" data-anim="pill">
                Jargon AI tutor
              </div>
              <div className="auth-title" data-anim="title">
                Learn through conversation, one lesson at a time.
              </div>
              <div className="auth-copy" data-anim="copy">
                The tutor frontend is now wired for the live Jargon runtime: lessons, code, mentor,
                and progress all in one studio.
              </div>

              <GradientCard className="auth-card" data-anim="card">
                <form onSubmit={handleSubmit}>
                  <div className="auth-grid">
                    <div>
                      <label className="auth-label" htmlFor="email">
                        Email
                      </label>
                      <input
                        id="email"
                        className="auth-input"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        placeholder="you@example.com"
                      />
                    </div>

                    <div>
                      <label className="auth-label" htmlFor="password">
                        Password
                      </label>
                      <input
                        id="password"
                        className="auth-input"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        placeholder="Password"
                      />
                    </div>

                    {isSignup && (
                      <div className="auth-row">
                        <div>
                          <label className="auth-label" htmlFor="name">
                            Name
                          </label>
                          <input
                            id="name"
                            className="auth-input"
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="Elie Nasr"
                          />
                        </div>

                        <div>
                          <label className="auth-label" htmlFor="grade">
                            Grade / level
                          </label>
                          <input
                            id="grade"
                            className="auth-input"
                            type="text"
                            value={grade}
                            onChange={(event) => setGrade(event.target.value)}
                            placeholder="Student"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="auth-actions">
                    <button type="submit" className="primary-button" disabled={loading}>
                      {loading ? "Working…" : isSignup ? "Create account" : "Sign in"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setIsSignup((current) => !current);
                        setMessage("");
                        setMessageIsError(false);
                      }}
                    >
                      {isSignup ? "Already have an account?" : "New here? Create one"}
                    </button>
                  </div>

                  <div className={`auth-message ${messageIsError ? "error" : ""}`}>{message}</div>
                </form>
              </GradientCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
