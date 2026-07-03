import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AllNESASubjectsList } from "@/lib/subjects";
import { memo, useEffect, useState } from "react";
import type {
    CourseLevel,
    PaperMeta,
    PaperSource,
    PaperVerificationRequest,
    Visibility,
} from "@/types/tppr-paper";
import { CheckCircle2, Clock, Send, Settings } from "lucide-react";
import { toast } from "sonner";
import { syncService } from "@/lib/cloud";
import { Link } from "react-router-dom";
import { useAuth } from "@/api/auth";
import {
    getPaperVerificationRequest,
    submitPaperVerificationRequest,
    updatePaperVerification,
} from "@/api/papers";
import { formatListField, parseListField } from "@/lib/paper-fields";

interface PaperSettingsProps {
    paper: PaperMeta;
    onSave: (updated: PaperMeta) => void;
    onOpenChange?: (open: boolean) => void;
    canEditMetadata?: boolean;
}

function sameSettingsPaper(a: PaperMeta, b: PaperMeta) {
    return a.id === b.id &&
        a.title === b.title &&
        a.subject === b.subject &&
        a.syllabus_id === b.syllabus_id &&
        a.course_level === b.course_level &&
        a.year === b.year &&
        a.source === b.source &&
        a.school === b.school &&
        a.visibility === b.visibility &&
        a.duration_minutes === b.duration_minutes &&
        formatListField(a.topics) === formatListField(b.topics) &&
        formatListField(a.outcomes) === formatListField(b.outcomes) &&
        a.verified === b.verified &&
        a.verified_source_name === b.verified_source_name &&
        a.verified_source_url === b.verified_source_url &&
        a.verified_at === b.verified_at;
}

export const PaperSettings = memo(function PaperSettings(
    {
        paper,
        onSave,
        onOpenChange,
        canEditMetadata = true,
    }: PaperSettingsProps,
) {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(paper.title);
    const [subject, setSubject] = useState(paper.subject);
    const [syllabusId, setSyllabusId] = useState(paper.syllabus_id ?? "");
    const [courseLevel, setCourseLevel] = useState(paper.course_level ?? "");
    const [year, setYear] = useState(paper.year?.toString() ?? "");
    const [source, setSource] = useState(paper.source ?? "");
    const [school, setSchool] = useState(paper.school ?? "");
    const [visibility, setVisibility] = useState<Visibility>(paper.visibility);
    const [showPublishWarning, setShowPublishWarning] = useState(false);
    const [showUnpublishWarning, setShowUnpublishWarning] = useState(false);
    const [duration, setDuration] = useState(
        paper.duration_minutes?.toString() ?? "",
    );
    const [topics, setTopics] = useState(formatListField(paper.topics));
    const [outcomes, setOutcomes] = useState(formatListField(paper.outcomes));
    const [verificationSourceName, setVerificationSourceName] = useState(
        paper.verified_source_name ?? "",
    );
    const [verificationSourceUrl, setVerificationSourceUrl] = useState(
        paper.verified_source_url ?? "",
    );
    const [verificationSaving, setVerificationSaving] = useState(false);
    const [verificationRequest, setVerificationRequest] =
        useState<PaperVerificationRequest | null>(null);
    const [requestNote, setRequestNote] = useState("");
    const [requestLoading, setRequestLoading] = useState(false);
    const [requestSaving, setRequestSaving] = useState(false);
    const [savingVisibility, setSavingVisibility] = useState(false);

    const showCourseLevel = subject === "Mathematics" || subject === "English";
    const canVerify = Boolean(user?.admin);
    const canRequestVerification = canEditMetadata && !canVerify;

    function handleOpen(isOpen: boolean) {
        if (isOpen) {
            setTitle(paper.title);
            setSubject(paper.subject);
            setSyllabusId(paper.syllabus_id ?? "");
            setCourseLevel(paper.course_level ?? "");
            setYear(paper.year?.toString() ?? "");
            setSource(paper.source ?? "");
            setSchool(paper.school ?? "");
            setVisibility(paper.visibility);
            setDuration(paper.duration_minutes?.toString() ?? "");
            setTopics(formatListField(paper.topics));
            setOutcomes(formatListField(paper.outcomes));
            setVerificationSourceName(paper.verified_source_name ?? "");
            setVerificationSourceUrl(paper.verified_source_url ?? "");
            setRequestNote("");
        }
        setShowPublishWarning(false);
        setShowUnpublishWarning(false);
        setOpen(isOpen);
        onOpenChange?.(isOpen);
    }

    function handleSubmit(e: React.SubmitEvent) {
        e.preventDefault();
        if (!canEditMetadata) return;
        if (paper.visibility === "private" && visibility === "public") {
            setShowPublishWarning(true);
            return;
        }
        if (paper.visibility === "public" && visibility === "private") {
            setShowUnpublishWarning(true);
            return;
        }
        onOpenChange?.(false);
        save();
    }

    async function save() {
        const isPublishing = paper.visibility === "private" &&
            visibility === "public";
        const isUnpublishing = paper.visibility === "public" &&
            visibility === "private";

        setSavingVisibility(true);

        const updated: PaperMeta = {
            ...paper,
            title,
            subject,
            syllabus_id: syllabusId || undefined,
            course_level: showCourseLevel
                ? (courseLevel as CourseLevel) || undefined
                : undefined,
            year: year ? Number(year) : undefined,
            source: (source as PaperSource) || undefined,
            school: school || undefined,
            visibility,
            duration_minutes: duration ? Number(duration) : undefined,
            topics: parseListField(topics),
            outcomes: parseListField(outcomes),
            updated_at: new Date().toISOString(),
        };

        try {
            if (isPublishing) {
                await syncService.publish(paper.id);
                toast.success(`${title} is now public!`);
            } else if (isUnpublishing) {
                await syncService.unpublish(paper.id);
                toast.success(`${title} is now private.`);
            }
        } catch {
            toast.error("Failed to update visibility. Please try again.");
            setSavingVisibility(false);
            return;
        }

        onSave(updated);
        setShowPublishWarning(false);
        setShowUnpublishWarning(false);
        setOpen(false);
        setSavingVisibility(false);
    }

    useEffect(() => {
        if (!open || !canRequestVerification || paper.verified) return;
        let cancelled = false;
        setRequestLoading(true);
        getPaperVerificationRequest(paper.id)
            .then((request) => {
                if (!cancelled) setVerificationRequest(request);
            })
            .catch(() => {
                if (!cancelled) setVerificationRequest(null);
            })
            .finally(() => {
                if (!cancelled) setRequestLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [canRequestVerification, open, paper.id, paper.verified]);

    async function handleVerification(verified: boolean) {
        setVerificationSaving(true);
        try {
            const updated = await updatePaperVerification(paper.id, {
                verified,
                source_name: verificationSourceName.trim(),
                source_url: verificationSourceUrl.trim() || undefined,
            });
            onSave(updated);
            setVerificationSourceName(updated.verified_source_name ?? "");
            setVerificationSourceUrl(updated.verified_source_url ?? "");
            toast.success(verified ? "Paper verified" : "Verification removed");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update verification",
            );
        } finally {
            setVerificationSaving(false);
        }
    }

    async function handleVerificationRequest() {
        setRequestSaving(true);
        try {
            const request = await submitPaperVerificationRequest(paper.id, {
                source_name: verificationSourceName.trim(),
                source_url: verificationSourceUrl.trim() || undefined,
                note: requestNote.trim() || undefined,
            });
            setVerificationRequest(request);
            toast.success("Paper submitted for verification");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to submit verification request",
            );
        } finally {
            setRequestSaving(false);
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpen}>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Paper settings"
                    >
                        <Settings />
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-2xl">
                    <form onSubmit={handleSubmit} className="min-w-0">
                        <DialogHeader>
                            <DialogTitle>Paper Settings</DialogTitle>
                        </DialogHeader>

                        <FieldGroup>
                            {canVerify && (
                                <Field>
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <CheckCircle2 data-icon="inline-start" />
                                            <FieldLabel>
                                                Verification
                                            </FieldLabel>
                                            {paper.verified && (
                                                <Badge variant="secondary">
                                                    Verified
                                                </Badge>
                                            )}
                                        </div>
                                        {paper.verified && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={verificationSaving}
                                                onClick={() =>
                                                    handleVerification(false)}
                                            >
                                                Remove
                                            </Button>
                                        )}
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field>
                                            <FieldLabel htmlFor="verification-source-name">
                                                Source name
                                            </FieldLabel>
                                            <Input
                                                id="verification-source-name"
                                                value={verificationSourceName}
                                                onChange={(e) =>
                                                    setVerificationSourceName(
                                                        e.target.value,
                                                    )}
                                                placeholder="e.g. NESA"
                                                disabled={verificationSaving}
                                            />
                                        </Field>
                                        <Field>
                                            <FieldLabel htmlFor="verification-source-url">
                                                Source URL
                                            </FieldLabel>
                                            <Input
                                                id="verification-source-url"
                                                value={verificationSourceUrl}
                                                onChange={(e) =>
                                                    setVerificationSourceUrl(
                                                        e.target.value,
                                                    )}
                                                placeholder="https://..."
                                                disabled={verificationSaving}
                                            />
                                        </Field>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        disabled={verificationSaving ||
                                            !verificationSourceName.trim()}
                                        onClick={() => handleVerification(true)}
                                    >
                                        <CheckCircle2 data-icon="inline-start" />
                                        {paper.verified
                                            ? "Update verification"
                                            : "Verify paper"}
                                    </Button>
                                    <FieldDescription>
                                        Verified papers display a checkmark in
                                        search, cards, and the editor.
                                    </FieldDescription>
                                </Field>
                            )}

                            {canRequestVerification && (
                                <Field>
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <CheckCircle2 data-icon="inline-start" />
                                            <FieldLabel>
                                                Verification request
                                            </FieldLabel>
                                            {paper.verified
                                                ? (
                                                    <Badge variant="secondary">
                                                        Verified
                                                    </Badge>
                                                )
                                                : verificationRequest && (
                                                    <Badge variant="outline">
                                                        {verificationRequest.status}
                                                    </Badge>
                                                )}
                                        </div>
                                    </div>
                                    {paper.verified
                                        ? (
                                            <FieldDescription>
                                                This paper is already verified.
                                            </FieldDescription>
                                        )
                                        : verificationRequest?.status === "pending"
                                        ? (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Clock data-icon="inline-start" />
                                                Submitted for verification.
                                            </div>
                                        )
                                        : (
                                            <>
                                                {verificationRequest?.status ===
                                                        "rejected" && (
                                                    <p className="text-sm text-muted-foreground">
                                                        Previous request was rejected{verificationRequest.admin_note
                                                            ? `: ${verificationRequest.admin_note}`
                                                            : "."}
                                                    </p>
                                                )}
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    <Field>
                                                        <FieldLabel htmlFor="verification-request-source-name">
                                                            Source name
                                                        </FieldLabel>
                                                        <Input
                                                            id="verification-request-source-name"
                                                            value={verificationSourceName}
                                                            onChange={(e) =>
                                                                setVerificationSourceName(
                                                                    e.target.value,
                                                                )}
                                                            placeholder="e.g. NESA"
                                                            disabled={requestSaving}
                                                        />
                                                    </Field>
                                                    <Field>
                                                        <FieldLabel htmlFor="verification-request-source-url">
                                                            Source URL
                                                        </FieldLabel>
                                                        <Input
                                                            id="verification-request-source-url"
                                                            value={verificationSourceUrl}
                                                            onChange={(e) =>
                                                                setVerificationSourceUrl(
                                                                    e.target.value,
                                                                )}
                                                            placeholder="https://..."
                                                            disabled={requestSaving}
                                                        />
                                                    </Field>
                                                </div>
                                                <Field>
                                                    <FieldLabel htmlFor="verification-request-note">
                                                        Note
                                                    </FieldLabel>
                                                    <Textarea
                                                        id="verification-request-note"
                                                        value={requestNote}
                                                        onChange={(e) =>
                                                            setRequestNote(
                                                                e.target.value,
                                                            )}
                                                        rows={3}
                                                        disabled={requestSaving}
                                                        placeholder="Anything an admin should know before checking this paper."
                                                    />
                                                </Field>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={requestLoading ||
                                                        requestSaving ||
                                                        !verificationSourceName
                                                            .trim()}
                                                    onClick={handleVerificationRequest}
                                                >
                                                    <Send data-icon="inline-start" />
                                                    {requestSaving
                                                        ? "Submitting..."
                                                        : "Submit for verification"}
                                                </Button>
                                            </>
                                        )}
                                </Field>
                            )}

                            <Field>
                                <FieldLabel htmlFor="settings-title">
                                    Title
                                </FieldLabel>
                                <Input
                                    id="settings-title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    disabled={!canEditMetadata}
                                    required
                                />
                            </Field>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field
                                    className={showCourseLevel
                                        ? ""
                                        : "sm:col-span-2"}
                                >
                                    <FieldLabel htmlFor="settings-subject">
                                        Subject
                                    </FieldLabel>
                                    <Select
                                        value={subject}
                                        onValueChange={setSubject}
                                        disabled={!canEditMetadata}
                                    >
                                        <SelectTrigger
                                            id="settings-subject"
                                            className="w-full"
                                        >
                                            <SelectValue placeholder="Select a subject" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <AllNESASubjectsList />
                                        </SelectContent>
                                    </Select>
                                </Field>

                                {showCourseLevel && (
                                    <Field>
                                        <FieldLabel htmlFor="settings-level">
                                            Level
                                        </FieldLabel>
                                        <Select
                                            value={courseLevel}
                                            onValueChange={setCourseLevel}
                                            disabled={!canEditMetadata}
                                        >
                                            <SelectTrigger
                                                id="settings-level"
                                                className="w-full"
                                            >
                                                <SelectValue placeholder="Select level" />
                                            </SelectTrigger>
                                            <SelectContent>
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
                                    </Field>
                                )}
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field>
                                    <FieldLabel htmlFor="settings-syllabus">
                                        Syllabus ID
                                    </FieldLabel>
                                    <Input
                                        id="settings-syllabus"
                                        value={syllabusId}
                                        onChange={(e) =>
                                            setSyllabusId(e.target.value)}
                                        placeholder="hsc-physics-2025"
                                        disabled={!canEditMetadata}
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="settings-year">
                                        Year
                                    </FieldLabel>
                                    <Input
                                        id="settings-year"
                                        type="number"
                                        min={1990}
                                        value={year}
                                        onChange={(e) =>
                                            setYear(e.target.value)}
                                        placeholder="2026"
                                        disabled={!canEditMetadata}
                                    />
                                </Field>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field>
                                    <FieldLabel htmlFor="settings-duration">
                                        Duration (min)
                                    </FieldLabel>
                                    <Input
                                        id="settings-duration"
                                        type="number"
                                        min={1}
                                        max={600}
                                        value={duration}
                                        onChange={(e) =>
                                            setDuration(e.target.value)}
                                        placeholder="180"
                                        disabled={!canEditMetadata}
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="settings-school">
                                        School
                                    </FieldLabel>
                                    <Input
                                        id="settings-school"
                                        value={school}
                                        onChange={(e) =>
                                            setSchool(e.target.value)}
                                        placeholder="School name"
                                        disabled={!canEditMetadata}
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="settings-source">
                                        Source
                                    </FieldLabel>
                                    <Select
                                        value={source}
                                        onValueChange={setSource}
                                        disabled={!canEditMetadata}
                                    >
                                        <SelectTrigger
                                            id="settings-source"
                                            className="w-full"
                                        >
                                            <SelectValue placeholder="Source" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hsc">
                                                HSC
                                            </SelectItem>
                                            <SelectItem value="trial">
                                                Trial
                                            </SelectItem>
                                            <SelectItem value="internal">
                                                Internal
                                            </SelectItem>
                                            <SelectItem value="practice">
                                                Practice
                                            </SelectItem>
                                            <SelectItem value="custom">
                                                Custom
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel htmlFor="settings-topics">
                                        Topic tags
                                    </FieldLabel>
                                    <Textarea
                                        id="settings-topics"
                                        value={topics}
                                        onChange={(e) =>
                                            setTopics(e.target.value)}
                                        placeholder="kinematics, projectile motion"
                                        rows={3}
                                        disabled={!canEditMetadata}
                                    />
                                    <FieldDescription>
                                        Separate tags with commas or new lines.
                                    </FieldDescription>
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="settings-outcomes">
                                        Outcome codes
                                    </FieldLabel>
                                    <Textarea
                                        id="settings-outcomes"
                                        value={outcomes}
                                        onChange={(e) =>
                                            setOutcomes(e.target.value)}
                                        placeholder="PH12-12, PH12-13"
                                        rows={3}
                                        disabled={!canEditMetadata}
                                    />
                                    <FieldDescription>
                                        Separate outcome codes with commas or
                                        new lines.
                                    </FieldDescription>
                                </Field>
                            </div>

                            <Field>
                                <FieldLabel>Visibility</FieldLabel>
                                <RadioGroup
                                    value={visibility}
                                    onValueChange={(v) =>
                                        setVisibility(v as Visibility)}
                                    className="flex flex-wrap gap-4"
                                    disabled={!canEditMetadata}
                                >
                                    <div className="flex items-center gap-2">
                                        <RadioGroupItem
                                            value="private"
                                            id="settings-private"
                                        />
                                        <FieldLabel htmlFor="settings-private">
                                            Private
                                        </FieldLabel>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <RadioGroupItem
                                            value="public"
                                            id="settings-public"
                                        />
                                        <FieldLabel htmlFor="settings-public">
                                            Public
                                        </FieldLabel>
                                    </div>
                                </RadioGroup>
                                <FieldDescription>
                                    Public papers appear in the shared question
                                    pool.
                                </FieldDescription>
                            </Field>
                        </FieldGroup>

                        <DialogFooter className="mt-4">
                            <DialogClose asChild>
                                <Button type="button" variant="outline">
                                    {canEditMetadata ? "Cancel" : "Close"}
                                </Button>
                            </DialogClose>
                            {canEditMetadata && (
                                <Button type="submit">Save</Button>
                            )}
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* publish paper (private->public) */}
            <Dialog
                open={showPublishWarning}
                onOpenChange={(open) => { if (!savingVisibility) setShowPublishWarning(open); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            You are about to publish {title}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Good to see you want your creation to be seen by the
                        world, but be aware of the implications of publishing:
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                        <li>
                            By publishing, anyone who uses Thribhus Past Paper
                            Repository will be able to see your paper.
                        </li>
                        <li>
                            Your paper can be copied and remixed by anyone.
                        </li>
                        <li>
                            Your paper aligns with the{" "}
                            <Link
                                to="/legal/copyright"
                                className="underline text-primary"
                            >
                                COPYRIGHT.md
                            </Link>{" "}
                            document, and you are aware that you may risk
                            deletion if in violation.
                        </li>
                    </ul>
                    <p className="text-sm font-medium">Continue?</p>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowPublishWarning(false)}
                            disabled={savingVisibility}
                        >
                            Nevermind
                        </Button>
                        <Button onClick={save} disabled={savingVisibility}>
                            {savingVisibility ? "Publishing..." : "Carry on!"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* unpublish paper (public->private) */}
            <Dialog
                open={showUnpublishWarning}
                onOpenChange={(open) => { if (!savingVisibility) setShowUnpublishWarning(open); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            You are about to unpublish {title}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Unfortunate to see your creation get removed, but to
                        each their own. Understand the implications:
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                        <li>
                            Your paper will no longer appear in search results
                            or the shared question pool.
                        </li>
                        <li>
                            Anyone who previously had access will no longer be
                            able to view it.
                        </li>
                    </ul>
                    <p className="text-sm font-medium">Continue?</p>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowUnpublishWarning(false)}
                            disabled={savingVisibility}
                        >
                            Nevermind
                        </Button>
                        <Button onClick={save} disabled={savingVisibility}>
                            {savingVisibility ? "Unpublishing..." : "Yeah go ahead!"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}, (prev, next) =>
    sameSettingsPaper(prev.paper, next.paper) &&
    prev.onSave === next.onSave &&
    prev.onOpenChange === next.onOpenChange);
