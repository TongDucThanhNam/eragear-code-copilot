import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Spinner,
  Surface,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { withUniwind } from "uniwind";

import { Container } from "@/components/common/container";
import {
  clearStoredBetterAuthSession,
  createBetterAuthClientForServer,
} from "@/lib/auth-client";
import { getDefaultServerUrl, toHttpUrl } from "@/lib/server-url";
import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";

const StyledIcon = withUniwind(Ionicons);

function normalizeErrorMessage(
  error: unknown,
  normalizedTarget: string
): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const isNetworkError =
    lowered.includes("load failed") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("network") ||
    lowered.includes("timed out") ||
    lowered.includes("unable to connect") ||
    lowered.includes("unreachable") ||
    lowered.includes("refused");

  if (isNetworkError) {
    return `Cannot reach server at ${normalizedTarget}. Start apps/server and retry.`;
  }

  return message || "Authentication failed.";
}

export default function LoginScreen() {
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const { toast } = useToast();
  const hostHint =
    Platform.OS === "android" ? "10.0.2.2:3000" : "localhost:3000";
  const {
    serverUrl: storedServerUrl,
    setServerUrl,
    clearServerUrl,
    bumpAuthVersion,
  } = useAuthStore();
  const { errorMessage: connectionError, clearError: clearConnectionError } =
    useConnectionStore();

  const [serverUrl, setServerUrlInput] = useState(
    storedServerUrl || getDefaultServerUrl()
  );
  const [username, setUsernameInput] = useState("");
  const [password, setPasswordInput] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!storedServerUrl) {
      return;
    }
    setServerUrlInput(storedServerUrl);
  }, [storedServerUrl]);

  useEffect(() => {
    if (connectionError && serverUrl !== storedServerUrl) {
      clearConnectionError();
    }
  }, [clearConnectionError, connectionError, serverUrl, storedServerUrl]);

  const hasStoredSession = useMemo(() => {
    if (!storedServerUrl.trim()) {
      return false;
    }

    try {
      const client = createBetterAuthClientForServer(storedServerUrl);
      return client.getCookie().trim().length > 0;
    } catch {
      return false;
    }
  }, [storedServerUrl]);

  const handleLogin = async () => {
    if (!serverUrl.trim()) {
      setError("Server URL is required.");
      return;
    }

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }

    if (!password) {
      setError("Password is required.");
      return;
    }

    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = toHttpUrl(serverUrl.trim());
    } catch {
      setError("Server URL is invalid.");
      return;
    }

    const authClient = createBetterAuthClientForServer(normalizedServerUrl);

    setIsLoading(true);
    setError(null);

    try {
      let signInError: string | null = null;

      const result = await authClient.signIn.username(
        {
          username: username.trim(),
          password,
        },
        {
          onError(context: { error: { message?: string } }) {
            signInError =
              context.error.message || "Invalid username or password.";
          },
        }
      );

      if (result.error) {
        throw new Error(
          result.error.message || "Invalid username or password."
        );
      }

      if (signInError) {
        throw new Error(signInError);
      }

      setServerUrl(normalizedServerUrl);
      bumpAuthVersion();
      clearConnectionError();
      setPasswordInput("");
      toast.show("Signed in successfully!");
    } catch (loginError) {
      await clearStoredBetterAuthSession(normalizedServerUrl);
      bumpAuthVersion();
      setError(normalizeErrorMessage(loginError, normalizedServerUrl));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSavedSession = async () => {
    if (storedServerUrl.trim()) {
      await clearStoredBetterAuthSession(storedServerUrl);
    }

    clearServerUrl();
    bumpAuthVersion();
    clearConnectionError();
    setPasswordInput("");
    setError(null);
    setServerUrlInput(getDefaultServerUrl());
    toast.show("Cleared saved session");
  };

  return (
    <Container>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flex: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 items-center justify-center px-6">
            <View className="mb-8 h-24 w-24 items-center justify-center rounded-full bg-accent/20">
              <StyledIcon
                color="hsl(var(--color-accent))"
                name="shield-checkmark-outline"
                size={48}
              />
            </View>

            <Text className="mb-2 text-center font-bold text-2xl text-foreground">
              Eragear Code Copilot
            </Text>
            <Text className="mb-4 text-center text-muted-foreground">
              Sign in with your server account
            </Text>

            {connectionError && (
              <View className="mb-4 w-full max-w-sm rounded-lg bg-warning/20 p-3">
                <View className="flex-row items-center gap-2">
                  <StyledIcon
                    color="hsl(var(--color-warning))"
                    name="warning-outline"
                    size={20}
                  />
                  <View className="flex-1">
                    <Text className="font-medium text-sm text-warning">
                      Connection Issue
                    </Text>
                    <Text className="text-warning/80 text-xs">
                      {connectionError}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <Surface
              className="w-full max-w-sm rounded-xl p-6"
              variant="secondary"
            >
              <TextField isInvalid={!!error && !serverUrl.trim()}>
                <Label>Server URL</Label>
                <Input
                  autoCapitalize="none"
                  autoComplete="url"
                  className="w-full"
                  onChangeText={(value) => {
                    setServerUrlInput(value);
                    setError(null);
                  }}
                  placeholder={`${hostHint} or http://192.168.1.100:3000`}
                  placeholderTextColor="hsl(var(--color-muted))"
                  value={serverUrl}
                />
                <Description>
                  Enter the server hostname or IP with port.
                </Description>
              </TextField>

              <TextField
                className="mt-4"
                isInvalid={!!error && !username.trim()}
              >
                <Label>Username</Label>
                <Input
                  autoCapitalize="none"
                  autoComplete="username"
                  className="w-full"
                  onChangeText={(value) => {
                    setUsernameInput(value);
                    setError(null);
                  }}
                  placeholder="admin"
                  placeholderTextColor="hsl(var(--color-muted))"
                  value={username}
                />
              </TextField>

              <TextField className="mt-4" isInvalid={!!error && !password}>
                <Label>Password</Label>
                <View className="w-full flex-row items-center">
                  <Input
                    autoCapitalize="none"
                    autoComplete="password"
                    className="flex-1 pr-10"
                    onChangeText={(value) => {
                      setPasswordInput(value);
                      setError(null);
                    }}
                    placeholder="••••••••"
                    placeholderTextColor="hsl(var(--color-muted))"
                    secureTextEntry={!isPasswordVisible}
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={
                      isPasswordVisible ? "Hide password" : "Show password"
                    }
                    accessibilityRole="button"
                    className="absolute right-4"
                    onPress={() => setIsPasswordVisible((visible) => !visible)}
                  >
                    <StyledIcon
                      color="hsl(var(--color-muted))"
                      name={
                        isPasswordVisible ? "eye-off-outline" : "eye-outline"
                      }
                      size={18}
                    />
                  </Pressable>
                </View>
                {error ? <FieldError>{error}</FieldError> : null}
              </TextField>

              <Pressable
                className="mt-3 flex-row items-center gap-2"
                onPress={() => setShowAdvanced((visible) => !visible)}
              >
                <StyledIcon
                  color="hsl(var(--color-muted))"
                  name={
                    showAdvanced ? "chevron-up-outline" : "chevron-down-outline"
                  }
                  size={16}
                />
                <Text className="text-muted-foreground text-sm">
                  {showAdvanced ? "Hide" : "Show"} saved connection
                </Text>
              </Pressable>

              {showAdvanced && (
                <View className="mt-4 rounded-lg border border-muted/30 p-3">
                  <Text className="mb-2 font-medium text-foreground text-sm">
                    Saved State
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <View className="h-2 w-2 rounded-full bg-muted" />
                    <Text className="text-muted-foreground text-xs">
                      Server: {storedServerUrl || "Not configured"}
                    </Text>
                  </View>
                  <View className="mt-2 flex-row items-center gap-2">
                    <View className="h-2 w-2 rounded-full bg-muted" />
                    <Text className="text-muted-foreground text-xs">
                      Session: {hasStoredSession ? "Present" : "Not stored"}
                    </Text>
                  </View>
                  {(storedServerUrl || hasStoredSession) && (
                    <Button
                      className="mt-3"
                      onPress={() => {
                        handleClearSavedSession();
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Button.Label>Clear Saved Session</Button.Label>
                    </Button>
                  )}
                </View>
              )}

              <Button
                className="mt-6"
                isDisabled={
                  isLoading ||
                  !serverUrl.trim() ||
                  !username.trim() ||
                  !password
                }
                onPress={() => {
                  handleLogin();
                }}
                size="lg"
              >
                {isLoading ? (
                  <Spinner
                    color={themeColorAccentForeground}
                    isLoading={true}
                    size="sm"
                  />
                ) : (
                  <Button.Label>Sign In</Button.Label>
                )}
              </Button>
            </Surface>

            <View className="mt-8 items-center">
              <Text className="text-center text-muted-foreground text-sm">
                Use the username/password configured on the server.
              </Text>
              <Text className="mt-1 text-center text-muted-foreground text-xs">
                Browser and mobile now share the same Better Auth session model.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Container>
  );
}
