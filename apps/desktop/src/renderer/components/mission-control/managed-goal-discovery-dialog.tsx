import {
  type FormEvent,
  type Ref,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createManagedGoalDiscoveryDraft,
  type ManagedGoalDiscoveryAction,
  type ManagedGoalDiscoveryDepth,
  type ManagedGoalDiscoveryDraft,
  type ManagedGoalDiscoveryProjectSnapshot,
  type ManagedGoalDiscoveryProvider,
  type ManagedGoalDiscoverySubmission,
  type ManagedGoalDiscoveryValidationErrors,
  prepareManagedGoalDiscoverySubmission,
  reduceManagedGoalDiscoveryDraft,
  snapshotManagedGoalDiscoveryProject,
} from "./managed-goal-discovery";

const DEPTH_OPTIONS: ReadonlyArray<{
  value: ManagedGoalDiscoveryDepth;
  label: string;
  description: string;
}> = [
  {
    value: "quick",
    label: "Quick",
    description: "Clarify the outcome and the most important unknowns.",
  },
  {
    value: "thorough",
    label: "Thorough",
    description: "Probe assumptions, constraints, risks, and success signals.",
  },
  {
    value: "exhaustive",
    label: "Exhaustive",
    description:
      "Challenge edge cases and unresolved decisions before shaping the goal contract.",
  },
];

const PROVIDER_OPTIONS: ReadonlyArray<{
  value: ManagedGoalDiscoveryProvider;
  label: string;
  description: string;
}> = [
  {
    value: "chatgpt",
    label: "ChatGPT",
    description: "Independent product and implementation critique.",
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "A second perspective on assumptions and missing context.",
  },
];

export type ManagedGoalDiscoverySubmitHandler = (
  submission: ManagedGoalDiscoverySubmission,
  project: ManagedGoalDiscoveryProjectSnapshot
) => void | Promise<void>;

export interface ManagedGoalDiscoveryDialogProps {
  open: boolean;
  project: ManagedGoalDiscoveryProjectSnapshot | null;
  onOpenChange: (open: boolean) => void;
  onSubmit?: ManagedGoalDiscoverySubmitHandler;
}

export interface ManagedGoalDiscoveryFormProps {
  draft: ManagedGoalDiscoveryDraft;
  errors?: ManagedGoalDiscoveryValidationErrors;
  formRef?: Ref<HTMLFormElement>;
  pending?: boolean;
  project: ManagedGoalDiscoveryProjectSnapshot | null;
  submissionError?: string | null;
  submitEnabled?: boolean;
  onAction: (action: ManagedGoalDiscoveryAction) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ManagedGoalDiscoveryForm({
  draft,
  errors = {},
  formRef,
  pending = false,
  project,
  submissionError,
  submitEnabled = true,
  onAction,
  onCancel,
  onSubmit,
}: ManagedGoalDiscoveryFormProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const titleErrorId = `${titleId}-error`;
  const seedIntentId = `${id}-seed-intent`;
  const seedIntentDescriptionId = `${seedIntentId}-description`;
  const seedIntentErrorId = `${seedIntentId}-error`;
  const depthDescriptionId = `${id}-depth-description`;
  const providersDescriptionId = `${id}-providers-description`;
  const submissionErrorId = `${id}-submission-error`;
  const projectId = `${id}-project`;
  const projectDescriptionId = `${projectId}-description`;

  return (
    <form
      aria-busy={pending}
      aria-describedby={submissionError ? submissionErrorId : undefined}
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={onSubmit}
      ref={formRef}
    >
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-6">
        <section className="grid gap-1.5 rounded-lg border bg-muted/20 p-3">
          <p className="font-medium text-sm">Discovery before planning</p>
          <p className="text-muted-foreground text-xs/relaxed">
            The Supervisor will interview you, challenge assumptions, and
            consult the selected external advisors before it proposes a plan.
            Nothing is dispatched to workers from this step.
          </p>
        </section>

        <div className="grid gap-1.5">
          <Label htmlFor={projectId}>Project</Label>
          <Input
            aria-describedby={projectDescriptionId}
            id={projectId}
            readOnly
            value={project?.name ?? "No active project selected"}
          />
          <p
            className="text-muted-foreground text-xs/relaxed"
            id={projectDescriptionId}
          >
            Locked for this Goal. Close this dialog and choose another active
            project to create a Goal elsewhere.
            {project ? (
              <span className="mt-0.5 block font-mono text-[10px]">
                Project ID: {project.id}
              </span>
            ) : null}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={titleId}>Goal title</Label>
          <Input
            aria-describedby={errors.title ? titleErrorId : undefined}
            aria-invalid={Boolean(errors.title)}
            autoComplete="off"
            autoFocus
            disabled={pending}
            id={titleId}
            maxLength={160}
            name="title"
            onChange={(event) =>
              onAction({ type: "set_title", value: event.target.value })
            }
            placeholder="Give this goal a clear, durable name"
            required
            value={draft.title}
          />
          {errors.title ? (
            <p
              className="text-destructive text-xs"
              id={titleErrorId}
              role="alert"
            >
              {errors.title}
            </p>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={seedIntentId}>Rough outcome</Label>
          <Textarea
            aria-describedby={
              errors.seedIntent
                ? `${seedIntentDescriptionId} ${seedIntentErrorId}`
                : seedIntentDescriptionId
            }
            aria-invalid={Boolean(errors.seedIntent)}
            className="min-h-28 resize-y bg-background"
            disabled={pending}
            id={seedIntentId}
            maxLength={8000}
            name="seedIntent"
            onChange={(event) =>
              onAction({ type: "set_seed_intent", value: event.target.value })
            }
            placeholder={`What should be different for ${project?.name ?? "this project"} when this goal succeeds?`}
            required
            value={draft.seedIntent}
          />
          <p
            className="text-muted-foreground text-xs"
            id={seedIntentDescriptionId}
          >
            A rough answer is enough. Discovery will refine the contract with
            you.
          </p>
          {errors.seedIntent ? (
            <p
              className="text-destructive text-xs"
              id={seedIntentErrorId}
              role="alert"
            >
              {errors.seedIntent}
            </p>
          ) : null}
        </div>

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="font-medium text-xs">Discovery depth</legend>
          <p className="text-muted-foreground text-xs" id={depthDescriptionId}>
            Choose how aggressively the Supervisor should investigate the goal.
          </p>
          <div
            aria-describedby={depthDescriptionId}
            className="grid gap-2 sm:grid-cols-3"
          >
            {DEPTH_OPTIONS.map((option) => {
              const optionId = `${id}-depth-${option.value}`;
              return (
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  htmlFor={optionId}
                  key={option.value}
                >
                  <input
                    checked={draft.depth === option.value}
                    className="mt-0.5 size-4 accent-primary"
                    id={optionId}
                    name="depth"
                    onChange={() =>
                      onAction({ type: "set_depth", value: option.value })
                    }
                    type="radio"
                    value={option.value}
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium text-xs">{option.label}</span>
                    <span className="text-muted-foreground text-xs/relaxed">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="font-medium text-xs">External advisors</legend>
          <p
            className="text-muted-foreground text-xs"
            id={providersDescriptionId}
          >
            Advisors challenge the draft. The Supervisor still owns the
            interview and synthesis.
          </p>
          <div
            aria-describedby={providersDescriptionId}
            className="grid gap-2 sm:grid-cols-2"
          >
            {PROVIDER_OPTIONS.map((option) => {
              const optionId = `${id}-provider-${option.value}`;
              return (
                <Label
                  className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3"
                  htmlFor={optionId}
                  key={option.value}
                >
                  <Checkbox
                    checked={draft.providers[option.value]}
                    className="mt-0.5"
                    id={optionId}
                    onCheckedChange={(checked) =>
                      onAction({
                        type: "set_provider",
                        provider: option.value,
                        enabled: checked === true,
                      })
                    }
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium text-xs">{option.label}</span>
                    <span className="text-muted-foreground text-xs/relaxed">
                      {option.description}
                    </span>
                  </span>
                </Label>
              );
            })}
          </div>
        </fieldset>

        {submissionError ? (
          <p
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-xs"
            id={submissionErrorId}
            role="alert"
          >
            {submissionError}
          </p>
        ) : null}
      </div>

      <DialogFooter className="shrink-0 border-t bg-background p-4 sm:p-6">
        <Button
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={pending || !submitEnabled} type="submit">
          {pending ? "Starting discovery…" : "Start goal discovery"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ManagedGoalDiscoveryDialog({
  open,
  project,
  onOpenChange,
  onSubmit,
}: ManagedGoalDiscoveryDialogProps) {
  const [draft, dispatch] = useReducer(
    reduceManagedGoalDiscoveryDraft,
    undefined,
    createManagedGoalDiscoveryDraft
  );
  const [projectSnapshot, setProjectSnapshot] =
    useState<ManagedGoalDiscoveryProjectSnapshot | null>(() =>
      open ? snapshotManagedGoalDiscoveryProject(project) : null
    );
  const [errors, setErrors] = useState<ManagedGoalDiscoveryValidationErrors>(
    {}
  );
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const previousOpen = useRef(open);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const wasOpen = previousOpen.current;
    if (open && !wasOpen) {
      setProjectSnapshot(snapshotManagedGoalDiscoveryProject(project));
      dispatch({ type: "reset" });
      setErrors({});
      setSubmissionError(null);
    } else if (!open && wasOpen) {
      setProjectSnapshot(null);
      dispatch({ type: "reset" });
      setErrors({});
      setSubmissionError(null);
      setPending(false);
    }
    previousOpen.current = open;
  }, [open, project]);

  const visibleProject =
    projectSnapshot ??
    (open ? snapshotManagedGoalDiscoveryProject(project) : null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleAction = (action: ManagedGoalDiscoveryAction) => {
    dispatch(action);
    setSubmissionError(null);
    if (action.type === "set_title" && errors.title) {
      setErrors((current) => ({ ...current, title: undefined }));
    }
    if (action.type === "set_seed_intent" && errors.seedIntent) {
      setErrors((current) => ({ ...current, seedIntent: undefined }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!(visibleProject && onSubmit)) {
      return;
    }
    const prepared = prepareManagedGoalDiscoverySubmission(draft);
    if (!prepared.ok) {
      setErrors(prepared.errors);
      const firstInvalidName = prepared.errors.title ? "title" : "seedIntent";
      const field = formRef.current?.elements.namedItem(
        firstInvalidName
      ) as HTMLElement | null;
      field?.focus();
      return;
    }

    setErrors({});
    setSubmissionError(null);
    setPending(true);
    try {
      await onSubmit(prepared.submission, visibleProject);
      onOpenChange(false);
    } catch (error) {
      setSubmissionError(toSubmissionErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[min(92dvh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onInteractOutside={(event) => pending && event.preventDefault()}
        showCloseButton={!pending}
      >
        <DialogHeader className="shrink-0 border-b px-6 pt-6 pb-4">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>Start goal discovery</DialogTitle>
            <Badge variant="secondary">
              Project · {visibleProject?.name ?? "Not selected"}
            </Badge>
          </div>
          <DialogDescription>
            Shape a reviewable goal contract for{" "}
            {visibleProject?.name ?? "the active project"} before the Supervisor
            plans any work.
          </DialogDescription>
        </DialogHeader>
        <ManagedGoalDiscoveryForm
          draft={draft}
          errors={errors}
          formRef={formRef}
          onAction={handleAction}
          onCancel={() => handleOpenChange(false)}
          onSubmit={handleSubmit}
          pending={pending}
          project={visibleProject}
          submissionError={submissionError}
          submitEnabled={Boolean(visibleProject && onSubmit)}
        />
      </DialogContent>
    </Dialog>
  );
}

function toSubmissionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Goal discovery could not start. Your answers are still here.";
}
