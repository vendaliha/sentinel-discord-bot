import { Link, Route, Routes } from "react-router-dom";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import AutomodPage from "./pages/Automod";
import CasesPage from "./pages/Cases";
import MembersPage from "./pages/Members";
import OverviewPage from "./pages/Overview";
import SettingsPage from "./pages/Settings";
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
            <Route path="cases" element={<CasesPage />} />
            <Route path="automod" element={<AutomodPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthGate>
    </DashboardProvider>
  );
}
