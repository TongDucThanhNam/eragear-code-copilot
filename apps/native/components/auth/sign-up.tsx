import { Alert, Button, Input, Label, Spinner, Surface, TextField } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { useBetterAuthClient } from "@/lib/auth-client";
import { getDefaultServerUrl } from "@/lib/server-url";
import { useAuthStore } from "@/store/auth-store";

function signUpHandler({
  authClient,
  name,
  email,
  password,
  setError,
  setIsLoading,
  setName,
  setEmail,
  setPassword,
}: {
  authClient: ReturnType<typeof useBetterAuthClient>;
  name: string;
  email: string;
  password: string;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setName: (name: string) => void;
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
}) {
  setIsLoading(true);
  setError(null);

  authClient.signUp.email(
    {
      name,
      email,
      password,
    },
    {
      onError(error) {
        setError(error.error?.message || "Failed to sign up");
        setIsLoading(false);
      },
      onSuccess() {
        setName("");
        setEmail("");
        setPassword("");
      },
      onFinished() {
        setIsLoading(false);
      },
    }
  );
}

export function SignUp() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const authClient = useBetterAuthClient(serverUrl || getDefaultServerUrl());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePress() {
    signUpHandler({
      authClient,
      name,
      email,
      password,
      setError,
      setIsLoading,
      setName,
      setEmail,
      setPassword,
    });
  }

  return (
    <Surface className="rounded-lg p-4" variant="secondary">
      <Text className="mb-4 font-medium text-foreground">Create Account</Text>

      {error ? (
        <Alert className="mb-3" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <View className="gap-3">
        <TextField>
          <Label>Name</Label>
          <Input
            onChangeText={setName}
            placeholder="John Doe"
            value={name}
          />
        </TextField>

        <TextField>
          <Label>Email</Label>
          <Input
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="email@example.com"
            value={email}
          />
        </TextField>

        <TextField>
          <Label>Password</Label>
          <Input
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            value={password}
          />
        </TextField>

        <Button className="mt-1" isDisabled={isLoading} onPress={handlePress}>
          {isLoading ? (
            <Spinner color="default" size="sm" />
          ) : (
            <Button.Label>Create Account</Button.Label>
          )}
        </Button>
      </View>
    </Surface>
  );
}
