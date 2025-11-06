import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter as CardFooterSection, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PromptSequence } from "@/types";

const STORAGE_KEY = "promptSequences";

interface PromptSequenceFormState {
  name: string;
  description: string;
  promptsText: string;
}

const initialFormState: PromptSequenceFormState = {
  name: "",
  description: "",
  promptsText: ""
};

interface PromptSequenceManagerProps {
  trigger?: ReactNode;
}

const normalizePrompts = (text: string) =>
  text
    .split(/\r?\n/)
    .map(prompt => prompt.trim())
    .filter(Boolean);

export const PromptSequenceManager = ({ trigger }: PromptSequenceManagerProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sequences, setSequences] = useState<PromptSequence[]>([]);
  const [formState, setFormState] = useState<PromptSequenceFormState>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PromptSequence[];
        setSequences(parsed);
      }
    } catch (error) {
      console.error("Failed to parse stored prompt sequences", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sequences));
    } catch (error) {
      console.error("Failed to persist prompt sequences", error);
    }
  }, [sequences]);

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  const sortedSequences = useMemo(
    () =>
      [...sequences].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [sequences]
  );

  const resetForm = () => {
    setFormState(initialFormState);
    setEditingId(null);
  };

  const handleEdit = (sequence: PromptSequence) => {
    setEditingId(sequence.id);
    setFormState({
      name: sequence.name,
      description: sequence.description ?? "",
      promptsText: sequence.prompts.join("\n")
    });
  };

  const handleDelete = (sequenceId: string) => {
    setSequences(prev => prev.filter(sequence => sequence.id !== sequenceId));
    toast({
      title: "Sequence deleted",
      description: "The prompt sequence has been removed."
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = formState.name.trim();
    const prompts = normalizePrompts(formState.promptsText);

    if (!name) {
      toast({
        title: "Sequence name required",
        description: "Please provide a name before saving.",
        variant: "destructive"
      });
      return;
    }

    if (prompts.length === 0) {
      toast({
        title: "Add at least one prompt",
        description: "Enter one prompt per line to build your sequence.",
        variant: "destructive"
      });
      return;
    }

    const timestamp = new Date().toISOString();
    const description = formState.description.trim() || undefined;

    if (editingId) {
      setSequences(prev =>
        prev.map(sequence =>
          sequence.id === editingId
            ? {
                ...sequence,
                name,
                description,
                prompts,
                updatedAt: timestamp
              }
            : sequence
        )
      );

      toast({
        title: "Sequence updated",
        description: `${name} has been updated.`
      });
    } else {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const newSequence: PromptSequence = {
        id,
        name,
        description,
        prompts,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      setSequences(prev => [newSequence, ...prev]);

      toast({
        title: "Sequence saved",
        description: `${name} is ready to use.`
      });
    }

    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Manage Prompt Sequences
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Prompt Sequences</DialogTitle>
          <DialogDescription>
            Save reusable prompt flows to accelerate your AI content generation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="prompt-sequence-name">Sequence Name</Label>
            <Input
              id="prompt-sequence-name"
              value={formState.name}
              onChange={event =>
                setFormState(previous => ({ ...previous, name: event.target.value }))
              }
              placeholder="Seasonal promotion flow"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prompt-sequence-description">Description (optional)</Label>
            <Input
              id="prompt-sequence-description"
              value={formState.description}
              onChange={event =>
                setFormState(previous => ({ ...previous, description: event.target.value }))
              }
              placeholder="Used for holiday campaign email + social prompts"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prompt-sequence-prompts">Prompts</Label>
            <Textarea
              id="prompt-sequence-prompts"
              value={formState.promptsText}
              onChange={event =>
                setFormState(previous => ({ ...previous, promptsText: event.target.value }))
              }
              placeholder="Write one prompt per line to define the sequence."
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              Each line becomes an individual prompt. Order is preserved when you reuse the sequence.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" className="gap-2">
              {editingId ? "Update Sequence" : "Save Sequence"}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel Edit
              </Button>
            )}
          </div>
        </form>

        <Separator className="my-4" />

        <div className="space-y-4">
          {sortedSequences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Saved sequences will appear here. Create your first sequence to start reusing prompt flows.
            </p>
          ) : (
            sortedSequences.map(sequence => (
              <Card key={sequence.id}>
                <CardHeader className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {sequence.name}
                        <Badge variant="secondary">{sequence.prompts.length} prompts</Badge>
                      </CardTitle>
                      {sequence.description && (
                        <p className="text-sm text-muted-foreground">{sequence.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(sequence)}
                        aria-label={`Edit ${sequence.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${sequence.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this sequence?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. The sequence "{sequence.name}" will be permanently removed.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(sequence.id)}>
                              Confirm Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ol className="list-decimal space-y-2 pl-5 text-sm">
                    {sequence.prompts.map((prompt, index) => (
                      <li key={index} className="leading-relaxed">
                        {prompt}
                      </li>
                    ))}
                  </ol>
                </CardContent>
                <CardFooterSection className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
                  <span>Last updated {new Date(sequence.updatedAt).toLocaleString()}</span>
                  <span>Created {new Date(sequence.createdAt).toLocaleString()}</span>
                </CardFooterSection>
              </Card>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PromptSequenceManager;
