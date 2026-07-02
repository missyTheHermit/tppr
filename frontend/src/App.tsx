import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import Signup from "./pages/Signup";
import { AuthProvider } from "./api/auth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import PaperEditor from "./pages/PaperEditor";
import { PapersViewer } from "./pages/PaperEditorViewer";
import Unauthorized from "./pages/errors/Unauthorised";
import { GenericError } from "./pages/errors/GenericError";
import Search from "./pages/Search";
import AdminTakedowns from "./pages/AdminTakedowns";
import AdminVerificationRequests from "./pages/AdminVerificationRequests";
import Copyright from "./pages/legal/Copyright";
import Privacy from "./pages/legal/Privacy";
import { Footer } from "./components/footer";
import { useEffect } from "react";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import Settings from "./pages/Settings";
import Friends from "./pages/Friends";
import Leaderboard from "./pages/Leaderboard";
import Dashboard from "./pages/Dashboard";
import PaperStats from "./pages/PaperStats";
import { PresenceHeartbeat } from "./components/presence-heartbeat";
import UserProfile from "./pages/UserProfile";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <TooltipProvider>
          <PresenceHeartbeat />
          <ScrollToTop />
          <div className="flex min-h-screen flex-col">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/papers/:id/stats" element={<PaperStats />} />
              <Route path="/papers/:id" element={<PaperEditor />} />
              <Route path="/papers" element={<PapersViewer />} />
              <Route path="/unauthorized" element={<Unauthorized />} />
              <Route path="/search" element={<Search />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users/:userId" element={<UserProfile />} />

              <Route path="/admin/takedowns" element={<AdminTakedowns />} />
              <Route
                path="/admin/verification-requests"
                element={<AdminVerificationRequests />}
              />

              <Route path="/legal/copyright" element={<Copyright />} />
              <Route path="/legal/privacy" element={<Privacy />} />

              {/* always keep this at the bottom */}
              <Route
                path="*"
                element={
                  <GenericError
                    code={404}
                    title="Not Found"
                    message="The page you're looking for doesn't exist."
                    showNav={true}
                  />
                }
              />
            </Routes>
            <Footer />
          </div>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
export default App;
