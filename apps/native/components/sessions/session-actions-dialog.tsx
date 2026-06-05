import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Button,
  Chip,
  Description,
  Dialog,
  Input,
  Label,
  Separator,
  TextField,
  useThemeColor,
} from "heroui-native";
import { Alert as NativeAlert, View } from "react-native";
import type { SessionActionTarget } from "./types";

interface SessionActionsDialogProps {
  isDeleting: boolean;
  isSaving: boolean;
  nameDraft: string;
  target: SessionActionTarget | null;
  onChangeNameDraft: (value: string) => void;
  onDeleteConfirmed: () => void;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onToggleArchive: () => void;
  onTogglePin: () => void;
}

export function SessionActionsDialog({
  isDeleting,
  isSaving,
  nameDraft,
  target,
  onChangeNameDraft,
  onDeleteConfirmed,
  onOpenChange,
  onRename,
  onToggleArchive,
  onTogglePin,
}: SessionActionsDialogProps) {
  const [
    defaultForegroundColor,
    accentForegroundColor,
    dangerForegroundColor,
  ] = useThemeColor([
    "default-foreground",
    "accent-foreground",
    "danger-foreground",
  ]);
  const trimmedName = nameDraft.trim();
  const originalName = target?.name?.trim() ?? "";
  const isBusy = isSaving || isDeleting;
  const canSaveName = Boolean(target) && trimmedName !== originalName;

  return (
    <Dialog isOpen={Boolean(target)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="px-5 py-5">
          <Dialog.Close variant="ghost" />
          <View className="gap-1.5">
            <Dialog.Title>Session Options</Dialog.Title>
            <View className="flex-row flex-wrap gap-1.5">
              {target?.pinned ? (
                <Chip color="warning" size="sm" variant="soft">
                  <Chip.Label>Pinned</Chip.Label>
                </Chip>
              ) : null}
              {target?.archived ? (
                <Chip color="warning" size="sm" variant="soft">
                  <Chip.Label>Archived</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </View>

          <View className="mt-4 gap-2">
            <TextField>
              <Label>Rename Session</Label>
              <Input
                autoCapitalize="none"
                editable={!isBusy}
                onChangeText={onChangeNameDraft}
                placeholder="Session name"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (canSaveName && !isBusy) {
                    onRename();
                  }
                }}
                value={nameDraft}
              />
              <Description>
                Blank uses the session identifier.
              </Description>
            </TextField>

            <Button
              isDisabled={!canSaveName || isBusy}
              onPress={onRename}
              size="sm"
            >
              <Ionicons
                color={accentForegroundColor}
                name="checkmark"
                size={18}
              />
              <Button.Label>
                {isSaving ? "Saving..." : "Save Name"}
              </Button.Label>
            </Button>
          </View>

          <View className="mt-3 flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={isBusy}
              onPress={onTogglePin}
              size="sm"
              variant={target?.pinned ? "secondary" : "ghost"}
            >
              <Ionicons
                color={defaultForegroundColor}
                name={target?.pinned ? "pin" : "pin-outline"}
                size={18}
              />
              <Button.Label>
                {target?.pinned ? "Unpin Session" : "Pin Session"}
              </Button.Label>
            </Button>
            <Button
              className="flex-1"
              isDisabled={isBusy}
              onPress={onToggleArchive}
              size="sm"
              variant={target?.archived ? "secondary" : "ghost"}
            >
              <Ionicons
                color={defaultForegroundColor}
                name={target?.archived ? "archive" : "archive-outline"}
                size={18}
              />
              <Button.Label>
                {target?.archived ? "Unarchive Session" : "Archive Session"}
              </Button.Label>
            </Button>
          </View>

          <Separator className="my-3" />

          <View className="gap-2">
            <Alert className="items-center" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Delete session</Alert.Title>
              </Alert.Content>
              <Button
                isDisabled={isBusy}
                onPress={() => {
                  NativeAlert.alert(
                    "Delete Session",
                    "Are you sure you want to delete this session?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: onDeleteConfirmed,
                      },
                    ]
                  );
                }}
                size="sm"
                variant="danger"
              >
                <Ionicons
                  color={dangerForegroundColor}
                  name="trash-outline"
                  size={16}
                />
                <Button.Label>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button.Label>
              </Button>
            </Alert>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
