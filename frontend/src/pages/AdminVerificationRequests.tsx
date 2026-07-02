import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
    CheckCircle2,
    ChevronDown,
    ExternalLink,
    Filter,
    Search as SearchIcon,
    X,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
    getVerificationRequests,
    resolveVerificationRequest,
    type AdminVerificationRequest,
} from "@/api/admin";
import { useAuth } from "@/api/auth";
import NavBar from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { GenericError } from "@/pages/errors/GenericError";

const PER_PAGE = 20;

function formatDate(value: string) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

export default function AdminVerificationRequests() {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [query, setQuery] = useState(searchParams.get("q") ?? "");
    const [status, setStatus] = useState(searchParams.get("status") ?? "pending");
    const [requests, setRequests] = useState<AdminVerificationRequest[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
    const [loading, setLoading] = useState(true);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil(total / PER_PAGE)),
        [total],
    );

    const hasActiveFilters = Boolean(query) || status !== "pending";

    async function load(nextPage = page, nextQuery = query, nextStatus = status) {
        setLoading(true);
        try {
            const data = await getVerificationRequests({
                q: nextQuery || undefined,
                status: nextStatus,
                page: nextPage,
                per_page: PER_PAGE,
            });
            setRequests(data.requests);
            setTotal(data.total);
            setPage(data.page);
        } catch {
            toast.error("Failed to load verification requests");
            setRequests([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (authLoading || !user?.admin) return;
        const nextQuery = searchParams.get("q") ?? "";
        const nextStatus = searchParams.get("status") ?? "pending";
        const nextPage = Number(searchParams.get("page")) || 1;
        setQuery(nextQuery);
        setStatus(nextStatus);
        void load(nextPage, nextQuery, nextStatus);
    }, [authLoading, user?.admin, searchParams.toString()]);

    function updateSearchParams(
        nextPage: number,
        nextQuery = query,
        nextStatus = status,
    ) {
        const params = new URLSearchParams();
        if (nextQuery) params.set("q", nextQuery);
        params.set("status", nextStatus);
        params.set("page", String(nextPage));
        setSearchParams(params);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        updateSearchParams(1);
        setFiltersOpen(false);
    }

    function clearFilters() {
        setQuery("");
        setStatus("pending");
        updateSearchParams(1, "", "pending");
    }

    async function handleResolve(
        request: AdminVerificationRequest,
        nextStatus: "approved" | "rejected",
    ) {
        setResolvingId(request.id);
        try {
            await resolveVerificationRequest(request.id, { status: nextStatus });
            toast.success(
                nextStatus === "approved"
                    ? "Paper verified"
                    : "Verification request rejected",
            );
            await load(page, query, status);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to resolve verification request",
            );
        } finally {
            setResolvingId(null);
        }
    }

    if (authLoading) {
        return (
            <>
                <NavBar />
                <main className="flex items-center justify-center py-24">
                    <Spinner className="size-8" />
                </main>
            </>
        );
    }

    if (!user?.admin) {
        return (
            <GenericError
                code={403}
                title="Admin access required"
                message="This dashboard is only available while admin mode is active."
                showNav={true}
            />
        );
    }

    return (
        <>
            <NavBar />
            <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="text-primary" />
                        <h1 className="text-2xl font-bold">
                            Verification Requests
                        </h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {total} request{total === 1 ? "" : "s"}
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <CardTitle>Submitted Papers</CardTitle>
                                <CardDescription>
                                    Review owner-submitted sources and mark papers as verified.
                                </CardDescription>
                            </div>
                            {/* Inline status badge + compact filter toggle */}
                            <div className="flex items-center gap-2">
                                <Badge variant={status === "pending" ? "outline" : "secondary"}>
                                    {status}
                                </Badge>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setFiltersOpen((v) => !v)}
                                    className="relative"
                                >
                                    <Filter className="mr-1.5 size-4" />
                                    Filters
                                    {hasActiveFilters && (
                                        <span className="ml-1.5 flex size-2 rounded-full bg-primary" />
                                    )}
                                    <ChevronDown
                                        className={`ml-1.5 size-4 transition-transform ${
                                            filtersOpen ? "rotate-180" : ""
                                        }`}
                                    />
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {/* Collapsible filter controls */}
                        {filtersOpen && (
                            <form
                                onSubmit={handleSubmit}
                                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row"
                            >
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search requests..."
                                    className="sm:max-w-md"
                                />
                                <Select value={status} onValueChange={setStatus}>
                                    <SelectTrigger className="sm:w-40">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="approved">Approved</SelectItem>
                                        <SelectItem value="rejected">Rejected</SelectItem>
                                        <SelectItem value="all">All</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="flex gap-2">
                                    <Button type="submit" disabled={loading}>
                                        <SearchIcon data-icon="inline-start" />
                                        Search
                                    </Button>
                                    {hasActiveFilters && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={clearFilters}
                                            disabled={loading && !query}
                                        >
                                            <X className="size-4" />
                                            Clear
                                        </Button>
                                    )}
                                </div>
                            </form>
                        )}

                        {loading
                            ? (
                                <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
                                    <Spinner className="size-8" />
                                    <p>Loading requests...</p>
                                </div>
                            )
                            : requests.length === 0
                            ? (
                                <div className="py-20 text-center">
                                    <p className="font-medium">
                                        No verification requests found.
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Try a different search or status.
                                    </p>
                                </div>
                            )
                            : (
                                <>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Paper</TableHead>
                                                <TableHead>Source</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Submitted</TableHead>
                                                <TableHead className="text-right">
                                                    Actions
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {requests.map((request) => (
                                                <TableRow key={request.id}>
                                                    <TableCell>
                                                        <div className="flex max-w-md flex-col gap-1">
                                                            <Link
                                                                to={`/papers/${request.paper_id}`}
                                                                className="font-medium hover:underline"
                                                            >
                                                                {request.paper?.title ?? request.paper_id}
                                                            </Link>
                                                            <span className="truncate text-xs text-muted-foreground">
                                                                {request.paper?.subject ?? "Unknown subject"}
                                                            </span>
                                                            {request.note && (
                                                                <span className="text-xs text-muted-foreground">
                                                                    {request.note}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            {request.source_url
                                                                ? (
                                                                    <a
                                                                        href={request.source_url}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="font-medium underline"
                                                                    >
                                                                        {request.source_name}
                                                                    </a>
                                                                )
                                                                : (
                                                                    <span className="font-medium">
                                                                        {request.source_name}
                                                                    </span>
                                                                )}
                                                            <span className="text-xs text-muted-foreground">
                                                                {request.requester_id}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant={request.status === "pending" ? "outline" : "secondary"}>
                                                            {request.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {formatDate(request.created_at)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex justify-end gap-2">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label="Open paper"
                                                                onClick={() =>
                                                                    navigate(
                                                                        `/papers/${request.paper_id}`,
                                                                    )}
                                                            >
                                                                <ExternalLink />
                                                            </Button>
                                                            {request.status === "pending" && (
                                                                <>
                                                                    <Button
                                                                        variant="outline"
                                                                        size="sm"
                                                                        disabled={resolvingId === request.id}
                                                                        onClick={() =>
                                                                            handleResolve(
                                                                                request,
                                                                                "rejected",
                                                                            )}
                                                                    >
                                                                        <XCircle data-icon="inline-start" />
                                                                        Reject
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        disabled={resolvingId === request.id}
                                                                        onClick={() =>
                                                                            handleResolve(
                                                                                request,
                                                                                "approved",
                                                                            )}
                                                                    >
                                                                        <CheckCircle2 data-icon="inline-start" />
                                                                        Approve
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>

                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={page <= 1}
                                                onClick={() =>
                                                    updateSearchParams(page - 1)}
                                            >
                                                Previous
                                            </Button>
                                            <span className="text-sm text-muted-foreground">
                                                Page {page} of {totalPages}
                                            </span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={page >= totalPages}
                                                onClick={() =>
                                                    updateSearchParams(page + 1)}
                                            >
                                                Next
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                    </CardContent>
                </Card>
            </main>
        </>
    );
}