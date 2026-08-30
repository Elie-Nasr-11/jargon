/**
 * The fenced developer corner — demo logins, and nothing else.
 *
 * Rebuild brief, step 7: "'Seeding' dies; demo logins move to a fenced developer
 * corner." Seeding creates real accounts on a shared password, which is a fine
 * tool for a demo and a bad thing to leave sitting in a tab beside the roster an
 * admin actually manages. So it is fenced three ways: platform admins only, folded
 * shut by default, and labelled as what it is rather than as a setup step.
 *
 * It stays because demoing the product is a real job. It is not a first-class
 * screen because running a school is not it.
 */
import { useState } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { seedDemoLogins } from "@/lib/api";

const MIN_TEMP_PASSWORD_LENGTH = 6;

export function DeveloperCorner({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("JargonDemo123!");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{
    password: string;
    accounts: Array<{ email: string; role: string }>;
  } | null>(null);

  const run = async () => {
    if (!token) return;
    if (password.trim().length < MIN_TEMP_PASSWORD_LENGTH) {
      setMessage(`Use a password of at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await seedDemoLogins(token, password.trim());
      setResult({
        password: response.password,
        accounts: response.accounts.map((account) => ({
          email: account.email,
          role: account.role,
        })),
      });
      setMessage("Demo logins ready.");
    } catch (error) {
      setMessage((error as Error).message || "Could not create the demo logins.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-card border border-dashed border-border bg-depth-sub">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span className="flex-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Developer corner
        </span>
        <span className="text-meta text-muted-foreground">Demo logins</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-border/60 px-4 py-4">
          <p className="text-meta leading-relaxed text-muted-foreground">
            Creates the three demo accounts (student, teacher, admin) on one shared password, for
            showing the product. These are real accounts on this deployment — do not use this to set
            up a school. Real people are added in People.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid flex-1 gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Shared password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="jargon-input normal-case tracking-normal"
              />
            </label>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              {busy ? "Creating…" : "Create demo logins"}
            </button>
          </div>
          {message ? <p className="text-meta text-muted-foreground">{message}</p> : null}
          {result ? (
            <div className="grid gap-1">
              {result.accounts.map((account) => (
                <div
                  key={account.email}
                  className="flex items-center gap-2 rounded-control border border-border bg-depth-field px-3 py-1.5 text-meta"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{account.email}</span>
                  <span className="shrink-0 text-muted-foreground">{account.role}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
