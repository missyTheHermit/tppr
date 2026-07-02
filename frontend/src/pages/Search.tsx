import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import NavBar from "@/components/navbar";
import type { PaperMeta } from "@/types/tppr-paper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AllNESASubjectsList } from "@/lib/subjects";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Clock, Globe, Search as SearchIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { type SearchFilters, searchPapers } from "@/lib/paper";
import { StarPaperButton } from "@/components/star-paper-button";
import { PaperVerifiedBadge } from "@/components/paper-verified-badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { SlidersHorizontal, X } from "lucide-react";

const SUBJECTS_WITH_LEVELS = new Set([
    "Mathematics",
    "English",
]);

export default function Search() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [q, setQ] = useState(searchParams.get("q") ?? "");
    const [subject, setSubject] = useState(
        searchParams.get("subject") ?? "all",
    );
    const [source, setSource] = useState(searchParams.get("source") ?? "all");
    const [courseLevel, setCourseLevel] = useState(
        searchParams.get("course_level") ?? "all",
    );
    const [year, setYear] = useState(searchParams.get("year") ?? "");
    const [verified, setVerified] = useState(
        searchParams.get("verified") ?? "all",
    );
    const [school, setSchool] = useState(searchParams.get("school") ?? "");
    const [topic, setTopic] = useState(searchParams.get("topic") ?? "");
    const [outcome, setOutcome] = useState(searchParams.get("outcome") ?? "");
    const [minMarks, setMinMarks] = useState(
        searchParams.get("min_marks") ?? "",
    );
    const [maxMarks, setMaxMarks] = useState(
        searchParams.get("max_marks") ?? "",
    );
    const [minDuration, setMinDuration] = useState(
        searchParams.get("min_duration") ?? "",
    );
    const [maxDuration, setMaxDuration] = useState(
        searchParams.get("max_duration") ?? "",
    );

    const [papers, setPapers] = useState<PaperMeta[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    const showCourseLevel = subject !== "all" &&
        SUBJECTS_WITH_LEVELS.has(subject);

    async function doSearch(pageNum = 1) {
        setLoading(true);
        setSearched(true);
        const filters: SearchFilters = {
            q: q || undefined,
            subject: subject && subject !== "all" ? subject : undefined,
            source: source && source !== "all" ? source : undefined,
            course_level: courseLevel && courseLevel !== "all"
                ? courseLevel
                : undefined,
            year: year || undefined,
            verified: verified !== "all" ? verified : undefined,
            school: school || undefined,
            topic: topic || undefined,
            outcome: outcome || undefined,
            min_marks: minMarks || undefined,
            max_marks: maxMarks || undefined,
            min_duration: minDuration || undefined,
            max_duration: maxDuration || undefined,
            page: pageNum,
            per_page: 20,
        };

        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== "") {
                params.set(key, String(value));
            }
        }
        setSearchParams(params, { replace: true });

        try {
            const data = await searchPapers(filters);
            setPapers(data.papers);
            setTotal(data.total);
            setPage(data.page);
        } catch {
            setPapers([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (searchParams.toString()) {
            setQ(searchParams.get("q") ?? "");
            setSubject(searchParams.get("subject") ?? "all");
            setSource(searchParams.get("source") ?? "all");
            setCourseLevel(searchParams.get("course_level") ?? "all");
            setYear(searchParams.get("year") ?? "");
            setVerified(searchParams.get("verified") ?? "all");
            setSchool(searchParams.get("school") ?? "");
            setTopic(searchParams.get("topic") ?? "");
            setOutcome(searchParams.get("outcome") ?? "");
            setMinMarks(searchParams.get("min_marks") ?? "");
            setMaxMarks(searchParams.get("max_marks") ?? "");
            setMinDuration(searchParams.get("min_duration") ?? "");
            setMaxDuration(searchParams.get("max_duration") ?? "");
            doSearch(Number(searchParams.get("page")) || 1);
        }
    }, [searchParams.toString()]);

    function handleSubmit(e: React.SubmitEvent) {
        e.preventDefault();
        doSearch(1);
    }

    function clearFilters() {
        setQ("");
        setSubject("all");
        setSource("all");
        setCourseLevel("all");
        setYear("");
        setVerified("all");
        setSchool("");
        setTopic("");
        setOutcome("");
        setMinMarks("");
        setMaxMarks("");
        setMinDuration("");
        setMaxDuration("");
    }

    const activeFilterCount = [
        subject !== "all",
        courseLevel !== "all",
        source !== "all",
        Boolean(year),
        verified !== "all",
        Boolean(school),
        Boolean(topic),
        Boolean(outcome),
        Boolean(minMarks),
        Boolean(maxMarks),
        Boolean(minDuration),
        Boolean(maxDuration),
    ].filter(Boolean).length;

    const hasActiveFilters = activeFilterCount > 0;

    return (
        <>
            <NavBar />
            <main className="mx-auto w-full max-w-6xl px-6 py-8">
                <h1 className="mb-6 text-2xl font-bold">Search Papers</h1>

                <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-4">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Search by title or subject…"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            className="flex-1"
                        />
                        <Button type="submit" disabled={loading}>
                            <SearchIcon className="mr-2 size-4" />
                            Search
                        </Button>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="relative"
                                >
                                    <SlidersHorizontal className="mr-2 size-4" />
                                    Filters
                                    {activeFilterCount > 0 && (
                                        <Badge
                                            variant="default"
                                            className="ml-2"
                                        >
                                            {activeFilterCount}
                                        </Badge>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                align="end"
                                className="w-80 sm:w-96"
                            >
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">
                                            Filters
                                        </span>
                                        {hasActiveFilters && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={clearFilters}
                                                className="h-7 text-xs"
                                            >
                                                <X className="mr-1 size-3" />
                                                Clear filters
                                            </Button>
                                        )}
                                    </div>

                                    {/* Group 1: Core */}
                                    <div className="flex flex-col gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Core
                                        </span>
                                        <Select value={subject} onValueChange={setSubject}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Subject" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Any subject</SelectItem>
                                                <AllNESASubjectsList />
                                            </SelectContent>
                                        </Select>

                                        {showCourseLevel && (
                                            <Select
                                                value={courseLevel}
                                                onValueChange={setCourseLevel}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="Level" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">
                                                        Any level
                                                    </SelectItem>
                                                    <SelectItem value="standard">
                                                        Standard
                                                    </SelectItem>
                                                    <SelectItem value="advanced">
                                                        Advanced
                                                    </SelectItem>
                                                    <SelectItem value="extension_1">
                                                        Extension 1
                                                    </SelectItem>
                                                    <SelectItem value="extension_2">
                                                        Extension 2
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}

                                        <Select value={source} onValueChange={setSource}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Source" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">Any source</SelectItem>
                                                <SelectItem value="hsc">HSC</SelectItem>
                                                <SelectItem value="trial">Trial</SelectItem>
                                                <SelectItem value="internal">
                                                    Internal
                                                </SelectItem>
                                                <SelectItem value="practice">
                                                    Practice
                                                </SelectItem>
                                                <SelectItem value="custom">Custom</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        <Input
                                            type="number"
                                            placeholder="Year"
                                            value={year}
                                            onChange={(e) => setYear(e.target.value)}
                                            min={2000}
                                        />

                                        <Select value={verified} onValueChange={setVerified}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Verification" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    Any verification
                                                </SelectItem>
                                                <SelectItem value="true">Verified</SelectItem>
                                                <SelectItem value="false">Unverified</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Group 2: Details */}
                                    <div className="flex flex-col gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Details
                                        </span>
                                        <Input
                                            placeholder="School"
                                            value={school}
                                            onChange={(e) => setSchool(e.target.value)}
                                        />
                                        <Input
                                            placeholder="Topic"
                                            value={topic}
                                            onChange={(e) => setTopic(e.target.value)}
                                        />
                                        <Input
                                            placeholder="Outcome"
                                            value={outcome}
                                            onChange={(e) => setOutcome(e.target.value)}
                                        />
                                    </div>

                                    {/* Group 3: Ranges */}
                                    <div className="flex flex-col gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Ranges
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                type="number"
                                                placeholder="Min marks"
                                                value={minMarks}
                                                onChange={(e) => setMinMarks(e.target.value)}
                                                min={0}
                                            />
                                            <Input
                                                type="number"
                                                placeholder="Max marks"
                                                value={maxMarks}
                                                onChange={(e) => setMaxMarks(e.target.value)}
                                                min={0}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                type="number"
                                                placeholder="Min duration"
                                                value={minDuration}
                                                onChange={(e) => setMinDuration(e.target.value)}
                                                min={0}
                                            />
                                            <Input
                                                type="number"
                                                placeholder="Max duration"
                                                value={maxDuration}
                                                onChange={(e) => setMaxDuration(e.target.value)}
                                                min={0}
                                            />
                                        </div>
                                    </div>

                                    <Button type="submit" disabled={loading}>
                                        <SearchIcon className="mr-2 size-4" />
                                        Apply
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </form>

                {loading
                    ? (
                        <div className="flex flex-col items-center gap-2 py-24 text-muted-foreground">
                            <Spinner className="size-8" />
                            <p>Searching…</p>
                        </div>
                    )
                    : !searched
                    ? (
                        <p className="py-24 text-center text-muted-foreground">
                            Use the search bar above to find public papers.
                        </p>
                    )
                    : papers.length === 0
                    ? (
                        <div className="py-24 text-center">
                            <p className="text-muted-foreground">
                                No papers found matching your criteria.
                            </p>
                            <p className="mt-2 text-sm italic text-muted-foreground">
                                You should consider making your own paper for
                                the world to see...
                            </p>
                        </div>
                    )
                    : (
                        <>
                            <p className="mb-4 text-sm text-muted-foreground">
                                {total} result{total === 1 ? "" : "s"}
                            </p>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {papers.map((paper) => (
                                    <Card
                                        key={paper.id}
                                        className="cursor-pointer transition-shadow hover:shadow-md"
                                        onClick={() =>
                                            navigate(`/papers/${paper.id}`)}
                                    >
                                        <CardHeader>
                                            <div className="flex items-start justify-between gap-2">
                                                <CardTitle className="line-clamp-2 text-base">
                                                    {paper.title}
                                                </CardTitle>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <StarPaperButton paperId={paper.id} />
                                                    <PaperVerifiedBadge paper={paper} />
                                                    <Globe className="size-4 text-muted-foreground" />
                                                </div>
                                            </div>
                                            <CardDescription>
                                                {paper.subject}
                                                {paper.year
                                                    ? ` · ${paper.year}`
                                                    : ""}
                                                {paper.school
                                                    ? ` · ${paper.school}`
                                                    : ""}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="flex flex-wrap gap-1.5">
                                            {paper.source && (
                                                <Badge
                                                    variant="secondary"
                                                    className="uppercase"
                                                >
                                                    {paper.source}
                                                </Badge>
                                            )}
                                            {paper.course_level && (
                                                <Badge variant="outline">
                                                    {paper.course_level.replace(
                                                        "_",
                                                        " ",
                                                    )}
                                                </Badge>
                                            )}
                                            <Badge variant="outline">
                                                {paper.question_count} questions
                                            </Badge>
                                            <Badge variant="outline">
                                                {paper.total_marks} marks
                                            </Badge>
                                            {paper.duration_minutes
                                                ? (
                                                    <Badge variant="outline">
                                                        <Clock className="mr-1 size-3" />
                                                        {paper.duration_minutes}
                                                        {" "}
                                                        min
                                                    </Badge>
                                                )
                                                : null}
                                            {paper.topics?.slice(0, 3).map((
                                                topic,
                                            ) => (
                                                <Badge
                                                    key={`topic-${topic}`}
                                                    variant="outline"
                                                >
                                                    {topic}
                                                </Badge>
                                            ))}
                                            {paper.topics &&
                                                paper.topics.length > 3 && (
                                                <Badge variant="outline">
                                                    +{paper.topics.length - 3}
                                                    {" "}
                                                    topics
                                                </Badge>
                                            )}
                                            {paper.outcomes?.slice(0, 2).map((
                                                outcome,
                                            ) => (
                                                <Badge
                                                    key={`outcome-${outcome}`}
                                                    variant="secondary"
                                                >
                                                    {outcome}
                                                </Badge>
                                            ))}
                                            {paper.outcomes &&
                                                paper.outcomes.length > 2 && (
                                                <Badge variant="secondary">
                                                    +{paper.outcomes.length - 2}
                                                    {" "}
                                                    outcomes
                                                </Badge>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {total > 20 && (
                                <div className="mt-6 flex justify-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={page <= 1}
                                        onClick={() => doSearch(page - 1)}
                                    >
                                        Previous
                                    </Button>
                                    <span className="flex items-center px-3 text-sm text-muted-foreground">
                                        Page {page} of {Math.ceil(total / 20)}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={page >= Math.ceil(total / 20)}
                                        onClick={() => doSearch(page + 1)}
                                    >
                                        Next
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
            </main>
        </>
    );
}