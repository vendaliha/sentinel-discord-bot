import { Link, Route, Routes } from "react-router-dom";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import BackupsPage from "./pages/Backups";
import BlacklistPage from "./pages/Blacklist";
import BotPage from "./pages/Bot";
import CommandSettingsPage from "./pages/CommandSettings";
import CommunityPage from "./pages/Community";
import ConfigPage from "./pages/Config";
import GiveawaysPage from "./pages/Giveaways";
import GradesPage from "./pages/Grades";
import LeaderboardsPage from "./pages/Leaderboards";
import LogsPage from "./pages/Logs";
import MembersPage from "./pages/Members";
import ModerationPage from "./pages/Moderation";
import OverviewPage from "./pages/Overview";
import PermissionsPage from "./pages/Permissions";
import RolesPage from "./pages/Roles";
import SecurityPage from "./pages/Security";
import TicketsPage from "./pages/Tickets";
import { DashboardProvider } from "./lib/store";

function NotFound() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <p className="text-sm font-medium text-mist-100">Page not found</p>
      <p className="mt-1 text-xs text-mist-500">That dashboard route does not exist.</p>
      <Link to="/" className="btn-primary mt-4">
        Back to overview
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <DashboardProvider>
      <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="moderation" element={<ModerationPage />} />
            <Route path="blacklist" element={<BlacklistPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="leaderboards" element={<LeaderboardsPage />} />
            <Route path="grades" element={<GradesPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="giveaways" element={<GiveawaysPage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="permissions" element={<PermissionsPage />} />
            <Route path="command-settings" element={<CommandSettingsPage />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="backups" element={<BackupsPage />} />
            <Route path="bot" element={<BotPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthGate>
    </DashboardProvider>
  );
}
