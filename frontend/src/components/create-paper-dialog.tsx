import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
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
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CourseLevel, PaperSource, Visibility } from "@/types/tppr-paper";
import { createLocalPaper } from "@/lib/paper";
import { parseListField } from "@/lib/paper-fields";
import { importPaperFromJsonFile } from "@/lib/paper-import";
import { useAuth } from "@/api/auth";
import { useNavigate } from "react-router-dom";
import {
    ChevronDown,
    ChevronRight,
    FileJson,
    FilePlus2,
    FileText,
} from "lucide-react";
import { getStoredMistralApiKey } from "@/lib/mistral-settings";
import { startPdfImport } from "@/lib/pdf-import-jobs";

export function CreatePaperDialog({ onCreated }: { onCreated?: () => void }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const importInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);

    const [mode, setMode] = useState<"choose" | "create">("choose");
    const [subject, setSubject] = useState("");
    const [courseLevel, setCourseLevel] = useState("");
    const [source, setSource] = useState("");
    const [visibility, setVisibility] = useState("private");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const showCourseLevel = subject === "Mathematics" || subject === "English";

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!user) {
            setError("You gotta be logged in to create a paper");
            return;
        }
        if (!subject) {
            setError("Choose a subject before creating the paper");
            return;
        }
        setError("");
        setSubmitting(true);

        const formData = new FormData(e.currentTarget);

        try {
            const paper = await createLocalPaper({
                title: String(formData.get("title")),
                subject,
                syllabus_id: String(formData.get("syllabus_id") || "") || null,
                course_level: showCourseLevel
                    ? (courseLevel as CourseLevel) || null
                    : null,
                year: formData.get("year") ? Number(formData.get("year")) : null,
                source: (source as PaperSource) || null,
                school: String(formData.get("school") || "") || null,
                duration_minutes: formData.get("duration_minutes")
                    ? Number(formData.get("duration_minutes"))
                    : null,
                topics: parseListField(String(formData.get("topics") || "")),
                outcomes: parseListField(String(formData.get("outcomes") || "")),
                visibility: visibility as Visibility,
            }, user.user_id);
            toast.success("Paper created");
            onCreated?.();
            navigate(`/papers/${paper.id}`);
        } catch {
            setError("Failed to create paper locally");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleImportFile(file: File | undefined) {
        if (!file) return;
        if (!user) {
            setError("You gotta be logged in to import a paper");
            return;
        }

        setError("");
        setSubmitting(true);
        try {
            const paper = await importPaperFromJsonFile(file, String(user.user_id));
            toast.success(`Imported "${paper.title}"`);
            onCreated?.();
            navigate(`/papers/${paper.id}`);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Failed to import paper";
            setError(message);
            toast.error(message);
        } finally {
            setSubmitting(false);
        }
    }

    function handleImportPdf(file: File | undefined) {
        if (!file) return;
        if (!user) {
            setError("You gotta be logged in to import a paper");
            return;
        }

        const apiKey = getStoredMistralApiKey();
        if (!apiKey) {
            const message = "Add your Mistral API key in Settings before importing a PDF.";
            setError(message);
            toast.error(message);
            return;
        }

        // Close the dialog immediately and start the import in the background.
        // The pipeline runs detached; progress and results persist to
        // localStorage so they survive a tab close/reopen.
        const jobId = startPdfImport(file, {
            userId: String(user.user_id),
            onCreated,
        });
        if (!jobId) {
            const message = "Could not start the background import.";
            setError(message);
            toast.error(message);
            return;
        }

        toast.success("Importing PDF in background...", {
            description: file.name,
        });
        // Reset the dialog so the next open starts fresh.
        setMode("choose");
        setError("");
    }

    return (
        <DialogContent onCloseAutoFocus={() => setMode("choose")}>
            {mode === "choose" && (
                <>
                    <DialogHeader>
                        <DialogTitle>Add Paper</DialogTitle>
                        <DialogDescription>
                            Import an existing TPPR JSON file or start with a blank paper.
                        </DialogDescription>
                    </DialogHeader>

                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => {
                            void handleImportFile(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                    />
                    <input
                        ref={pdfInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                            void handleImportPdf(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                    />

                    <div className="grid gap-3 sm:grid-cols-3">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                            disabled={submitting}
                            onClick={() => pdfInputRef.current?.click()}
                        >
                            <FileText data-icon="inline-start" />
                            <span className="font-medium">Import PDF</span>
                            <span className="text-sm font-normal text-muted-foreground">
                                Runs in the background after selection.
                            </span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                            disabled={submitting}
                            onClick={() => importInputRef.current?.click()}
                        >
                            <FileJson data-icon="inline-start" />
                            <span className="font-medium">Import JSON</span>
                            <span className="text-sm font-normal text-muted-foreground">
                                Upload a saved TPPR paper file.
                            </span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto flex-col items-start gap-2 p-4 text-left whitespace-normal"
                            disabled={submitting}
                            onClick={() => setMode("create")}
                        >
                            <FilePlus2 data-icon="inline-start" />
                            <span className="font-medium">Create Blank</span>
                            <span className="text-sm font-normal text-muted-foreground">
                                Set up a new paper from scratch.
                            </span>
                        </Button>
                    </div>

                    {error && (
                        <p className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                </>
            )}

            {mode === "create" && (
                <form onSubmit={handleSubmit}>
                <DialogHeader>
                    <DialogTitle>Create New Paper</DialogTitle>
                    <DialogDescription>
                        Create a new paper to share with yourself and the world!
                    </DialogDescription>
                </DialogHeader>

                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="title">Title</FieldLabel>
                        <Input
                            id="title"
                            name="title"
                            placeholder="e.g. 2024 Physics Trial"
                            required
                        />
                    </Field>

                    <Field>
                        <FieldLabel htmlFor="subject">Subject</FieldLabel>
                        <Select value={subject} onValueChange={setSubject}>
                            <SelectTrigger id="subject" className="w-full">
                                <SelectValue placeholder="Select a subject" />
                            </SelectTrigger>
                            <SelectContent>
                                <AllNESASubjectsList />
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field>
                        <FieldLabel>Visibility</FieldLabel>
                        <RadioGroup
                            value={visibility}
                            onValueChange={setVisibility}
                            className="flex gap-6"
                        >
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="private" id="private" />
                                <FieldLabel htmlFor="private">
                                    Private
                                </FieldLabel>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="public" id="public" />
                                <FieldLabel htmlFor="public">Public</FieldLabel>
                            </div>
                        </RadioGroup>
                        <FieldDescription>
                            Public papers appear in the shared question pool.
                        </FieldDescription>
                    </Field>

                    {/* Advanced section - collapsed by default */}
                    <div className="rounded-lg border">
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
                            onClick={() => setShowAdvanced((v) => !v)}
                            aria-expanded={showAdvanced}
                        >
                            {showAdvanced
                                ? <ChevronDown className="size-4" />
                                : <ChevronRight className="size-4" />}
                            Advanced
                            <span className="text-xs font-normal text-muted-foreground">
                                (optional)
                            </span>
                        </button>

                        {showAdvanced && (
                            <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
                                <div className="grid grid-cols-2 gap-4">
                                    {showCourseLevel && (
                                        <Field>
                                            <FieldLabel htmlFor="course-level">
                                                Level
                                            </FieldLabel>
                                            <Select
                                                value={courseLevel}
                                                onValueChange={setCourseLevel}
                                            >
                                                <SelectTrigger
                                                    id="course-level"
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
                                    <Field className={showCourseLevel ? "" : "col-span-2"}>
                                        <FieldLabel htmlFor="source">Source</FieldLabel>
                                        <Select value={source} onValueChange={setSource}>
                                            <SelectTrigger id="source" className="w-full">
                                                <SelectValue placeholder="Source" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="hsc">HSC</SelectItem>
                                                <SelectItem value="trial">Trial</SelectItem>
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

                                <div className="grid grid-cols-2 gap-4">
                                    <Field>
                                        <FieldLabel htmlFor="year">Year</FieldLabel>
                                        <Input
                                            id="year"
                                            name="year"
                                            type="number"
                                            min={1990}
                                            placeholder="2024"
                                        />
                                    </Field>
                                    <Field>
                                        <FieldLabel htmlFor="duration_minutes">
                                            Duration (min)
                                        </FieldLabel>
                                        <Input
                                            id="duration_minutes"
                                            name="duration_minutes"
                                            type="number"
                                            min={0}
                                            max={600}
                                            placeholder="180"
                                        />
                                    </Field>
                                </div>

                                <Field>
                                    <FieldLabel htmlFor="school">School</FieldLabel>
                                    <Input
                                        id="school"
                                        name="school"
                                        placeholder="e.g. Baulkham Hills"
                                    />
                                </Field>

                                <Field>
                                    <FieldLabel htmlFor="syllabus_id">Syllabus ID</FieldLabel>
                                    <Input
                                        id="syllabus_id"
                                        name="syllabus_id"
                                        placeholder="e.g. hsc-physics-2025"
                                    />
                                </Field>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field>
                                        <FieldLabel htmlFor="topics">Topic tags</FieldLabel>
                                        <Textarea
                                            id="topics"
                                            name="topics"
                                            placeholder="kinematics, projectile motion"
                                            rows={3}
                                        />
                                        <FieldDescription>
                                            Separate tags with commas or new lines.
                                        </FieldDescription>
                                    </Field>
                                    <Field>
                                        <FieldLabel htmlFor="outcomes">
                                            Outcome codes
                                        </FieldLabel>
                                        <Textarea
                                            id="outcomes"
                                            name="outcomes"
                                            placeholder="PH12-12, PH12-13"
                                            rows={3}
                                        />
                                        <FieldDescription>
                                            Separate outcome codes with commas or new lines.
                                        </FieldDescription>
                                    </Field>
                                </div>
                            </div>
                        )}
                    </div>
                </FieldGroup>

                <DialogFooter className="mt-4">
                    {error && (
                        <p className="self-center text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogClose asChild>
                        <Button type="button" variant="outline">
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button type="submit" disabled={submitting}>
                        {submitting ? "Creating…" : "Create Paper"}
                    </Button>
                </DialogFooter>
                </form>
            )}
        </DialogContent>
    );
}