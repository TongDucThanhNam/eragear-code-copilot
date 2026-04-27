import {
  Alert,
  Avatar,
  Button,
  Card,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
} from "heroui-native";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useBetterAuthClient } from "@/lib/auth-client";
import { getDefaultServerUrl } from "@/lib/server-url";
import { useAuthStore } from "@/store/auth-store";

function SignIn() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const authClient = useBetterAuthClient(serverUrl || getDefaultServerUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function handleUsernameChange(text: string) {
    setUsername(text);
    if (usernameError) setUsernameError(null);
  }

  function handlePasswordChange(text: string) {
    setPassword(text);
    if (passwordError) setPasswordError(null);
  }

  async function handleLogin() {
    // Validate inputs
    let hasError = false;
    setUsernameError(null);
    setPasswordError(null);

    if (!username.trim()) {
      setUsernameError("Username is required");
      hasError = true;
    }

    if (!password.trim()) {
      setPasswordError("Password is required");
      hasError = true;
    }

    if (hasError) return;

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
    <View className="flex-1 justify-center bg-background px-6 dark:bg-black">
      <Card variant="secondary" className="w-full max-w-sm rounded-2xl">
        <Card.Header className="flex-col items-center pb-0">
          <Avatar
            className="mb-3"
            size="lg"
            color="accent"
            alt="App logo"
          >
            <Avatar.Fallback>
              <Ionicons name="code-slash" size={28} />
            </Avatar.Fallback>
          </Avatar>
          <View className="items-center gap-1">
            <Card.Title className="text-center text-xl">Welcome Back</Card.Title>
            <Card.Description className="text-center">
              Sign in to continue to your workspace
            </Card.Description>
          </View>
        </Card.Header>

        <Card.Body className="gap-4 pt-4">
          {error ? (
            <Alert status="danger" className="rounded-xl">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          <TextField isRequired isInvalid={!!usernameError}>
            <Label>Username</Label>
            <Input
              autoCapitalize="none"
              placeholder="Enter your username"
              value={username}
              onChangeText={handleUsernameChange}
            />
            <FieldError>{usernameError}</FieldError>
          </TextField>

          <TextField isRequired isInvalid={!!passwordError}>
            <Label>Password</Label>
            <View className="w-full flex-row items-center">
              <Input
                className="flex-1 pr-10"
                placeholder="Enter your password"
                secureTextEntry={!isPasswordVisible}
                value={password}
                onChangeText={handlePasswordChange}
              />
              <Pressable
                className="absolute right-3"
                accessibilityLabel={isPasswordVisible ? "Hide password" : "Show password"}
                accessibilityRole="button"
                onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              >
                <Ionicons
                  name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  className="text-muted-foreground"
                />
              </Pressable>
            </View>
            <FieldError>{passwordError}</FieldError>
          </TextField>

          <Button
            className="mt-2 w-full"
            variant="primary"
            isDisabled={isLoading}
            onPress={handleLogin}
          >
            <Button.Label>{isLoading ? "Signing in..." : "Sign In"}</Button.Label>
          </Button>
        </Card.Body>

        <Card.Footer className="flex-row justify-center pt-0">
          <Text className="text-sm text-muted-foreground">
            Don't have an account? Contact your administrator.
          </Text>
        </Card.Footer>
      </Card>
    </View>
  );
}

export { SignIn };