import { Button, Dialog, Input, Label, TextField } from "heroui-native";
import { ScrollView, View } from "react-native";
import type { ProjectFormState } from "./types";

interface ProjectFormDialogProps {
  form: ProjectFormState;
  isOpen: boolean;
  isSubmitting: boolean;
  mode: "create" | "edit";
  showDelete?: boolean;
  onChangeForm: React.Dispatch<React.SetStateAction<ProjectFormState>>;
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}

export function ProjectFormDialog({
  form,
  isOpen,
  isSubmitting,
  mode,
  showDelete = false,
  onChangeForm,
  onDelete,
  onOpenChange,
  onSubmit,
}: ProjectFormDialogProps) {
  const isCreate = mode === "create";

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Close variant="ghost" />
          <Dialog.Title>{isCreate ? "Create Project" : "Edit Project"}</Dialog.Title>
          <Dialog.Description>
            {isCreate
              ? "Add a new project to organize your coding sessions."
              : "Update your project details or delete it."}
          </Dialog.Description>

          <ScrollView className="max-h-75 mt-4">
            <View className="gap-3">
              <TextField>
                <Label>Name</Label>
                <Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    onChangeForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="My Project"
                  value={form.name}
                />
              </TextField>

              <TextField>
                <Label>Path</Label>
                <Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    onChangeForm((prev) => ({ ...prev, path: value }))
                  }
                  placeholder="/absolute/path/to/project"
                  value={form.path}
                />
              </TextField>

              <TextField>
                <Label>Description</Label>
                <Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    onChangeForm((prev) => ({ ...prev, description: value }))
                  }
                  placeholder="Optional description"
                  value={form.description}
                />
              </TextField>

              <TextField>
                <Label>Tags</Label>
                <Input
                  autoCapitalize="none"
                  onChangeText={(value) =>
                    onChangeForm((prev) => ({ ...prev, tags: value }))
                  }
                  placeholder="frontend, api, ui"
                  value={form.tags}
                />
              </TextField>
            </View>
          </ScrollView>

          <View className="mt-4 flex-row justify-end gap-3">
            <Button onPress={() => onOpenChange(false)} variant="ghost">
              <Button.Label>Cancel</Button.Label>
            </Button>
            <Button isDisabled={isSubmitting} onPress={onSubmit}>
              <Button.Label>
                {isSubmitting
                  ? isCreate
                    ? "Creating..."
                    : "Saving..."
                  : isCreate
                    ? "Create Project"
                    : "Save Changes"}
              </Button.Label>
            </Button>
          </View>

          {showDelete && onDelete ? (
            <View className="mt-4 border-t border-border pt-4">
              <Button onPress={onDelete} variant="danger-soft">
                <Button.Label>Delete Project</Button.Label>
              </Button>
            </View>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
