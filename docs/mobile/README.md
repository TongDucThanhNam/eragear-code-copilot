# Mobile App Documentation (`apps/native`)

React Native mobile app for Eragear Code Copilot built with Expo.

## Tech Stack
- **Framework**: Expo (React Native)
- **UI Components**: HeroUI Native
- **Styling**: Tailwind CSS v4 + NativeWind
- **Routing**: Expo Router
- **State Management**: Zustand
- **Authentication**: Better-Auth (via `@better-auth/expo`)

---

## Source Layout

```
app/
├── _layout.tsx                 # Root layout with providers
├── +not-found.tsx              # 404 screen
├── modal.tsx                   # Modal screen
├── (drawer)/
│   ├── _layout.tsx             # Drawer layout
│   └── index.tsx               # Session list (home)
└── chats/
    └── [chatId].tsx            # Chat screen

components/
├── error-toast-handler.tsx     # Error toast component
├── auth/                       # Authentication components
├── chat/                       # Chat UI components
└── common/                     # Shared components

contexts/
├── app-theme-context.tsx       # Theme provider
└── trpc-provider.tsx           # tRPC provider

hooks/
├── use-chat.ts                 # Chat hook
└── use-error-toast.ts          # Error toast hook

lib/
├── auth-client.ts              # Better-Auth client
├── env.ts                      # Environment variables
└── trpc.ts                     # tRPC client setup

store/
├── chat-store.ts               # Chat state (Zustand)
└── settings-store.ts           # Settings state
```

---

## Key Files

| File | Description |
|------|-------------|
| `app/(drawer)/index.tsx` | Session list screen |
| `app/chats/[chatId].tsx` | Chat screen (read-only support) |
| `store/chat-store.ts` | Zustand store for chat state |
| `lib/auth-client.ts` | Better-Auth client |
| `contexts/trpc-provider.tsx` | tRPC provider with WebSocket |

---

## UI Components

### HeroUI Native
Using HeroUI Native component library for consistent, native-feeling UI.

Key components:
- `Button`, `Card`, `TextField`
- `Dialog`, `BottomSheet`
- `Toast`, `Spinner`
- `Tabs`, `Accordion`

### Chat Interface
- Message list with native scrolling
- Input area with keyboard handling
- Session status indicators
- Read-only mode for inactive sessions

---

## State Management

### Zustand Stores

**Chat Store** (`store/chat-store.ts`)
- Current session
- Message history
- Connection status

**Settings Store** (`store/settings-store.ts`)
- Server URL
- Agent configuration
- Theme preferences

---

## Authentication

Using Better-Auth with Expo adapter (`@better-auth/expo`).

Configuration in `lib/auth-client.ts`.

---

## Development

### Start Expo Dev Server
```bash
cd apps/native
bun run start
```

Or from root:
```bash
bun run dev:native
```

### Run on Device/Emulator

```bash
# Android
bun run android

# iOS
bun run ios

# Web (for testing)
bun run web
```

### Build
```bash
# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

---

## Configuration

### Environment Variables
Configure in `lib/env.ts`:
- `API_URL` - Backend server URL
- `WS_URL` - WebSocket URL

### App Configuration
`app.json`:
- App name, version, bundle ID
- Expo plugins configuration
- Build settings

---

## NativeWind Setup

Using Tailwind CSS v4 with NativeWind for styling.

### Configuration Files
- `global.css` - Global styles and Tailwind imports
- `metro.config.js` - Metro bundler config
- `uniwind-types.d.ts` - TypeScript types

### Usage
```tsx
import { View, Text } from 'react-native';

export function MyComponent() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-lg font-bold text-foreground">
        Hello World
      </Text>
    </View>
  );
}
```

---

## Current Status

See [MOBILE_TODO.md](../MOBILE_TODO.md) for current implementation status and roadmap.

### Implemented
- Session list view
- Chat screen (read-only)
- tRPC connection
- Basic navigation

### In Progress
- Full chat interaction
- Tool permission dialogs
- Session creation
- Settings screen

---

## Coding Standards

### Component Structure
- Use functional components with hooks
- Keep components small and focused
- Use HeroUI Native for UI primitives

### Navigation
- Use Expo Router for navigation
- File-based routing in `app/` directory
- Drawer layout for main navigation

### Styling
- Use Tailwind classes via NativeWind
- Follow platform conventions (iOS/Android)
- Support dark/light theme
