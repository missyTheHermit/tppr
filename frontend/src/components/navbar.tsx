import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Bell,
  FileText,
  Filter,
  LayoutDashboard,
  NotepadTextDashed,
  Plus,
  SearchIcon,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/api/auth";
import { getNotifications, type NotificationItem } from "@/api/social";
import { cacheAvatarUrl } from "@/api/client";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreatePaperDialog } from "./create-paper-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { AllNESASubjectsList } from "@/lib/subjects";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOnline } from "@/lib/hooks";
import { loginPath, signupPath } from "@/lib/routes";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import Confetti from "react-confetti";
import { useWindowSize } from "react-use";
import { toast } from "sonner";

export default function NavBar() {
  const online = useOnline();

  const { user, logout, switchToAdminMode } = useAuth();
  const [newPaperOpen, setNewPaperOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [subject, setSubject] = useState("");
  const [source, setSource] = useState("");
  const [year, setYear] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [showSearchGuide, setShowSearchGuide] = useState(() =>
    !localStorage.getItem("hasSeenSearchGuide")
  );
  const location = useLocation();
  const isSearchPage = location.pathname === "/search";
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  const [showConfetti, setShowConfetti] = useState(false);
  const confettiDoneCount = useRef(0);
  const { width, height } = useWindowSize();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    const items = await getNotifications();
    setNotifications(items);
  }, [user]);

  // Poll for notifications every 60 seconds while logged in.
  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    const id = window.setInterval(fetchNotifications, 60_000);
    return () => window.clearInterval(id);
  }, [user, fetchNotifications]);

  // Re-fetch once when the dropdown is opened so the list is fresh.
  useEffect(() => {
    if (notificationsOpen) fetchNotifications();
  }, [notificationsOpen, fetchNotifications]);

  const unreadCount = notifications.length;

  function dismissGuide() {
    localStorage.setItem("hasSeenSearchGuide", "true");
    setShowSearchGuide((prev) => {
      if (prev) {
        confettiDoneCount.current = 0;
        setShowConfetti(true);
      }
      return false;
    });
  }

  useEffect(() => {
    confettiDoneCount.current = 0;
    const timeout = setTimeout(() => setShowConfetti(false), 0);
    return () => clearTimeout(timeout);
  }, [location.key]);

  function handleConfettiComplete() {
    confettiDoneCount.current += 1;
    if (confettiDoneCount.current >= 2) {
      setShowConfetti(false);
    }
  }

  function handleSearch(e: React.SubmitEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (subject && subject !== "all") params.set("subject", subject);
    if (source) params.set("source", source);
    if (year) params.set("year", year);
    params.set("page", "1");
    params.set("per_page", "20");
    navigate(`/search?${params.toString()}`);
    setFocused(false);
    setShowFilters(false);
    inputRef.current?.blur();
  }

  async function handleSwitchToAdminMode() {
    const error = await switchToAdminMode();
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Admin mode activated");
  }

  <Tooltip>
    <TooltipTrigger>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
        <span className="inline-flex size-2 rounded-full bg-orange-500" />
      </span>
    </TooltipTrigger>
    <TooltipContent>You're offline - changes saved locally</TooltipContent>
  </Tooltip>;

  return (
    <header className="w-full border-b">
      {showConfetti && (
        <>
          {/* Left cannon */}
          <Confetti
            width={width || window.innerWidth}
            height={height || window.innerHeight}
            style={{
              position: "fixed",
              inset: 0,
              pointerEvents: "none",
              zIndex: 50,
            }}
            recycle={false}
            numberOfPieces={100}
            confettiSource={{
              x: 0,
              y: height || window.innerHeight,
              w: 10,
              h: 0,
            }}
            initialVelocityX={{ min: 5, max: 15 }}
            initialVelocityY={{ min: -35, max: -15 }}
            onConfettiComplete={handleConfettiComplete}
          />
          {/* Right cannon */}
          <Confetti
            width={width || window.innerWidth}
            height={height || window.innerHeight}
            style={{
              position: "fixed",
              inset: 0,
              pointerEvents: "none",
              zIndex: 50,
            }}
            recycle={false}
            numberOfPieces={100}
            confettiSource={{
              x: (width || window.innerWidth) - 10,
              y: height || window.innerHeight,
              w: 10,
              h: 0,
            }}
            initialVelocityX={{ min: -15, max: -5 }}
            initialVelocityY={{ min: -35, max: -15 }}
            onConfettiComplete={handleConfettiComplete}
          />
        </>
      )}

      <div className="mx-auto flex h-16 w-full items-center px-6">
        {/* Brand — takes up left space */}
        <Link to="/" className="flex flex-1 shrink-0 items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <NotepadTextDashed className="size-4" />
          </div>
          <span className="hidden text-lg font-semibold sm:inline">
            Thribhu's Past Paper Repository
          </span>
        </Link>

        {/* Search bar — centered */}
        {!isSearchPage && (
          <form
            onSubmit={handleSearch}
            className="mx-auto flex max-w-md flex-1 items-center gap-2"
          >
            <Popover
              open={showSearchGuide}
              onOpenChange={(open) => !open && dismissGuide()}
            >
              <PopoverTrigger asChild>
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    placeholder="Search papers…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                      setFocused(true);
                      dismissGuide();
                    }}
                    onBlur={(e) => {
                      if (e.relatedTarget?.closest("[data-filter-toggle]")) {
                        return;
                      }
                      setFocused(false);
                    }}
                    className={`pl-8 ${
                      showSearchGuide ? "ring-2 ring-primary" : ""
                    }`}
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="center" className="w-72">
                <p className="font-medium text-sm">Start by searching</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Search for past papers by subject, year, or topic here.
                </p>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={dismissGuide}
                >
                  Got it!
                </Button>
              </PopoverContent>
            </Popover>
            {focused && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                data-filter-toggle
                onClick={() => setShowFilters((v) => !v)}
                aria-label="Toggle filters"
              >
                <Filter className="size-4" />
              </Button>
            )}
          </form>
        )}

        {/* Right */}
        <div className="flex flex-1 shrink-0 items-center justify-end gap-2">
          {user
            ? (
              <>
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <Link to="/papers">
                    <FileText className="size-4" />
                  </Link>
                </Button>

                <Button asChild variant="ghost" size="icon" className="size-8">
                  <Link to="/leaderboard">
                    <Trophy className="size-4" />
                  </Link>
                </Button>

                {/* Notification bell — replaces the standalone Friends icon.
                    Pending friend requests appear here, and a Friends tab at
                    the bottom links to /friends. */}
                <DropdownMenu
                  open={notificationsOpen}
                  onOpenChange={setNotificationsOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative size-8"
                      aria-label="Notifications"
                    >
                      <Bell className="size-4" />
                      {unreadCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel className="flex items-center justify-between">
                      <span>Notifications</span>
                      {unreadCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {unreadCount} new
                        </span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {notifications.length === 0
                      ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          You're all caught up!
                        </div>
                      )
                      : (
                        notifications.map((n) => (
                          <DropdownMenuItem
                            key={n.id}
                            className="gap-2 py-2"
                            onClick={() => {
                              setNotificationsOpen(false);
                              navigate(n.href);
                            }}
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Users className="size-4" />
                            </span>
                            <span className="flex flex-col gap-0.5">
                              <span className="text-sm">{n.content}</span>
                              {n.createdAt && (
                                <span className="text-xs text-muted-foreground">
                                  {new Date(n.createdAt).toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          </DropdownMenuItem>
                        ))
                      )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setNotificationsOpen(false);
                        navigate("/friends");
                      }}
                    >
                      <Users className="size-4" />
                      Friends
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog open={newPaperOpen} onOpenChange={setNewPaperOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus data-icon="inline-start" />
                      New Paper
                    </Button>
                  </DialogTrigger>
                  <CreatePaperDialog onCreated={() => setNewPaperOpen(false)} />
                </Dialog>

                <DropdownMenu>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="relative size-8 rounded-full"
                          >
                            {user.admin
                              ? <ShieldCheck className="size-5 text-primary" />
                              : (
                                <Avatar className="size-8">
                                  <AvatarImage
                                    src={cacheAvatarUrl(user.avatar_url)}
                                    alt={user.username}
                                  />
                                  <AvatarFallback>
                                    {user.username?.slice(0, 2).toUpperCase() ??
                                      "U"}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                            <span
                              className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-background ${
                                online ? "bg-green-500" : "bg-yellow-500"
                              }`}
                            />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {online
                          ? "Online; syncing to cloud"
                          : "Offline; changes saved locally"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      {user.admin && (
                        <>
                          <DropdownMenuItem
                            disabled
                            className="gap-2 text-primary"
                          >
                            <ShieldCheck />
                            Admin mode
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/admin/takedowns">
                              <ShieldCheck />
                              Takedowns
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/admin/verification-requests">
                              <ShieldCheck />
                              Verification requests
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      {!user.admin && user.admin_available && (
                        <>
                          <DropdownMenuItem onClick={handleSwitchToAdminMode}>
                            <ShieldCheck />
                            Switch to admin mode
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem asChild>
                        <Link to="/dashboard">
                          <LayoutDashboard />
                          Dashboard
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/settings">Settings</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={logout}>
                        Sign out
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )
            : (
              <>
                <Button asChild variant="outline">
                  <Link to={loginPath(currentPath)}>
                    Login
                  </Link>
                </Button>
                <Button asChild>
                  <Link to={signupPath(currentPath)}>
                    Signup
                  </Link>
                </Button>
              </>
            )}
        </div>
      </div>

      {/* Filter row — only visible when search is focused and toggled */}
      {focused && showFilters && (
        <div className="border-t bg-muted/50 px-6 py-3">
          <form
            onSubmit={handleSearch}
            className="mx-auto flex max-w-2xl items-center justify-center gap-3"
          >
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger className="w-44" onFocus={() => setFocused(true)}>
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any subject</SelectItem>
                <AllNESASubjectsList />
              </SelectContent>
            </Select>
            <Input
              placeholder="Source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onFocus={() => setFocused(true)}
              className="w-28"
            />
            <Input
              type="number"
              placeholder="Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              onFocus={() => setFocused(true)}
              min={2000}
              className="w-24"
            />
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>
        </div>
      )}
    </header>
  );
}
