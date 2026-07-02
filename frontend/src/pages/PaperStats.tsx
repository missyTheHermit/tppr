import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    BarChart3,
    Clock,
    Star,
    Target,
    TrendingUp,
    Users,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
} from "recharts";

import NavBar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { getAuthorStats, type AuthorStats } from "@/api/stats";

function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
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

const PIE_COLORS = ["#10b981", "#e5e7eb"];

export default function PaperStats() {
    const { id: paperId } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [stats, setStats] = useState<AuthorStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ code: number; message: string } | null>(null);

    useEffect(() => {
        if (!paperId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);

        getAuthorStats(paperId)
            .then((data) => {
                if (!cancelled) setStats(data);
            })
            .catch((e) => {
                if (!cancelled) {
                    const msg = e instanceof Error ? e.message : "Failed to load stats";
                    // Determine error code from message or default to 500
                    let code = 500;
                    if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) {
                        code = 403;
                    } else if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
                        code = 404;
                    }
                    setError({ code, message: msg });
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [paperId]);

    // --- Error state ---
    if (error) {
        return (
            <>
                <NavBar />
                <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
                    <Button
                        variant="ghost"
                        className="gap-2"
                        onClick={() => navigate(`/papers/${paperId}`)}
                    >
                        <ArrowLeft className="size-4" />
                        Back to paper
                    </Button>
                    <Card className="border-destructive/50">
                        <CardHeader>
                            <CardTitle className="text-destructive">
                                {error.code === 403
                                    ? "Access Denied"
                                    : error.code === 404
                                    ? "Not Found"
                                    : "Error"}
                            </CardTitle>
                            <CardDescription>
                                {error.code === 403
                                    ? "Only the paper's author can view these statistics."
                                    : error.code === 404
                                    ? "This paper could not be found."
                                    : error.message}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button
                                variant="outline"
                                onClick={() => navigate(`/papers/${paperId}`)}
                            >
                                <ArrowLeft className="size-4" />
                                Back to paper
                            </Button>
                        </CardContent>
                    </Card>
                </main>
            </>
        );
    }

    // --- Loading state ---
    if (loading || !stats) {
        return (
            <>
                <NavBar />
                <main className="flex justify-center py-24">
                    <Spinner />
                </main>
            </>
        );
    }

    // --- Data for charts ---
    const completedAttempts = Math.round(stats.total_attempts * stats.completion_rate);

    const barData = [
        { name: "Total Attempts", value: stats.total_attempts },
        { name: "Unique Attempters", value: stats.unique_attempters },
        { name: "Completed", value: completedAttempts },
    ];

    const completionPercent = Math.round(stats.completion_rate * 100);
    const pieData = [
        { name: "Completed", value: completedAttempts },
        { name: "Incomplete", value: stats.total_attempts - completedAttempts },
    ];

    return (
        <>
            <NavBar />
            <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(`/papers/${paperId}`)}
                    >
                        <ArrowLeft className="size-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            Paper Statistics
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Engagement and performance data for your paper
                        </p>
                    </div>
                </div>

                {/* Stat cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricStat
                        icon={<BarChart3 className="size-5" />}
                        label="Total attempts"
                        value={stats.total_attempts}
                        hint="All practice sessions"
                        accent="primary"
                    />
                    <MetricStat
                        icon={<Users className="size-5" />}
                        label="Unique attempters"
                        value={stats.unique_attempters}
                        hint="Distinct users"
                        accent="blue"
                    />
                    <MetricStat
                        icon={<Star className="size-5" />}
                        label="Star count"
                        value={stats.star_count}
                        hint="Users who starred"
                        accent="amber"
                    />
                    <MetricStat
                        icon={<Clock className="size-5" />}
                        label="Avg. completion time"
                        value={
                            stats.average_completion_seconds != null
                                ? formatDuration(stats.average_completion_seconds)
                                : "—"
                        }
                        hint={
                            stats.average_reveal_count != null
                                ? `${stats.average_reveal_count.toFixed(1)} avg reveals`
                                : undefined
                        }
                        accent="green"
                    />
                </div>

                {/* Charts section */}
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Bar chart: attempt metrics */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Target className="size-4 text-primary" />
                                Attempt Metrics
                            </CardTitle>
                            <CardDescription>
                                Total attempts, unique users, and completed sessions
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 12 }}
                                        className="text-muted-foreground"
                                    />
                                    <YAxis
                                        allowDecimals={false}
                                        tick={{ fontSize: 12 }}
                                        className="text-muted-foreground"
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: "0.5rem",
                                            border: "1px solid hsl(var(--border))",
                                            backgroundColor: "hsl(var(--card))",
                                        }}
                                    />
                                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {/* Pie chart: completion rate */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="size-4 text-primary" />
                                Completion Rate
                            </CardTitle>
                            <CardDescription>
                                {completionPercent}% of attempts completed ({completedAttempts} of{" "}
                                {stats.total_attempts})
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, percent }) =>
                                            `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                                        }
                                    >
                                        {pieData.map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: "0.5rem",
                                            border: "1px solid hsl(var(--border))",
                                            backgroundColor: "hsl(var(--card))",
                                        }}
                                    />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </>
    );
}
