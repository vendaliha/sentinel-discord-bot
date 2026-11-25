import type { ReactNode } from "react";
import { signInUrl } from "../lib/botApi";
import { useDashboard, type AuthState } from "../lib/store";
import { AlertIcon, ArrowUpRightIcon, ShieldIcon, UsersIcon } from "./icons";
import { Avatar } from "./ui";

function hueFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex items-center justify-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-600/30">
        <ShieldIcon size={20} />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight text-white">Sentinel</p>
        <p className="text-[11px] text-mist-500">Moderation suite</p>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <Shell>
      <Brand />
      <div className="card p-6 text-center">
        <p className="text-sm text-mist-300">Connecting to the Sentinel dashboard API…</p>
        <p className="mt-1 text-xs text-mist-500">
          Check that <code className="mono">npm run dashboard-api</code> or the bot is running.
        </p>
      </div>
    </Shell>
  );
}

function SignIn({ auth }: { auth: AuthState }) {
  return (
    <Shell>
      <Brand />
      <div className="card p-6">
        <h1 className="text-lg font-semibold tracking-tight text-white">
          Sign in to the Sentinel dashboard
        </h1>
        <p className="mt-1.5 text-sm text-mist-400">
          Sentinel uses Discord sign-in so it only shows servers where you have Administrator or
          Manage Server. Your session cookie is signed and never contains your Discord token.
        </p>

        {auth.configured ? (
          <a className="btn-primary mt-5 w-full justify-center" href={signInUrl()}>
            Continue with Discord
            <ArrowUpRightIcon size={15} />
          </a>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/5 px-3.5 py-3">
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-warn" />
              <div>
                <p className="text-sm font-medium text-warn">Discord sign-in is not configured</p>
                <p className="mt-0.5 text-xs text-mist-400">
                  {auth.setupHint ??
                    "Set the OAuth environment variables to require Discord sign-in."}
                </p>
              </div>
            </div>
            <p className="text-xs text-mist-500">
              Until then the API is open to this machine only. Add the values to{" "}
              <code className="mono">.env</code> and restart the API to protect it.
            </p>
          </div>
        )}

        {auth.error ? (
          <p className="mt-4 text-xs text-warn">{auth.error}</p>
        ) : null}

        <p className="mt-5 text-[11px] text-mist-600">
          Permissions used: identify (your username and avatar) and guilds (the servers you are in
          and your permissions there).
        </p>
      </div>
    </Shell>
  );
}

function ServerPicker({
  auth,
  chooseGuild,
}: {
  auth: AuthState;
  chooseGuild: (guildId: string) => Promise<void>;
}) {
  const name = auth.user?.name || auth.user?.username || "your account";
  return (
    <Shell>
      <Brand />
      <div className="card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Choose a server</h1>
            <p className="mt-1 text-sm text-mist-400">
              Signed in as {name}. Pick the server to manage.
            </p>
          </div>
          {auth.user ? <Avatar name={name} hue={hueFor(auth.user.id)} size={36} /> : null}
        </div>

        {auth.guilds.length ? (
          <ul className="mt-4 space-y-2">
            {auth.guilds.map((guild) => (
              <li key={guild.id}>
                <button
                  type="button"
                  onClick={() => void chooseGuild(guild.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-left transition-colors hover:border-brand-500/40 hover:bg-ink-800"
                >
                  <Avatar name={guild.name} hue={hueFor(guild.id)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-mist-100">
                      {guild.name}
                    </span>
                    <span className="block text-[11px] text-mist-500">
                      {guild.canModerate ? "Administrator access" : "Manage Server access"}
                    </span>
                  </span>
                  <span className="text-xs text-brand-300">Manage</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-ink-850 px-3.5 py-3">
            <UsersIcon size={16} className="mt-0.5 shrink-0 text-mist-500" />
            <p className="text-xs text-mist-400">
              No servers were found where you have Administrator or Manage Server. Ask a server
              owner to grant you access, then sign in again.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { auth, chooseGuild } = useDashboard();

  if (!auth.loaded) return <Loading />;
  if (auth.configured && !auth.authenticated) return <SignIn auth={auth} />;
  if (auth.authenticated && !auth.selectedGuild) {
    return <ServerPicker auth={auth} chooseGuild={chooseGuild} />;
  }
  return <>{children}</>;
}
