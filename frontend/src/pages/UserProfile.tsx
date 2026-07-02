import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Activity, Clock, FileText, Flame, Trophy } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/api/auth";
import { getUserProfile, type UserProfile as UserProfileData } from "@/api/social";
import NavBar from "@/components/navbar";
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
import { PaperVerifiedBadge } from "@/components/paper-verified-badge";

function formatDuration(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${safe}s`;
}

function StatCard(
    { label, value, icon }: { label: string; value: string | number; icon: ReactNode },
) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    {icon}
                    {label}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
        </Card>
    );
}

export default function UserProfile() {
    const { userId } = useParams<{ userId: string }>();
    const { user, loading: authLoading } = useAuth();
    const [profile, setProfile] = useState<UserProfileData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading || !userId) return;

        setLoading(true);
        getUserProfile(userId)
            .then(setProfile)
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : "Failed to load profile",
                );
                setProfile(null);
            })
            .finally(() => setLoading(false));
    }, [authLoading, userId]);

    if (authLoading) return null;

    return (
        <>
            <NavBar />
            <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
                {loading
                    ? (
                        <div className="flex justify-center py-16">
                            <Spinner />
                        </div>
                    )
                    : !profile
                    ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>Profile unavailable</CardTitle>
                                <CardDescription>
                                    This profile either does not exist or is not
                                    visible to you.
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    )
                    : (
                        <>
                            <Card>
                                <CardHeader>
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex min-w-0 items-center gap-4">
                                            <Avatar className="size-16">
                                                <AvatarImage
                                                    src={profile.user.avatar_url ?? undefined}
                                                    alt={profile.user.username}
                                                />
                                                <AvatarFallback>
                                                    {profile.user.username
                                                        .slice(0, 2)
                                                        .toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <CardTitle className="truncate text-2xl">
                                                    {profile.user.username}
                                                </CardTitle>
                                                <CardDescription>
                                                    Joined{" "}
                                                    {profile.user.created_at
                                                        ? new Date(
                                                            profile.user.created_at,
                                                        ).toLocaleDateString()
                                                        : "recently"}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {user?.user_id === profile.user.user_id && (
                                                <Button
                                                    asChild
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <Link to="/settings">Edit profile</Link>
                                                </Button>
                                            )}
                                            <Badge
                                                variant={profile.presence?.online
                                                    ? "secondary"
                                                    : "outline"}
                                            >
                                                {profile.presence?.online
                                                    ? `Online for ${
                                                        formatDuration(
                                                            profile.presence
                                                                .seconds_on_site,
                                                        )
                                                    }`
                                                    : "Offline"}
                                            </Badge>
                                            {profile.presence?.active_paper && (
                                                <Button
                                                    asChild
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <Link
                                                        to={`/papers/${profile.presence.active_paper.id}`}
                                                    >
                                                        Working on{" "}
                                                        {profile.presence
                                                            .active_paper.title}
                                                    </Link>
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                            </Card>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <StatCard
                                    label="Completed"
                                    value={profile.stats.papers_completed}
                                    icon={<Trophy data-icon="inline-start" />}
                                />
                                <StatCard
                                    label="Practised"
                                    value={profile.stats.papers_attempted}
                                    icon={<FileText data-icon="inline-start" />}
                                />
                                <StatCard
                                    label="Study time"
                                    value={formatDuration(
                                        profile.stats.total_study_seconds,
                                    )}
                                    icon={<Clock data-icon="inline-start" />}
                                />
                                <StatCard
                                    label="Current streak"
                                    value={`${profile.stats.current_streak}d`}
                                    icon={<Flame data-icon="inline-start" />}
                                />
                            </div>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Activity data-icon="inline-start" />
                                        Practice stats
                                    </CardTitle>
                                    <CardDescription>
                                        Focus-mode activity from this account.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-3 sm:grid-cols-3">
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            Attempts
                                        </p>
                                        <p className="text-xl font-semibold">
                                            {profile.stats.attempts_count}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            Answers checked
                                        </p>
                                        <p className="text-xl font-semibold">
                                            {profile.stats.questions_answered}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            Longest streak
                                        </p>
                                        <p className="text-xl font-semibold">
                                            {profile.stats.longest_streak}d
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Public papers</CardTitle>
                                    <CardDescription>
                                        {profile.public_papers.length === 0
                                            ? "No public papers yet."
                                            : `${profile.public_papers.length} public paper${
                                                profile.public_papers.length === 1
                                                    ? ""
                                                    : "s"
                                            }`}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-3 sm:grid-cols-2">
                                    {profile.public_papers.map((paper) => (
                                        <div
                                            key={paper.id}
                                            className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3"
                                        >
                                            <Link
                                                to={`/papers/${paper.id}`}
                                                className="min-w-0 truncate text-sm font-medium hover:underline"
                                            >
                                                {paper.title}
                                            </Link>
                                            <PaperVerifiedBadge paper={paper} />
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </>
                    )}
            </main>
        </>
    );
}
