import "@/global.css";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorToastHandler } from "@/components/error-toast-handler";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { TRPCProvider } from "@/contexts/trpc-provider";

export const unstable_settings = {
	initialRouteName: "(drawer)",
};

function StackLayout() {
	return (
		<Stack screenOptions={{}}>
			<Stack.Screen name="(drawer)" options={{ headerShown: false }} />
			<Stack.Screen name="chats/[chatId]" options={{ headerShown: false }} />
			<Stack.Screen
				name="modal"
				options={{ title: "Modal", presentation: "modal" }}
			/>
		</Stack>
	);
}

export default function Layout() {
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<KeyboardProvider>
				<AppThemeProvider>
					<HeroUINativeProvider
						config={{
							devInfo: {
								stylingPrinciples: false,
							},
						}}
					>
						<TRPCProvider>
							<ErrorToastHandler />
							<StackLayout />
						</TRPCProvider>
					</HeroUINativeProvider>
				</AppThemeProvider>
			</KeyboardProvider>
		</GestureHandlerRootView>
	);
}
