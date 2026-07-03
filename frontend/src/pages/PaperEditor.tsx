import {
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
    createQuestion,
    paperStore,
    withRecalculatedTotals,
} from "@/lib/paper";
import { getPapers, remixQuestionIntoPaper } from "@/api/papers";
import { apiFetch } from "@/api/client";
import type {
    Paper,
    PaperMeta,
    Question as QuestionData,
} from "@/types/tppr-paper";
import NavBar from "@/components/navbar";
import { Question } from "@/components/question";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    ArrowLeft,
    Check,
    CloudOff,
    CloudUpload,
    Download,
    Glasses,
    Loader2,
    Plus,
    Shell,
} from "lucide-react";
import { QuestionEditor } from "@/components/question-editor";
import { EditableNumber } from "@/components/editable-number";
import { toast } from "sonner";
import { useAuth } from "@/api/auth";
import Unauthorized from "./errors/Unauthorised";
import { PaperSettings } from "@/components/paper-settings";
import { syncService } from "@/lib/cloud";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSyncStatus } from "@/lib/hooks";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Takendown } from "./errors/Takendown";
import { GenericError } from "./errors/GenericError";
import { FocusMode } from "@/components/focus-mode";
import { StarPaperButton } from "@/components/star-paper-button";
import { ReportPaperButton } from "@/components/report-paper-button";
import { PaperVerifiedBadge } from "@/components/paper-verified-badge";

const EDITOR_MIN_WIDTH = 384;
const EDITOR_DEFAULT_WIDTH = 448;
const EDITOR_MAX_MARGIN = 96;
const EDITOR_KEYBOARD_STEP = 48;

type RemixTargetPaper = PaperMeta & { isLocal?: boolean };

function clampEditorWidth(width: number) {
    const viewportMax = typeof window === "undefined"
        ? 896
        : Math.max(EDITOR_MIN_WIDTH, window.innerWidth - EDITOR_MAX_MARGIN);
    return Math.min(Math.max(width, EDITOR_MIN_WIDTH), viewportMax);
}

export default function PaperEditor() {
    const { id } = useParams<{ id: string }>();
    const [paper, setPaper] = useState<Paper | null>(null);
    const paperRef = useRef<Paper | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingStep, setLoadingStep] = useState("");
    const paperId = paper?.id;
    const questionCount = paper?.questions.length;

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorWidth, setEditorWidth] = useState(EDITOR_DEFAULT_WIDTH);
    const selected = paper?.questions.find((q) => q.id === selectedId) ?? null;

    const location = useLocation();
    const navigate = useNavigate();
    const [syncing, setSyncing] = useState(false);

    const { user, loading: authLoading } = useAuth();

    const [authorName, setAuthorName] = useState<string | null>(null);
    const isOwner = !!user && String(user.user_id) === paper?.author_id;
    const authorId = paper?.author_id;

    const [remixSource, setRemixSource] = useState<
        { title: string; author: string } | null
    >(null);

    const [showSaveHint, setShowSaveHint] = useState(false);
    const [showExportDialog, setShowExportDialog] = useState(false);
    const saveCountRef = useRef(0);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

    const [takenDown, setTakenDown] = useState(false);

    const [focusMode, setFocusMode] = useState(false);
    const [questionRemixId, setQuestionRemixId] = useState<string | null>(null);
    const [targetPapers, setTargetPapers] = useState<RemixTargetPaper[]>([]);
    const [targetPaperId, setTargetPaperId] = useState<string>("");
    const [loadingTargets, setLoadingTargets] = useState(false);
    const [addingQuestionRemix, setAddingQuestionRemix] = useState(false);
    const [remixing, setRemixing] = useState(false);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                saveCountRef.current += 1;

                // Reset counter after 3s of no presses
                if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                saveTimerRef.current = setTimeout(() => {
                    saveCountRef.current = 0;
                }, 3000);

                if (saveCountRef.current >= 10) {
                    saveCountRef.current = 0;
                    setShowSaveHint(false);
                    setShowExportDialog(true);
                } else {
                    setShowSaveHint(true);
                    setTimeout(() => setShowSaveHint(false), 2500);
                }
            }
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    function handleExportJson() {
        if (!paper) return;
        const blob = new Blob([JSON.stringify(paper, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${paper.title.replace(/[^a-z0-9]/gi, "_")}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExportDialog(false);
    }

    const syncStatus = useSyncStatus();

    useEffect(() => {
        paperRef.current = paper;
    }, [paper]);

    useEffect(() => {
        if (loading || !paperId || !location.hash) return;

        const targetId = decodeURIComponent(location.hash.slice(1));
        let cancelled = false;
        const timeouts: ReturnType<typeof setTimeout>[] = [];
        let frame = 0;

        function scrollToHash() {
            if (cancelled) return true;
            const element = document.getElementById(targetId);
            if (!element) return false;
            element.scrollIntoView({ behavior: "smooth", block: "start" });
            return true;
        }

        frame = requestAnimationFrame(() => {
            if (scrollToHash()) return;
            for (const delay of [75, 250, 600]) {
                timeouts.push(setTimeout(scrollToHash, delay));
            }
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            for (const timeout of timeouts) clearTimeout(timeout);
        };
    }, [loading, location.hash, paperId, questionCount]);

    useEffect(() => {
        if (!paper?.remixed) return;
        apiFetch(`/api/papers/${paper.remixed}`)
            .then((res) => res.ok ? res.json() : Promise.reject())
            .then(async (data) => {
                const authorRes = await fetch(
                    `/api/whotf?user_id=${data.author_id}`,
                );
                const authorData = await authorRes.json();
                setRemixSource({
                    title: data.title,
                    author: authorData.username ?? "Unknown",
                });
            })
            .catch(() => setRemixSource(null));
    }, [paper?.remixed]);

    useEffect(() => {
        if (!authorId) return;
        fetch(`/api/whotf?user_id=${authorId}`)
            .then((res) => res.ok ? res.json() : Promise.reject())
            .then((data) => setAuthorName(data.username))
            .catch(() => setAuthorName("Unknown"));
    }, [authorId]);

    useEffect(() => {
        if (!questionRemixId || !user) return;

        const userId = String(user.user_id);
        let cancelled = false;

        async function loadTargets() {
            setLoadingTargets(true);
            setTargetPaperId("");
            try {
                const [remote, local] = await Promise.all([
                    getPapers().catch(() => [] as PaperMeta[]),
                    paperStore.listPapers().catch(() => []),
                ]);

                const merged = new Map<string, RemixTargetPaper>();
                for (const p of remote) merged.set(p.id, p);
                for (const p of local) {
                    merged.set(p.id, { ...p, isLocal: true });
                }

                const targets = [...merged.values()]
                    .filter((p) =>
                        p.author_id === userId && p.visibility !== "removed"
                    )
                    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

                if (cancelled) return;
                setTargetPapers(targets);
                setTargetPaperId(targets[0]?.id ?? "");
            } finally {
                if (!cancelled) setLoadingTargets(false);
            }
        }

        void loadTargets();
        return () => {
            cancelled = true;
        };
    }, [questionRemixId, user]);

    useEffect(() => {
        if (!id || authLoading) return;
        async function load() {
            setTakenDown(false);
            setPaper(null);
            setLoading(true);
            setLoadingStep("Fetching from server…");
            try {
                const res = await apiFetch(`/api/papers/${id}`, {
                    cache: "no-store",
                });
                if (res.status === 410) {
                    setLoadingStep("Paper was removed…");
                    await paperStore.deletePaper(id!);
                    setTakenDown(true);
                    return;
                }
                if (res.ok) {
                    setLoadingStep("Reading paper data…");
                    const data = await res.json();
                    setPaper(data);
                    setLoadingStep("Saving to local cache…");
                    await paperStore.savePaper(data);
                    return;
                }
                if (res.status === 404) {
                    setLoadingStep("Checking local storage…");
                    const local = await paperStore.getPaper(id!);
                    if (local) {
                        setPaper(local);
                        if (
                            user &&
                            String(user.user_id) === String(local.author_id)
                        ) {
                            setLoadingStep("Syncing local paper…");
                            void syncService.sync(local);
                        }
                        return;
                    }
                }
                setPaper(null);
            } catch {
                setLoadingStep("Server unavailable, checking local…");
                const local = await paperStore.getPaper(id!);
                if (local) {
                    setPaper(local);
                } else {
                    setPaper(null);
                }
            } finally {
                setLoading(false);
                setLoadingStep("");
            }
        }
        void load();
    }, [authLoading, id, user?.user_id]);

    async function handleRemix() {
        if (!paper) return;
        setRemixing(true);
        const res = await apiFetch(`/api/papers/${paper.id}/remix`, {
            method: "POST",
        });
        if (!res.ok) {
            toast.error("Failed to remix paper");
            setRemixing(false);
            return;
        }
        const remixed = await res.json();
        await paperStore.savePaper(remixed);
        toast.success("Remixed!");
        setRemixing(false);
        navigate(`/papers/${remixed.id}`);
    }

    async function handleQuestionRemix() {
        if (!paper || !questionRemixId || !targetPaperId) return;

        setAddingQuestionRemix(true);
        try {
            const localTarget = await paperStore.getPaper(targetPaperId).catch(
                () => undefined,
            );
            if (localTarget) {
                await syncService.sync(localTarget);
                await syncService.flush();
            }

            const updatedPaper = await remixQuestionIntoPaper(
                paper.id,
                questionRemixId,
                targetPaperId,
            );
            await paperStore.savePaper(updatedPaper);
            toast.success(`Added to ${updatedPaper.title}`);
            setQuestionRemixId(null);
        } catch {
            toast.error("Failed to add question to paper");
        } finally {
            setAddingQuestionRemix(false);
        }
    }

    const updatePaper = useCallback((
        nextPaper: Paper | ((current: Paper) => Paper),
    ) => {
        const current = paperRef.current;
        if (!current) return;

        const next = typeof nextPaper === "function"
            ? nextPaper(current)
            : nextPaper;
        if (next === current) return;

        const stamped = withRecalculatedTotals(next);
        paperRef.current = stamped;
        setPaper(stamped);
        void syncService.sync(stamped);
    }, []);

    async function handleBack() {
        if (paper && isOwner) {
            setSyncing(true);
            try {
                await syncService.flush();
            } catch {
                toast.error("Sync failed — changes are saved locally.");
            } finally {
                setSyncing(false);
            }
        }
        navigate(-1);
    }

    const addQuestion = useCallback(() => {
        updatePaper((current) => {
            const question = createQuestion(current);
            return {
                ...current,
                questions: [
                    ...current.questions,
                    current.verified
                        ? { ...question, verified_changed: true }
                        : question,
                ],
            };
        });
    }, [updatePaper]);

    const handleQuestionChange = useCallback((updated: QuestionData) => {
        updatePaper((current) => ({
            ...current,
            questions: current.questions.map((q) =>
                q.id === updated.id
                    ? {
                        ...updated,
                        verified_changed: current.verified
                            ? true
                            : updated.verified_changed,
                    }
                    : q
            ),
        }));
    }, [updatePaper]);

    const handleQuestionDelete = useCallback((qid: string) => {
        updatePaper((current) => ({
            ...current,
            questions: current.questions
                .filter((q) => q.id !== qid)
                .map((q, i) => ({ ...q, number: i + 1 })),
        }));
    }, [updatePaper]);

    const handleDuplicate = useCallback((qid: string) => {
        updatePaper((current) => {
            const source = current.questions.find((q) => q.id === qid);
            if (!source) return current;
            const idx = current.questions.indexOf(source);
            const clone: QuestionData = {
                ...structuredClone(source),
                id: crypto.randomUUID(),
                verified_changed: current.verified
                    ? true
                    : source.verified_changed,
            };
            const questions = [...current.questions];
            questions.splice(idx + 1, 0, clone);
            return {
                ...current,
                questions: questions.map((q, i) => ({ ...q, number: i + 1 })),
            };
        });
    }, [updatePaper]);

    const handleNumberChange = useCallback((qid: string, newNumber: number) => {
        updatePaper((current) => {
            const from = current.questions.findIndex((q) => q.id === qid);
            if (from === -1) return current;
            const to = Math.min(
                Math.max(newNumber - 1, 0),
                current.questions.length - 1,
            );

            const questions = [...current.questions];
            const [moved] = questions.splice(from, 1);
            questions.splice(to, 0, moved);

            return {
                ...current,
                questions: questions.map((q, i) => ({ ...q, number: i + 1 })),
            };
        });
    }, [updatePaper]);

    const handleSettingsSave = useCallback((meta: PaperMeta) => {
        updatePaper((current) => {
            const verificationChanged = meta.verified !== current.verified ||
                meta.verified_at !== current.verified_at;
            return {
                ...current,
                ...meta,
                questions: verificationChanged
                    ? current.questions.map((q) => ({
                        ...q,
                        verified_changed: false,
                    }))
                    : current.questions,
            };
        });
    }, [updatePaper]);

    const handleQuestionEdit = useCallback((qid: string) => {
        setSelectedId(qid);
    }, []);

    const handleEditorResizeStart = useCallback((
        e: ReactPointerEvent<HTMLDivElement>,
    ) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startWidth = editorWidth;

        function handlePointerMove(moveEvent: PointerEvent) {
            const delta = startX - moveEvent.clientX;
            setEditorWidth(clampEditorWidth(startWidth + delta));
        }

        function handlePointerUp() {
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        }

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
    }, [editorWidth]);

    if (loading || authLoading) {
        return (
            <>
                <NavBar />
                <div className="flex flex-col items-center gap-2 py-24 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin" />
                    <p>{loadingStep || "Loading…"}</p>
                </div>
            </>
        );
    }

    if (takenDown) {
        return (
            <>
                <Takendown />
                <AdminSidebar paperId={id!} isTakenDown />
            </>
        );
    }

    if (!paper) {
        if (!paper) {
            return (
                <GenericError
                    code={404}
                    title="Paper not found"
                    message="This paper doesn't exist or may have been deleted."
                    showNav={true}
                />
            );
        }
    }

    if (
        paper.visibility === "private" &&
        (!user || (!user.admin && String(user.user_id) !== paper.author_id))
    ) {
        return <Unauthorized />;
    }

    return (
        <>
            <NavBar />
            <main className="mx-auto w-full max-w-3xl px-6 py-8">
                {/** paper toolbar */}

                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleBack}
                            disabled={syncing}
                            aria-label="Back to papers"
                            className="shrink-0"
                        >
                            <ArrowLeft />
                        </Button>
                        <div className="min-w-0 flex-1">
                            <h1 className="break-words text-2xl font-bold leading-tight">
                                {paper.title}
                            </h1>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                                {!isOwner && authorName && (
                                    <>
                                        <span className="min-w-0 break-words">
                                            by {authorName}
                                        </span>
                                        <span aria-hidden="true">·</span>
                                    </>
                                )}
                                <span>
                                    {paper.question_count}{" "}
                                    question{paper.question_count === 1
                                        ? ""
                                        : "s"}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>
                                    {paper.total_marks}{" "}
                                    mark{paper.total_marks === 1 ? "" : "s"}
                                </span>
                            </div>
                            {paper.remixed && (
                                <Link
                                    to={`/papers/${paper.remixed}`}
                                    className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:underline"
                                >
                                    <Shell className="size-3 shrink-0" />
                                    <span className="min-w-0 truncate">
                                        Remixed from "
                                        {remixSource
                                            ? `${remixSource.author}/${remixSource.title}`
                                            : "…"}
                                        "
                                    </span>
                                </Link>
                            )}
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                        {(isOwner || user?.admin) && (
                            <PaperSettings
                                paper={paper}
                                onSave={handleSettingsSave}
                                canEditMetadata={isOwner}
                            />
                        )}

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setFocusMode(true)}
                            aria-label="Focus mode"
                        >
                            <Glasses className="size-4" />
                        </Button>
                        <StarPaperButton paperId={paper.id} />
                        <PaperVerifiedBadge paper={paper} />
                        {!isOwner && <ReportPaperButton paperId={paper.id} />}

                        {isOwner && (
                            <Popover
                                open={showSaveHint}
                                onOpenChange={setShowSaveHint}
                            >
                                <PopoverTrigger asChild>
                                    <span className="ml-2">
                                        {syncStatus === "synced" && (
                                            <Check className="size-4 text-green-500" />
                                        )}
                                        {syncStatus === "syncing" && (
                                            <Loader2 className="size-4 animate-spin text-blue-500" />
                                        )}
                                        {syncStatus === "pending" && (
                                            <CloudUpload className="size-4 text-yellow-500" />
                                        )}
                                        {syncStatus === "offline" && (
                                            <CloudOff className="size-4 text-destructive" />
                                        )}
                                    </span>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto px-3 py-2 text-xs">
                                    {syncStatus !== "offline"
                                        ? "Don't worry, everything is automatically saved"
                                        : "Well this is awkward... At least it's available locally"}
                                </PopoverContent>
                            </Popover>
                        )}

                        {/** Remix button */}
                        {!isOwner && paper.visibility === "public" &&
                            !paper.remixed && (
                                user
                                    ? (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        onClick={handleRemix}
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-8"
                                                        disabled={remixing}
                                                    >
                                                        <Shell className="size-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Remix this and create your
                                                    own editable copy
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )
                                    : (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-8 text-muted-foreground"
                                                        onClick={(e) => {
                                                            e.currentTarget
                                                                .classList.add(
                                                                    "animate-[shake_0.3s_ease-in-out]",
                                                                );
                                                            setTimeout(() =>
                                                                e.currentTarget
                                                                    .classList
                                                                    .remove(
                                                                        "animate-[shake_0.3s_ease-in-out]",
                                                                    ), 300);
                                                        }}
                                                    >
                                                        <Shell className="size-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    You gotta log in to remix
                                                    this paper
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )
                            )}
                    </div>
                </div>

                {paper.questions.length === 0
                    ? (
                        <p className="text-muted-foreground">
                            No questions yet.
                        </p>
                    )
                    : (
                        <div className="space-y-4">
                            {paper.questions.map((q) => (
                                <Question
                                    key={q.id}
                                    question={q}
                                    onChange={isOwner && !q.source_removed
                                        ? handleQuestionChange
                                        : undefined}
                                    onDelete={isOwner && !q.source_removed
                                        ? handleQuestionDelete
                                        : undefined}
                                    onEdit={isOwner && !q.source_removed
                                        ? handleQuestionEdit
                                        : undefined}
                                    onDuplicate={isOwner && !q.source_removed
                                        ? handleDuplicate
                                        : undefined}
                                    onRemix={user && !isOwner &&
                                            paper.visibility === "public"
                                        ? setQuestionRemixId
                                        : undefined}
                                />
                            ))}
                        </div>
                    )}

                {isOwner && (
                    <Button onClick={addQuestion} className="mt-6">
                        <Plus /> Add question
                    </Button>
                )}
            </main>

            <Sheet
                open={selected !== null}
                onOpenChange={(open) => !open && setSelectedId(null)}
            >
                <SheetContent
                    side="right"
                    className="w-[calc(100vw-16px)] max-w-none overflow-y-auto sm:w-auto"
                    style={{
                        width: `min(${editorWidth}px, calc(100vw - 16px))`,
                        maxWidth: "none",
                    }}
                >
                    {selected && (
                        <>
                            <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="Resize question editor"
                                tabIndex={0}
                                className="group absolute inset-y-0 left-0 z-20 w-4 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
                                onPointerDown={handleEditorResizeStart}
                                onKeyDown={(e) => {
                                    if (e.key === "ArrowLeft") {
                                        e.preventDefault();
                                        setEditorWidth((width) =>
                                            clampEditorWidth(
                                                width +
                                                    EDITOR_KEYBOARD_STEP,
                                            )
                                        );
                                    }
                                    if (e.key === "ArrowRight") {
                                        e.preventDefault();
                                        setEditorWidth((width) =>
                                            clampEditorWidth(
                                                width -
                                                    EDITOR_KEYBOARD_STEP,
                                            )
                                        );
                                    }
                                }}
                            >
                                <span className="absolute inset-y-0 left-1/2 w-px bg-border transition group-hover:bg-primary/70 group-focus-visible:bg-primary" />
                                <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/80 transition group-hover:bg-primary/70 group-focus-visible:bg-primary" />
                            </div>
                            <SheetHeader className="pr-12">
                                <SheetTitle>
                                    Edit Question{" "}
                                    <EditableNumber
                                        value={selected.number}
                                        onCommit={(n) =>
                                            handleNumberChange(selected.id, n)}
                                    />
                                </SheetTitle>
                            </SheetHeader>
                            <QuestionEditor
                                question={selected}
                                onChange={handleQuestionChange}
                            />
                        </>
                    )}
                </SheetContent>
            </Sheet>

            <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            You really don't trust the cloud, do you? Hmph.
                        </DialogTitle>
                        <DialogDescription>
                            Here, you can save it locally or whatever… its not
                            like I'm doing this because I care.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowExportDialog(false)}
                        >
                            Nevermind
                        </Button>
                        <Button onClick={handleExportJson}>
                            <Download className="size-4" /> Export as JSON
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={questionRemixId !== null}
                onOpenChange={(open) => {
                    if (!open) setQuestionRemixId(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add question</DialogTitle>
                        <DialogDescription>
                            Choose where this public question should be added.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <label
                            htmlFor="question-remix-target"
                            className="text-sm font-medium"
                        >
                            Add to paper:
                        </label>
                        {loadingTargets
                            ? (
                                <p className="text-sm text-muted-foreground">
                                    Loading papers...
                                </p>
                            )
                            : targetPapers.length === 0
                            ? (
                                <p className="text-sm text-muted-foreground">
                                    You do not have any papers yet.
                                </p>
                            )
                            : (
                                <Select
                                    value={targetPaperId}
                                    onValueChange={setTargetPaperId}
                                >
                                    <SelectTrigger
                                        id="question-remix-target"
                                        className="w-full"
                                    >
                                        <SelectValue placeholder="Select paper" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {targetPapers.map((target) => (
                                            <SelectItem
                                                key={target.id}
                                                value={target.id}
                                            >
                                                {target.title}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setQuestionRemixId(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleQuestionRemix}
                            disabled={!targetPaperId || addingQuestionRemix}
                        >
                            {addingQuestionRemix ? "Adding..." : "Add"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AdminSidebar
                paperId={id!}
                isTakenDown={paper.visibility === "removed"}
                paper={paper}
                onPaperUpdate={handleSettingsSave}
            />
            {focusMode && paper && (
                <FocusMode
                    paper={{
                        ...paper,
                        questions: paper.questions.filter((q) =>
                            !q.source_removed
                        ),
                        question_count: paper.questions.filter((q) =>
                            !q.source_removed
                        ).length,
                        total_marks: paper.questions
                            .filter((q) => !q.source_removed)
                            .reduce((sum, q) => sum + q.marks, 0),
                    }}
                    onExit={() => setFocusMode(false)}
                />
            )}
        </>
    );
}
