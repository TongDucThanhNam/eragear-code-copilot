import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Spinner,
  Surface,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState, useEffect } from "react";
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
import { toHttpUrl } from "@/lib/server-url";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";

// Wrap Ionicons with Uniwind for className support
const StyledIcon = withUniwind(Ionicons);

export default function LoginScreen() {
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { serverUrl: storedServerUrl, apiKey: storedApiKey, setServerUrl, setApiKey } = useAuthStore();
  const { errorMessage: connectionError, clearError: clearConnectionError } = useConnectionStore();
  const hostHint = Platform.OS === "android" ? "10.0.2.2:3000" : "localhost:3000";

  const [serverUrl, setServerUrlInput] = useState(storedServerUrl || "localhost:3000");
  const [apiKey, setApiKeyInput] = useState(storedApiKey || "");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Update local state when store changes
  useEffect(() => {
    if (storedServerUrl) {
      setServerUrlInput(storedServerUrl);
    }
    if (storedApiKey) {
      setApiKeyInput(storedApiKey);
    }
  }, [storedServerUrl, storedApiKey]);

  // Clear connection error when user starts typing
  useEffect(() => {
    if (connectionError && (serverUrl !== storedServerUrl || apiKey !== storedApiKey)) {
      clearConnectionError();
    }
  }, [serverUrl, apiKey, storedServerUrl, storedApiKey, connectionError, clearConnectionError]);

  const testConnection = async (url: string, key: string) => {
    // Temporarily set the server URL
    setServerUrl(url);
    // Set the API key temporarily to verify
    setApiKey(key);

    // Create a quick test query
    const result = await utils.auth.getMe.fetch();
    return result;
  };

  const handleLogin = async () => {
    if (!serverUrl.trim()) {
      setError("Server URL is required");
      return;
    }
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Clean up the server URL
      const cleanUrl = toHttpUrl(serverUrl.trim());

      const result = await testConnection(cleanUrl, apiKey.trim());

      if (result.user) {
        toast.show("Connected successfully!");
      } else {
        setApiKey(null);
        setError("Invalid API key or server rejected connection");
        setIsLoading(false);
      }
    } catch (err) {
      setApiKey(null);
      const message =
        typeof err === "object" && err && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to connect. Please check the server URL and API key.";
      setError(message);
      setIsLoading(false);
    }
  };

  const handleClearAuth = () => {
    setApiKey(null);
    setApiKeyInput("");
    setError(null);
    toast.show("Disconnected");
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
            {/* Logo/Icon */}
            <View className="mb-8 h-24 w-24 items-center justify-center rounded-full bg-accent/20">
              <StyledIcon
                color="hsl(var(--color-accent))"
                name="code-slash"
                size={48}
              />
            </View>

            <Text className="mb-2 text-center font-bold text-2xl text-foreground">
              Eragear Code Copilot
            </Text>
            <Text className="mb-4 text-center text-muted-foreground">
              Connect to your server
            </Text>

            {/* Connection Error Banner */}
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
              {/* Server URL Field */}
              <TextField isInvalid={!!error && !apiKey.trim()}>
                <TextField.Label>Server URL</TextField.Label>
                <TextField.Input
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
                <TextField.Description>
                  Enter IP address or hostname with port
                </TextField.Description>
              </TextField>

              {/* API Key Field */}
              <TextField className="mt-4" isInvalid={!!error && !serverUrl.trim()}>
                <TextField.Label>API Key</TextField.Label>
                <View className="w-full flex-row items-center">
                  <TextField.Input
                    autoCapitalize="none"
                    autoComplete="off"
                    className="flex-1 pr-10"
                    onChangeText={(value) => {
                      setApiKeyInput(value);
                      setError(null);
                    }}
                    placeholder="sk_..."
                    placeholderTextColor="hsl(var(--color-muted))"
                    secureTextEntry={!isPasswordVisible}
                    value={apiKey}
                  />
                  <Pressable
                    accessibilityLabel={
                      isPasswordVisible ? "Hide API key" : "Show API key"
                    }
                    accessibilityRole="button"
                    className="absolute right-4"
                    onPress={() => setIsPasswordVisible(!isPasswordVisible)}
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
                {error && (
                  <TextField.ErrorMessage>{error}</TextField.ErrorMessage>
                )}
              </TextField>

              {/* Show Advanced Toggle */}
              <Pressable
                className="mt-3 flex-row items-center gap-2"
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                <StyledIcon
                  color="hsl(var(--color-muted))"
                  name={showAdvanced ? "chevron-up-outline" : "chevron-down-outline"}
                  size={16}
                />
                <Text className="text-muted-foreground text-sm">
                  {showAdvanced ? "Hide" : "Show"} advanced options
                </Text>
              </Pressable>

              {/* Advanced Options */}
              {showAdvanced && (
                <View className="mt-4 rounded-lg border border-muted/30 p-3">
                  <Text className="mb-2 font-medium text-foreground text-sm">
                    Connection Status
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
                      API Key: {storedApiKey ? "••••••••" : "Not configured"}
                    </Text>
                  </View>
                  {storedApiKey && (
                    <Button
                      className="mt-3"
                      color="danger"
                      size="sm"
                      variant="ghost"
                      onPress={handleClearAuth}
                    >
                      <Button.Label>Clear Saved Credentials</Button.Label>
                    </Button>
                  )}
                </View>
              )}

              {/* Connect Button */}
              <Button
                className="mt-6"
                isDisabled={isLoading || !serverUrl.trim() || !apiKey.trim()}
                onPress={handleLogin}
                size="lg"
              >
                {isLoading ? (
                  <Spinner
                    color={themeColorAccentForeground}
                    isLoading={true}
                    size="sm"
                  />
                ) : (
                  <Button.Label>Connect</Button.Label>
                )}
              </Button>
            </Surface>

            <View className="mt-8 items-center">
              <Text className="text-center text-muted-foreground text-sm">
                First time setup?
              </Text>
              <Text className="mt-1 text-center text-muted-foreground text-xs">
                1. Start server with AUTH_BOOTSTRAP_API_KEY=true
                {"\n"}
                2. Copy API key from console
                {"\n"}
                3. Enter server URL and API key above
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Container>
  );
}
