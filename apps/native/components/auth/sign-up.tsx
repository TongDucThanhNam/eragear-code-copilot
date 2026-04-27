import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Spinner,
  Surface,
  TextField,
} from "heroui-native";
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function handleNameChange(text: string) {
    setName(text);
    if (nameError) setNameError(null);
  }

  function handleEmailChange(text: string) {
    setEmail(text);
    if (emailError) setEmailError(null);
  }

  function handlePasswordChange(text: string) {
    setPassword(text);
    if (passwordError) setPasswordError(null);
  }

  function validateForm(): boolean {
    let isValid = true;

    if (!name.trim()) {
      setNameError("Name is required");
      isValid = false;
    }

    if (!email.trim()) {
      setEmailError("Email is required");
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email");
      isValid = false;
    }

    if (!password.trim()) {
      setPasswordError("Password is required");
      isValid = false;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      isValid = false;
    }

    return isValid;
  }

  function handlePress() {
    if (!validateForm()) return;

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
        <TextField isRequired isInvalid={!!nameError}>
          <Label>Name</Label>
          <Input
            onChangeText={handleNameChange}
            placeholder="John Doe"
            value={name}
          />
          <FieldError>{nameError}</FieldError>
        </TextField>

        <TextField isRequired isInvalid={!!emailError}>
          <Label>Email</Label>
          <Input
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={handleEmailChange}
            placeholder="email@example.com"
            value={email}
          />
          <FieldError>{emailError}</FieldError>
        </TextField>

        <TextField isRequired isInvalid={!!passwordError}>
          <Label>Password</Label>
          <Input
            onChangeText={handlePasswordChange}
            placeholder="••••••••"
            secureTextEntry
            value={password}
          />
          <FieldError>{passwordError}</FieldError>
        </TextField>

        <Button
          className="mt-1"
          isDisabled={isLoading}
          onPress={handlePress}
        >
          {isLoading ? (
            <Spinner size="sm" />
          ) : (
            <Button.Label>Create Account</Button.Label>
          )}
        </Button>
      </View>
    </Surface>
  );
}
