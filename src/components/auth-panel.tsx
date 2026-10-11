"use client";
import { useEffect, useState } from "react";
import { cloudRequest } from "@/lib/cloud";
export function AuthPanel({ password = false }: { password?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup" | "recover" | "password">(
    password ? "password" : "login",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("error") === "invalid_link")
      setMessage(
        "This link could not open a session. Sign in or request a new email.",
      );
    else if (search.get("notice") === "confirmation")
      setMessage("Check your email to confirm your account, then sign in.");
    else if (search.get("notice") === "recovery")
      setMessage("If an account exists, a recovery email is on its way.");
    // Supabase's default invitation template uses a fragment session. Exchange it
    // for HttpOnly cookies on our server; never put these tokens in browser storage.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token"),
      refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) return;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    setBusy(true);
    cloudRequest("/api/auth", { action: "session", accessToken, refreshToken })
      .then(() => window.location.assign("/auth/password"))
      .catch((e) => {
        setMessage((e as Error).message);
        setBusy(false);
      });
  }, []);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <a href="/" className="auth-brand">
          GrailHiiv
        </a>
        <h1>
          {mode === "login"
            ? "Sign in to Your Workspace"
            : mode === "signup"
              ? "Create Your Account"
              : mode === "recover"
                ? "Recover Your Password"
                : "Set Your Password"}
        </h1>
        <p>Manage your clients, content and approvals together.</p>
        <form
          method="post"
          action="/api/auth"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            const form = new FormData(e.currentTarget);
            try {
              await cloudRequest("/api/auth", {
                action: mode,
                ...(mode !== "password" ? { email: form.get("email") } : {}),
                ...(mode !== "recover"
                  ? { password: form.get("password") }
                  : {}),
              });
              if (mode === "login" || mode === "password")
                window.location.assign("/");
              else
                setMessage(
                  mode === "recover"
                    ? "If an account exists, a recovery email is on its way."
                    : "Check your email to confirm your account, then sign in.",
                );
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="hidden" name="action" value={mode} />
          {mode !== "password" && (
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
          )}
          {mode !== "recover" && (
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={mode === "login" ? 1 : 10}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
              {mode !== "login" && <small>At least 10 characters</small>}
            </label>
          )}
          <button className="primary-button" disabled={busy}>
            {busy
              ? "Please Wait…"
              : mode === "login"
                ? "Sign In"
                : mode === "signup"
                  ? "Create Account"
                  : mode === "recover"
                    ? "Send Recovery Email"
                    : "Save Password"}
          </button>
        </form>
        <div role="status">{message}</div>
        {!password && (
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setMessage("");
              }}
            >
              {mode === "login" ? "Create an Account" : "Back to Sign In"}
            </button>
            <button
              onClick={() => {
                setMode("recover");
                setMessage("");
              }}
            >
              Forgot Password?
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
export function WorkspaceOnboarding({
  email,
  onCreated,
}: {
  email: string;
  onCreated: (id: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Welcome to GrailHiiv</h1>
        <p>
          Signed in as {email}. Invitations appear after your email is verified.
          You can also create your agency workspace.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await cloudRequest<{ workspaceId: string }>(
                "/api/team",
                {
                  action: "create",
                  name: new FormData(e.currentTarget).get("name"),
                },
              );
              onCreated(result.workspaceId);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Workspace Name
            <input
              name="name"
              required
              maxLength={200}
              defaultValue="My agency"
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Create Workspace
          </button>
        </form>
        <p role="status">{message}</p>
        <button
          onClick={async () => {
            await cloudRequest("/api/auth", { action: "logout" });
            window.location.assign("/login");
          }}
        >
          Sign Out
        </button>
      </section>
    </main>
  );
}
