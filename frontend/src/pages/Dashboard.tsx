import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Award,
    BookCheck,
    Clock,
    Flame,
    Glasses,
    History,
    PenLine,
    Repeat,
    Search,
    ShieldCheck,
    Star,
    Target,
    Timer,
    Trophy,
    Users,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/api/auth";
import {
    getAllUserStats,
    getMyStats,
    type AllUserStats,
    type MyStats,
} from "@/api/stats";
import type { Attempt } from "@/api/progress";
import {
    getStarredPapers,
    type StarredPaper,
} from "@/api/stars";
import NavBar from "@/components/navbar";
import { StarPaperButton } from "@/components/star-paper-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

const ZERO: MyStats = {
    user_id: "",
    username: "",
    attempts_count: 0,
    papers_attempted: 0,
    papers_completed: 0,
    questions_answered: 0,
    total_study_seconds: 0,
    reveal_count: 0,
    current_streak: 0,
    longest_streak: 0,
    last_active_at: null,
    recent_attempts: [],
};

function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function relativeTime(iso: string | null | undefined): string {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "never";
    const diff = Date.now() - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

function MetricStat({
    icon,
    label,
    value,
    hint,
    accent = "primary",
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    hint?: string;
    accent?: "primary" | "green" | "blue" | "amber" | "rose";
}) {
    const accentClasses: Record<string, string> = {
        primary: "bg-primary/10 text-primary",
        green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    };
    return (
        <Card className="gap-0">
            <CardContent className="flex items-center gap-4 p-5">
                <div
                    className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${accentClasses[accent]}`}
                >
                    {icon}
                </div>
                <div className="min-w-0">
                    <p className="text-2xl font-bold leading-none tabular-nums">
                        {value}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                        {label}
                    </p>
                    {hint && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                            {hint}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function ProgressRow({
    label,
    value,
    total,
    color = "bg-primary",
}: {
    label: string;
    value: number;
    total: number;
    color?: string;
}) {
    const percent = total ? Math.round((value / total) * 100) : 0;
    return (
        <div>
            <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">
                    {value}/{total || 0}
                    <span className="ml-1 text-muted-foreground">
                        ({percent}%)
                    </span>
                </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={`h-full rounded-full ${color} transition-all`}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}

function StatsOverview({ stats }: { stats: MyStats }) {
    const completionRate = stats.papers_attempted
        ? Math.round((stats.papers_completed / stats.papers_attempted) * 100)
        : 0;
    const avgPerAttempt = stats.attempts_count
        ? Math.round(stats.total_study_seconds / stats.attempts_count)
        : 0;

    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricStat
                    icon={<BookCheck className="size-5" />}
                    label="Papers completed"
                    value={stats.papers_completed}
                    hint={`${completionRate}% of ${stats.papers_attempted} practised`}
                    accent="green"
                />
                <MetricStat
                    icon={<Target className="size-5" />}
                    label="Papers practised"
                    value={stats.papers_attempted}
                    hint={`${stats.attempts_count} attempt${stats.attempts_count === 1 ? "" : "s"}`}
                    accent="primary"
                />
                <MetricStat
                    icon={<Timer className="size-5" />}
                    label="Total study time"
                    value={formatDuration(stats.total_study_seconds)}
                    hint={
                        stats.attempts_count
                            ? `~${formatDuration(avgPerAttempt)} / attempt`
                            : "no attempts yet"
                    }
                    accent="blue"
                />
                <MetricStat
                    icon={<PenLine className="size-5" />}
                    label="Answers checked"
                    value={stats.questions_answered}
                    hint={`${stats.reveal_count} reveal${stats.reveal_count === 1 ? "" : "s"}`}
                    accent="amber"
                />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricStat
                    icon={<Flame className="size-5" />}
                    label="Current streak"
                    value={`${stats.current_streak}d`}
                    hint={`best: ${stats.longest_streak}d`}
                    accent="rose"
                />
                <MetricStat
                    icon={<Award className="size-5" />}
                    label="Longest streak"
                    value={`${stats.longest_streak}d`}
                    accent="amber"
                />
                <MetricStat
                    icon={<Clock className="size-5" />}
                    label="Last active"
                    value={relativeTime(stats.last_active_at)}
                    accent="primary"
                />
                <MetricStat
                    icon={<Repeat className="size-5" />}
                    label="Total attempts"
                    value={stats.attempts_count}
                    accent="blue"
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Trophy className="size-4 text-primary" />
                        Practice progress
                    </CardTitle>
                    <CardDescription>
                        Completion rate across every paper you&apos;ve practised
                        in focus mode.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ProgressRow
                        label="Papers completed"
                        value={stats.papers_completed}
                        total={stats.papers_attempted}
                        color="bg-emerald-500"
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function QuickActions() {
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Button asChild variant="outline" className="justify-start">
                <Link to="/search">
                    <Search className="size-4" />
                    Find papers to practise
                </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
                <Link to="/leaderboard">
                    <Trophy className="size-4" />
                    Leaderboard
                </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
                <Link to="/friends">
                    <Users className="size-4" />
                    Friends
                </Link>
            </Button>
            <Button asChild className="justify-start">
                <Link to="/search">
                    <Glasses className="size-4" />
                    Start focus mode
                </Link>
            </Button>
        </div>
    );
}

function RecentAttempts({ attempts }: { attempts: Attempt[] }) {
    if (attempts.length === 0) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                    <Glasses className="size-8" />
                    <p className="text-sm">
                        No practice sessions yet. Open a paper and hit the
                        glasses icon to start focus mode.
                    </p>
                    <Button asChild variant="outline" size="sm" className="mt-2">
                        <Link to="/search">Browse papers</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <History className="size-4 text-primary" />
                    Recent practice
                </CardTitle>
                <CardDescription>
                    Your latest focus-mode sessions.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Paper</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Time</TableHead>
                                <TableHead className="text-right">When</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {attempts.map((a) => (
                                <TableRow key={a.id}>
                                    <TableCell>
                                        <Link
                                            to={`/papers/${a.paper_id}`}
                                            className="font-medium hover:underline"
                                        >
                                            {a.paper?.title ?? "Unavailable paper"}
                                        </Link>
                                        {a.paper?.subject && (
                                            <p className="text-xs text-muted-foreground">
                                                {a.paper.subject}
                                                {a.paper.available === false &&
                                                    " · removed"}
                                            </p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {a.completed
                                            ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                >
                                                    <BookCheck className="size-3" />
                                                    Completed
                                                </Badge>
                                            )
                                            : (
                                                <Badge variant="outline">
                                                    In progress
                                                </Badge>
                                            )}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {formatDuration(a.elapsed_seconds)}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {relativeTime(a.started_at)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

function StarredPapers({
    stars,
    loading,
    onUnstar,
}: {
    stars: StarredPaper[];
    loading: boolean;
    onUnstar: (paperId: string) => void;
}) {
    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner />
            </div>
        );
    }

    if (stars.length === 0) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                    <Star className="size-8" />
                    <p className="text-sm">No starred papers yet.</p>
                    <Button asChild variant="outline" size="sm" className="mt-2">
                        <Link to="/search">Find papers</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {stars.map(({ paper, starred_at }) => (
                <Card key={paper.id}>
                    <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <CardTitle className="line-clamp-2 text-base">
                                    <Link
                                        to={`/papers/${paper.id}`}
                                        className="hover:underline"
                                    >
                                        {paper.title}
                                    </Link>
                                </CardTitle>
                                <CardDescription>
                                    {paper.subject}
                                    {paper.year ? ` · ${paper.year}` : ""}
                                    {starred_at
                                        ? ` · starred ${relativeTime(starred_at)}`
                                        : ""}
                                </CardDescription>
                            </div>
                            <StarPaperButton
                                paperId={paper.id}
                                initialStarred
                                onChange={(starred) => {
                                    if (!starred) onUnstar(paper.id);
                                }}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-1.5">
                        {paper.source && (
                            <Badge variant="secondary" className="uppercase">
                                {paper.source}
                            </Badge>
                        )}
                        <Badge variant="outline">
                            {paper.question_count} questions
                        </Badge>
                        <Badge variant="outline">{paper.total_marks} marks</Badge>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export default function Dashboard() {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [stats, setStats] = useState<MyStats | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);
    const [allUsers, setAllUsers] = useState<AllUserStats[]>([]);
    const [loadingAll, setLoadingAll] = useState(false);
    const [starredPapers, setStarredPapers] = useState<StarredPaper[]>([]);
    const [loadingStars, setLoadingStars] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            navigate("/login?redirect=/dashboard", { replace: true });
        }
    }, [user, authLoading, navigate]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        setLoadingStats(true);
        getMyStats()
            .then((data) => {
                if (!cancelled) setStats(data);
            })
            .catch((e) => {
                if (!cancelled) {
                    toast.error(e instanceof Error ? e.message : "Failed to load stats");
                    setStats({ ...ZERO, user_id: user.user_id, username: user.username });
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingStats(false);
            });
        return () => {
            cancelled = true;
        };
    }, [user]);

    useEffect(() => {
        if (!user?.admin) {
            setAllUsers([]);
            return;
        }
        let cancelled = false;
        setLoadingAll(true);
        getAllUserStats()
            .then((data) => {
                if (!cancelled) setAllUsers(data.users);
            })
            .catch((e) => {
                if (!cancelled) {
                    toast.error(e instanceof Error ? e.message : "Failed to load user stats");
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingAll(false);
            });
        return () => {
            cancelled = true;
        };
    }, [user]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        setLoadingStars(true);
        getStarredPapers()
            .then((data) => {
                if (!cancelled) setStarredPapers(data.stars);
            })
            .catch((e) => {
                if (!cancelled) {
                    toast.error(e instanceof Error ? e.message : "Failed to load starred papers");
                    setStarredPapers([]);
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingStars(false);
            });
        return () => {
            cancelled = true;
        };
    }, [user]);

    if (authLoading) return null;
    if (!user) return null;

    const joined = stats?.joined_at ? new Date(stats.joined_at) : null;

    return (
        <>
            <NavBar />
            <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
                {/* Hero header */}
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <Link to={`/users/${user.username}`}>
                            <Avatar className="size-14 ring-2 ring-primary/20 transition hover:ring-primary/40">
                                <AvatarImage src={user.avatar_url} alt={user.username} />
                                <AvatarFallback className="text-lg">
                                    {user.username?.slice(0, 2).toUpperCase() ?? "U"}
                                </AvatarFallback>
                            </Avatar>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">
                                Welcome back, {user.username}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Track your practice, timing and streaks
                                {joined && (
                                    <>
                                        {" — since "}
                                        {joined.toLocaleDateString(undefined, {
                                            year: "numeric",
                                            month: "short",
                                            day: "numeric",
                                        })}
                                    </>
                                )}
                            </p>
                        </div>
                    </div>
                    {user.admin && (
                        <Badge variant="secondary" className="w-fit gap-1 py-1">
                            <ShieldCheck className="size-3.5 text-primary" />
                            Admin
                        </Badge>
                    )}
                </div>

                <QuickActions />

                <Tabs defaultValue="overview" className="gap-6">
                    <TabsList>
                        <TabsTrigger value="overview">
                            <Trophy data-icon="inline-start" />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="focus">
                            <Glasses data-icon="inline-start" />
                            Focus data
                        </TabsTrigger>
                        <TabsTrigger value="starred">
                            <Star data-icon="inline-start" />
                            Starred
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                        <h2 className="text-lg font-semibold">Your progress</h2>
                        {loadingStats || !stats
                            ? (
                                <div className="flex justify-center py-12">
                                    <Spinner />
                                </div>
                            )
                            : <StatsOverview stats={stats} />}
                    </TabsContent>

                    <TabsContent value="focus" className="space-y-4">
                        <h2 className="text-lg font-semibold">Focus data</h2>
                        {loadingStats || !stats
                            ? (
                                <div className="flex justify-center py-12">
                                    <Spinner />
                                </div>
                            )
                            : <RecentAttempts attempts={stats.recent_attempts ?? []} />}
                    </TabsContent>

                    <TabsContent value="starred" className="space-y-4">
                        <h2 className="text-lg font-semibold">Starred papers</h2>
                        <StarredPapers
                            stars={starredPapers}
                            loading={loadingStars}
                            onUnstar={(paperId) =>
                                setStarredPapers((current) =>
                                    current.filter((item) =>
                                        item.paper.id !== paperId
                                    )
                                )}
                        />
                    </TabsContent>
                </Tabs>

                {/* Admin: all users */}
                {user.admin && (
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="size-5 text-primary" />
                            <h2 className="text-lg font-semibold">All students</h2>
                        </div>
                        <Card>
                            <CardHeader>
                                <CardTitle>Aggregated student stats</CardTitle>
                                <CardDescription>
                                    Everyone, ranked by papers completed then
                                    study time.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {loadingAll
                                    ? (
                                        <div className="flex justify-center py-8">
                                            <Spinner />
                                        </div>
                                    )
                                    : (
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>User</TableHead>
                                                        <TableHead className="text-right">Completed</TableHead>
                                                        <TableHead className="text-right">Practised</TableHead>
                                                        <TableHead className="text-right">Attempts</TableHead>
                                                        <TableHead className="text-right">Answered</TableHead>
                                                        <TableHead className="text-right">Study time</TableHead>
                                                        <TableHead className="text-right">Streak</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {allUsers.map((u) => (
                                                        <TableRow key={u.user_id}>
                                                            <TableCell>
                                                                <div className="flex items-center gap-2">
                                                                    <Avatar className="size-6">
                                                                        <AvatarImage
                                                                            src={u.avatar_url ?? undefined}
                                                                            alt={u.username}
                                                                        />
                                                                        <AvatarFallback className="text-xs">
                                                                            {u.username?.slice(0, 2).toUpperCase()}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <span className="font-medium">
                                                                        {u.username}
                                                                    </span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {u.papers_completed}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {u.papers_attempted}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {u.attempts_count}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {u.questions_answered}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {formatDuration(u.total_study_seconds)}
                                                            </TableCell>
                                                            <TableCell className="text-right tabular-nums">
                                                                {u.current_streak}d
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                            </CardContent>
                        </Card>
                    </section>
                )}
            </main>
        </>
    );
}
