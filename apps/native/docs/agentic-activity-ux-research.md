# Báo Cáo Nghiên Cứu UX/UI: Agentic Activity Component
**Ngày:** February 1, 2026  
**Dự án:** EraGear Code Copilot - AI Chat App

---

## Executive Summary

Báo cáo này phân tích và đề xuất cải thiện UX/UI cho `agentic-activity` component, chịu trách nhiệm hiển thị các hoạt động của AI agent (tool calls, thinking, planning) trong chat interface. Component hiện tại đã có cấu trúc tốt nhưng có thể cải thiện về visual hierarchy, animation patterns, và sử dụng components từ HeroUI Native.

---

## 1. HeroUI Native Components Phù Hợp

Dựa trên sự phân tích codebase hiện tại, dưới đây là các components HeroUI Native có sẵn và ứng dụng tiềm năng:

| Component | Tích hợp hiện tại | Ứng dụng đề xuất | Mức độ ưu tiên |
|-----------|-----------------|-----------------|---------------|
| **Accordion** | ✅ Đang sử dụng (message-item.tsx, tool-result-part.tsx) | Expandable activity groups, detail sections | **Cao** |
| **Chip** | ✅ Đang sử dụng (agentic-activity.tsx) | Activity type labels, status badges | **Cao** |
| **Spinner** | ✅ Đang sử dụng (agentic-activity.tsx) | Running state indicators | **Trung bình** |
| **Button** | ✅ Có sẵn | Action buttons within activities | Trung bình |
| **Surface** | ✅ Có sẵn | Container backgrounds for activity groups | Trung bình |
| **TextField** | ✅ Có sẵn | Filter/search activities (future) | Thấp |
| **Popover** | ✅ Có sẵn | Quick details preview on long-press | Thấp |
| **Modal** | ✅ Có sẵn | Full activity details view | Thấp |
| **Badge** (không chắc chắn có, có thể dùng Chip thay thế) | ❌ Không thấy sử dụng | Notification-like counters | Thấp |

*Note: HeroUI Native là beta version, một số components có thể chưa có tài liệu đầy đủ. Luôn tham khảo documentation trước khi implement.*

### Icon Libraries Available
- **@expo/vector-icons** (Ionicons): Đã được sử dụng trong codebase
- Có thể kết hợp với custom AgentIcon (component/project đã có)

---

## 2. UX Patterns Phổ Biến cho Activity Feeds trong AI Chat Apps

### 2.1 Display Multiple Activities Without Clutter

| Pattern | Mô tả | Ưu điểm | Nhược điểm |
|---------|-------|---------|------------|
| **Grouped Accordion** | Gom activities theo type, expandable | Clean, scannable, saves space | Requires tap to see details |
| **Collapsible Timeline** | Timeline line với expandable nodes | Visual progression, clear sequence | More complex implementation |
| **Progressive Disclosure** | Show summary initially, expand on interaction | Reduces cognitive load, focus on relevant | Learning curve for users |
| **Staggered Animation** | Items appear sequentially | Smooth, feels "live", attention-grabbing | Can feel slow if too much |
| **Live Scroll Buffer** | Auto-scroll to bottom, limit visible items | Always shows latest, controlled height | Hidden context needs extra action |

**Best Practice cho project này:**
- **Hybrid approach**: Live mode với progressive disclosure, collapsed mode với grouped accordion
- Component hiện tại đã áp dụng pattern này tốt - chỉ cần tinh chỉnh animation và visual feedback

### 2.2 Status Indicators (Running/Completed/Error)

| Status | Best Practice | Color (light/dark) | Animation |
|--------|---------------|-------------------|-----------|
| **Running** | Subtle pulse + spinner | Accent color (accent/accent-foreground) | Pulsing glow (800-1000ms cycle) |
| **Completed** | Success checkmark + subtle glow | Success green (success/success-foreground) | Scale bump (1.02→1.0, 200-300ms) |
| **Error** | Warning icon + visible border | Danger red (danger/danger-foreground) | Shake animation + fade in |
| **Queued/Pending** | Neutral dot + opacity | Muted foreground | Fade in (300ms) |

**Best Practices:**
- Mỗi status nên có visual distinctiveness ngay lập tức (2 seconds first impression)
- Running state nên có continuous nhưng subtle animation (đừng gâydistraction)
- Completed nên có micro-interaction để "celebrate" completion
- Error nên draw attention nhưng không overwhelming

### 2.3 Animation Recommendations

| Animation Type | Purpose | Duration | Timing Easing | Intensity |
|----------------|---------|----------|---------------|-----------|
| **Entry (New activity)** | Attention, not overwhelming | 200-300ms | ease-out | Scale: 0.95→1.0, Fade: 0→1 |
| **Status completion** | Micro-celebration | 200-400ms | ease-in-out | Scale: 1→1.05→1.0 |
| **Pulse (running)** | Indicates activity without distraction | 800-1200ms | in-out (sine) | Opacity: 1→0.7→1, Scale: 1→1.06→1 |
| **Expand/Collapse** | Smooth state transition | 250-350ms | ease-out | Height transition, opacity cross-fade |
| **Error feedback** | Gentle alert | 400-600ms | spring-damped | Small shake (2-4px) |
| **Live mode summary fade** | Transition to collapsed view | 500-800ms | ease-in-out | Opacity: 1→0, TranslateY: 0→-8px |
| **Collapsed mode expand** | Reveal details | 700-1000ms | ease-out | Scale: 0.9→1.0, Opacity: 0→1 |

**Key Animation Principles:**
1. **Subtle over prominent**: Các animations phải không gây distraction
2. **Consistent timing**: Tương tác tương tự nên có tương tự duration
3. **Purposeful**: Mỗi animation phải có purpose rõ ràng (attention, feedback, transition)
4. **Performance**: Sử dụng `react-native-reanimated` cho native animations

### 2.4 Grouping Strategies

| Strategy | Use Case | Implementation |
|----------|----------|----------------|
| **By Activity Kind** | Tool calls, thinking, planning | Accordion sections per kind |
| **By Status** | All running first, then completed | Status-based sorting + sectioning |
| **By Time** | Recent activities visible | Staggered reveal, older items fade/collapse |
| **By Related Tool Calls** | Chain of related tools | Parent-child nesting |
| **Minimal Grouping** | Don't over-organize | Flat list với minimal grouping |

**Recommendation:**
- **Hybrid grouping**: Group by activity kind (primary), sort by status (running first within each group)
- Keep structure flat enough để dễ scan, nhưng có sufficient hierarchy để not feel chaotic

---

## 3. So Sánh Các Approaches

### 3.1 Timeline View vs List View

| Aspect | Timeline View | List View | Verdict |
|--------|---------------|-----------|---------|
| **Visual Progression** | Excellent - clear sequence | Good - implied by order | Timeline wins for progression clarity |
| **Implementation Complexity** | High - custom timeline line | Low - standard list | List wins for simplicity |
| **Scalability** | Limit on vertical space | Better with scroll | List wins for many activities |
| **Touch Target Size** | Potentially small (timeline nodes) | Full width rows | List wins for mobile touch |
| **Information Density** | Can show more info inline | Need expand for details | List wins for controlled density |
| **Mobile-Friendly** | Good with careful spacing | Excellent - full width | List wins for mobile UX |
| **Animation Potential** | Rich (line drawing, node pulse) | Good (staggered entry) | Timeline wins for visual polish |

**Recommendation:** Use **List View with Accordion Groups** for this project
- List view更适合mobile touch targets
- Accordion groups provide implicit timeline structure
- Better fits HeroUI Native component availability
- Current implementation already follows this pattern (good choice)

### 3.2 Compact vs Expandable UI

| Aspect | Compact Mode | Expandable Mode | Verdict |
|--------|--------------|-----------------|---------|
| **Screen Real Estate** | Maximum efficiency | Higher usage per item | Compact wins for dense feeds |
| **Information Visibility** | Minimal (summary only) | Full details available | Expandable wins for detail needs |
| **Cognitive Load** | Low (quick scan) | Higher (decisions to expand) | Compact wins for overview |
| **User Control** | Less (auto-collapsed) | More (manual expand) | Expandable wins for autonomy |
| **Touch Interactions** | Fewer required | Many expands/collapses | Compact wins for efficiency |
| **Use Case** | Browsing many items | Inspecting specific items | Context-dependent |

**Hybrid Recommendation (Current Approach is Good):**
- **Live mode**: Show compact rows, auto-scroll
- **Collapsed/Summary mode**: Compact summary row, expandable on tap
- Maintain current pattern but improve transitions and visual feedback

### 3.3 Icon-Heavy vs Text-Heavy Labels

| Aspect | Icon-Heavy | Text-Heavy | Hybrid | Verdict |
|--------|------------|------------|--------|---------|
| **Recognizability** | Fast for common patterns | More explicit, no ambiguity | Balanced | Hybrid wins |
| **Screen Space** | Efficient (icons small) | Intensive (words need space) | Moderate | Icon-heavy wins for space |
| **Accessibility** | Poor without labels | Excellent (screen readers) | Good with proper labeling | Text-heavy wins for a11y |
| **Language Independence** | Excellent (universal symbols) | Limited (language-specific) | Good | Icon-heavy wins for i18n |
| **Learning Curve** | Higher (need to learn icons) | Lower (explicit labels) | Minimal | Text-heavy wins for clarity |
| **Emotional Expressiveness** | High (icon personality) | Limited (neutral text) | High | Hybrid wins for brand |

**Recommendation: Hybrid Approach (Current is Good Direction):**
- Use icons for activity KIND (tool, thinking, plan) - universal
- Use text for specific details (tool name, thinking summary) - explicit
- Icon sizes: 16-20px for mobile

---

## 4. Khuyến Nghị Cụ Thể

### 4.1 Visual Hierarchy Improvements

#### Current State Analysis
```
[Current Hierarchy in Compact Mode]
├─ Dot indicator (colored by kind)
├─ Kind label (TOOL/THINKING/PLAN) - uppercase, small
├─ Activity title (flex-1, truncated)
└─ Status label (Running/Done) - right-aligned
```

#### Proposed Improvements

**1. Enhance Status Indicators**
```tsx
// Current: Simple Chip for status
<Chip color={isRunning ? "accent" : "success"} size="sm" variant="soft">
  {isRunning ? "RUNNING" : "DONE"}
</Chip>

// Recommendation: Add visual differentiation per state
// Running: Pulsing accent glow + spinner (already partially implemented)
// Completed: Checkmark icon (instead of text "DONE")
// Error: Warning icon + danger color
```

**2. Better Activity Kind Visuals**
```tsx
// Current: Dot + uppercase text label
// Recommendation: Use icons instead of text labels
// - Tool ⚙️ (Ionicons: settings-outline)
// - Thinking 💭 (Ionicons: bulb-outline)
// - Plan 📋 (Ionicons: list-outline)

// Benefits:
// - Faster recognition
// - Language independent
// - Consistent with mobile patterns
```

**3. Progressive Disclosure Pattern**
```
┌────────────────────────────────────────────────────┐
│ [⚙️] Tool: code_search                       [⏳]│ ← Running (pulsing)
│     └─ "Searching for files matching pattern..."    │   ← Subtitle (optional)
├────────────────────────────────────────────────────┤
│ [💭] Thinking                                 [✓] │ ← Completed (checkmark)
├────────────────────────────────────────────────────┤
│ [Ⓜ️] Plan updated (3 steps)                   [✓] │
├────────────────────────────────────────────────────┤
│ +2 more activities [tap to expand]                  │ ← Collapse hint
└────────────────────────────────────────────────────┘
```

### 4.2 Collapse/Expand Patterns

**Accordions:** HeroUI Native Accordion có sẵn và hoạt động tốt. Các best practices:

| Pattern | Implementation | Rationale |
|---------|----------------|-----------|
| **Single or multiple expand** | Support both (let parent control) | Flexible for different use cases |
| **Animated transition** | 250-350ms ease-out | Smooth but not sluggish |
| **Touch target** | Min 44px height (iOS HIG) | Usable touch area |
| **Visual indicator** | Chevron icon rotates on expand | Clear affordance |
| **Border/separator** | Subtle border between items | Visual separation |
| **Padding** | Consistent 12-16px for content | Breathing room |

**Proposed Accordion Structure:**
```tsx
<Accordion variant="surface" type={props.multiple ? "multiple" : "single"}>
  {activities.map((activity) => (
    <Accordion.Item key={activity.id} value={activity.id}>
      <Accordion.Trigger 
        className={cn(
          "min-h-10 px-3 py-2",
          "flex-row items-center justify-between",
          isRunning && "bg-accent/5", // Subtle highlight for running
          isRunning && "border-l-2 border-accent", // Left accent line
        )}
      >
        {/* Icon + Title + Status */}
      </Accordion.Trigger>
      <Accordion.Content className="px-3 pt-2 pb-3 border-t border-divider">
        {/* Activity details */}
      </Accordion.Content>
    </Accordion.Item>
  ))}
</Accordion>
```

### 4.3 Animation/Timing Recommendations

#### Animation State Machine
```
State Transitions:
─────────────────────────────────────────────────────────────────────────
Entry                    →    Running            →    Completed
  |                           |                        |
  | Fade In: 200ms            | Pulse cycle:           | Scale bump:
  | Scale: 0.95→1.0           | 800-1200ms             | 1→1.05→1.0
  | easing: ease-out          | opacity: 1→0.7→1       | duration: 200+160ms
  |                           | scale: 1→1.06→1        | easing: ease-in-out
                              | easing: in-out         |
                              |                        |
  └────────────(cancel)───►   Error                   └─────(error)────►
                              |                        |
                              | Shake: 400-600ms       | Shake + fade red
                              | 2-4px x translation     |
                              | spring-damped          |
```

#### Timing Constants (Use in code)
```typescript
// Animation timing constants
const ANIMATION = {
  ENTRY: { duration: 200, easing: 'ease-out' },
  STATUS_COMPLETE: { scale: 200, bump: 140 + 160, easing: 'ease-in-out' },
  PULSE_CYCLE: 900, // ms
  EXPAND_COLLAPSE: 250,
  LIVE_TO_SUMMARY: { fade: 500, delay: 150 },
  SUMMARY_EXPAND: { enter: 700, delay: 200 },
  ERROR_SHAKE: 500,
} as const;
```

### 4.4 Component Composition Recommendations

#### Current Structure
```
AgenticActivity
├─ buildActivityModel (logic)
├─ ActivityRow (presentation)
│   ├─ ActivityKind indicator
│   ├─ Activity title
│   └─ Status indicator
└─ (not exported, used in MessageItem)
```

#### Recommended Restructuring

```
AgenticActivity (exported)
├─ buildActivityModel (logic - unchanged)
├─ ActivityList (new - container for list)
│   ├─ ActivityGroup (new - groups by kind)
│   ├─ ActivityRow (refine - presentation)
│   │   ├─ ActivityIcon (new - reusable icon wrapper)
│   │   ├─ ActivityLabel (new - text wrapper)
│   │   └─ ActivityStatus (new - status display)
│   └─ ActivitySummary (new - collapsed view)
└─ types.ts (extract or keep inline)
```

**Rationale:**
1. **ActivityGroup**: Enables grouping by activity kind with consistent styling
2. **ActivityIcon**: Centralizes icon logic (switch for kind, future theming)
3. **ActivityLabel**: Handles text truncation, styling, accessibility labels consistently
4. **ActivityStatus**: Manages all status variations visually
5. **ActivitySummary**: Dedicated component for collapsed/live transition
6. **Better separation of concerns**: Logic, presentation, and state management

#### Example Component Breakdown
```tsx
// ActivityIcon - Reusable icon wrapper
function ActivityIcon({ kind, size = 16 }: { kind: ActivityKind, size?: number }) {
  switch (kind) {
    case 'tool': return <Ionicons name="settings-outline" size={size} className="text-emerald-500" />
    case 'thinking': return <Ionicons name="bulb-outline" size={size} className="text-sky-500" />
    case 'plan': return <Ionicons name="list-outline" size={size} className="text-amber-500" />
  }
}

// ActivityStatus - Consistent status display
function ActivityStatus({ status }: { status: ActivityStatus }) {
  if (status === 'running') {
    return (
      <View className="flex-row items-center gap-1">
        <Spinner size="xs" color="accent" />
        <Text className="text-xs text-foreground/60">Running</Text>
      </View>
    )
  }
  
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name="checkmark-circle" size={14} className="text-success" />
      <Text className="text-xs text-foreground/60">Done</Text>
    </View>
  )
}
```

---

## 5. Potential Edge Cases

### 5.1 Known Cases to Consider

| Edge Case | Description | Mitigation |
|-----------|-------------|------------|
| **Many activities** (>20 items) | Long list, heavy DOM | Implement pagination/virtualization, collapse oldest |
| **Rapid status changes** | UI flicker from continuous updates | Debounce state updates, use transactional updates |
| **Long tool names** | Text overflow in compact mode | Ellipsis truncation, expand to see full |
| **Concurrent tools** | Multiple running at once | Show aggregate count + individual status |
| **Network errors** | Tools fail partway through | Error states, retry affordances |
| **Empty state** | No activities to show | Empty state placeholder or show nothing |
| **Accessibility** | Screen reader navigation | Proper ARIA labels, touch targets, semantic HTML where applicable |
| **Theme transitions** | Light/dark mode switch | Use semantic colors, avoid hardcoded values |
| **Slow animations** | Device performance issues | Respect reduced motion setting, provide graceful degradation |

### 5.2 Accessibility Considerations

```typescript
// Accessibility requirements checklist:
// ✅ Touch targets: Minimum 44x44px (iOS HIG) / 48x48dp (Android)
// ✅ Screen reader labels: All interactive elements have accessibilityLabel
// ✅ Semantic structure: Use proper ARIA roles where applicable
// ✅ Color contrast: 4.5:1 ratio for text, 3:1 for large text/icons
// ✅ Animation respect: Respect prefers-reduced-motion setting
// ✅ Keyboard navigation: Support tab focus for external components
// ✅ State announcements: Status changes announced to screen readers
// ✅ Error states: Clear, actionable error messages
```

### 5.3 Performance Considerations

```
Performance Budget Targets:
├── Initial render: <200ms for 10 activities
├── Status update: <100ms for single item change
├── Animation FPS: 60fps (16.6ms frame budget)
├── Memory: <50MB for 100 activities
├── React Native Reanimated: Use native driver for animations
└── Virtualization: Consider for >50 activities
```

---

## 6. Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
- [ ] Replace text labels (TOOL/THINKING/PLAN) with icons from Ionicons
- [ ] Enhance status indicators with checkmark for completed state
- [ ] Refine running animation (pulse glow intensity)
- [ ] Add touch affordance indicator (chevron icon) for expandable items

### Phase 2: Component Refactoring (2-3 days)
- [ ] Extract `ActivityIcon` component
- [ ] Extract `ActivityStatus` component  
- [ ] Create `ActivityGroup` container
- [ ] Test current animations with new components (ensure no regressions)

### Phase 3: Animation Polish (1-2 days)
- [ ] Implement staggered entry animation for multiple activities
- [ ] Refine live-to-collapsed transition timing
- [ ] Add micro-interactions for status changes
- [ ] Test with prefers-reduced-motion setting

### Phase 4: Edge Cases & Accessibility (1-2 days)
- [ ] Implement empty state handling
- [ ] Add error state visual feedback
- [ ] Accessibility audit and fixes
- [ ] Performance profiling and optimization

### Phase 5: Testing & Polish (1-2 days)
- [ ] User testing with real AI workflows
- [ ] Adjust based on feedback
- [ ] Documentation updates
- [ ] Code review and final polish

**Total Estimated Effort:** 8-11 days

---

## 7. Key Takeaways

1. **Current implementation is solid** - The component already follows good UX patterns
2. **Main improvement areas**: Visual hierarchy (icons over text), animation polish, component organization
3. **HeroUI Native provides sufficient components** - No need for custom UI primitives
4. **Hybrid approach is optimal** - Live + compact summary + expandable details
5. **Animation timing is critical** - Respect users' attention, don't over-animate
6. **Accessibility and performance** - Consider early, not as afterthoughts

---

## 8. References & Resources

### HeroUI Native Documentation
- https://v3.heroui.com/docs/native/getting-started/introduction.mdx
- Accordion Component: https://v3.heroui.com/docs/native/components/accordion.mdx
- Chip Component: https://v3.heroui.com/docs/native/components/chip.mdx
- Spinner Component: https://v3.heroui.com/docs/native/components/spinner.mdx

### Design Guidelines
- iOS Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- Material Design 3: https://m3.material.io/

### Animation Libraries
- React Native Reanimated 3: https://docs.swmansion.com/react-native-reanimated/
- React Native Gesture Handler: https://docs.swmansion.com/react-native-gesture-handler/

### Icons
- Expo Vector Icons (Ionicons): https://docs.expo.dev/guides/icons/

---

**Prepared for:** EraGear Code Copilot Development Team  
**Document Version:** 1.0
