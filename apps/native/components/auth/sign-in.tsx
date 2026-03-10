import { Button, ErrorView, Spinner, Surface, TextField } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { useBetterAuthClient } from "@/lib/auth-client";
import { getDefaultServerUrl } from "@/lib/server-url";
import { useAuthStore } from "@/store/auth-store";

function SignIn() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const authClient = useBetterAuthClient(serverUrl || getDefaultServerUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setIsLoading(true);
    setError(null);

    await authClient.signIn.username(
      {
        username,
        password,
      },
      {
        onError(error) {
          setError(error.error?.message || "Failed to sign in");
          setIsLoading(false);
        },
        onSuccess() {
          setUsername("");
          setPassword("");
        },
        onFinished() {
          setIsLoading(false);
        },
      }
    );
  }

  return (
    <Surface className="rounded-lg p-4" variant="secondary">
      <Text className="mb-4 font-medium text-foreground">Sign In</Text>

      <ErrorView className="mb-3" isInvalid={!!error}>
        {error}
      </ErrorView>

      <View className="gap-3">
        <TextField>
          <TextField.Label>Username</TextField.Label>
          <TextField.Input
            autoCapitalize="none"
            onChangeText={setUsername}
            placeholder="admin"
            value={username}
          />
        </TextField>

        <TextField>
          <TextField.Label>Password</TextField.Label>
          <TextField.Input
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            value={password}
          />
        </TextField>

        <Button className="mt-1" isDisabled={isLoading} onPress={handleLogin}>
          {isLoading ? (
            <Spinner color="default" size="sm" />
          ) : (
            <Button.Label>Sign In</Button.Label>
          )}
        </Button>
      </View>
    </Surface>
  );
}

export { SignIn };
