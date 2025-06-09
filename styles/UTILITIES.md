# TaskNotes Plugin Utility Classes Documentation

This document provides comprehensive documentation for the scoped utility classes available in the ChronoSync/TaskNotes plugin. All utilities are properly scoped under `.tasknotes-plugin` and use the established `--tn-` CSS variable system.

## Table of Contents

1. [Overview](#overview)
2. [Naming Convention](#naming-convention)
3. [Layout Utilities](#layout-utilities)
4. [Spacing Utilities](#spacing-utilities)
5. [Typography Utilities](#typography-utilities)
6. [Display Utilities](#display-utilities)
7. [Background & Border Utilities](#background--border-utilities)
8. [State Utilities](#state-utilities)
9. [Animation Utilities](#animation-utilities)
10. [Responsive Utilities](#responsive-utilities)
11. [Usage Guidelines](#usage-guidelines)
12. [Examples](#examples)

## Overview

The utility class system provides a comprehensive set of single-purpose CSS classes that enable rapid UI development while maintaining consistency with the plugin's design system. All utilities are scoped to prevent conflicts with Obsidian's styles and other plugins.

### Key Features

- **Scoped**: All utilities are scoped under `.tasknotes-plugin`
- **Design System Integration**: Uses `--tn-` CSS variables for consistency
- **Responsive**: Includes responsive variants for mobile-first design
- **Accessible**: Includes accessibility-focused utilities and reduced motion support
- **Performance**: Focused set of essential utilities to avoid bloat

## Naming Convention

All utility classes follow the pattern: `.tn-{property}-{value}`

Examples:
- `.tn-flex` - sets `display: flex`
- `.tn-m-md` - sets `margin: var(--tn-spacing-md)`
- `.tn-text-center` - sets `text-align: center`
- `.tn-bg-primary` - sets `background-color: var(--tn-bg-primary)`

## Layout Utilities

### Flexbox

#### Display
- `.tn-flex` - `display: flex`
- `.tn-flex-inline` - `display: inline-flex`

#### Direction
- `.tn-flex-row` - `flex-direction: row`
- `.tn-flex-col` - `flex-direction: column`
- `.tn-flex-row-reverse` - `flex-direction: row-reverse`
- `.tn-flex-col-reverse` - `flex-direction: column-reverse`

#### Wrap
- `.tn-flex-wrap` - `flex-wrap: wrap`
- `.tn-flex-nowrap` - `flex-wrap: nowrap`
- `.tn-flex-wrap-reverse` - `flex-wrap: wrap-reverse`

#### Justify Content
- `.tn-justify-start` - `justify-content: flex-start`
- `.tn-justify-end` - `justify-content: flex-end`
- `.tn-justify-center` - `justify-content: center`
- `.tn-justify-between` - `justify-content: space-between`
- `.tn-justify-around` - `justify-content: space-around`
- `.tn-justify-evenly` - `justify-content: space-evenly`

#### Align Items
- `.tn-items-start` - `align-items: flex-start`
- `.tn-items-end` - `align-items: flex-end`
- `.tn-items-center` - `align-items: center`
- `.tn-items-baseline` - `align-items: baseline`
- `.tn-items-stretch` - `align-items: stretch`

#### Flex Growth/Shrink
- `.tn-flex-1` - `flex: 1 1 0%`
- `.tn-flex-auto` - `flex: 1 1 auto`
- `.tn-flex-initial` - `flex: 0 1 auto`
- `.tn-flex-none` - `flex: none`
- `.tn-grow` - `flex-grow: 1`
- `.tn-shrink` - `flex-shrink: 1`

#### Common Combinations
- `.tn-flex-center` - Flex container with centered content
- `.tn-flex-between` - Flex container with space-between
- `.tn-flex-col-center` - Column flex with centered items

### Grid

#### Display
- `.tn-grid` - `display: grid`
- `.tn-grid-inline` - `display: inline-grid`

#### Template Columns
- `.tn-grid-cols-1` through `.tn-grid-cols-12` - Grid with 1-12 columns
- `.tn-grid-cols-7` - Useful for calendar layouts

#### Column/Row Spans
- `.tn-col-span-1` through `.tn-col-span-4` - Column spanning
- `.tn-col-span-full` - Span all columns
- `.tn-row-span-1` through `.tn-row-span-3` - Row spanning

### Positioning
- `.tn-static`, `.tn-relative`, `.tn-absolute`, `.tn-fixed`, `.tn-sticky`
- `.tn-inset-0`, `.tn-top-0`, `.tn-right-0`, `.tn-bottom-0`, `.tn-left-0`

## Spacing Utilities

### Margin

#### All Sides
- `.tn-m-0` - No margin
- `.tn-m-xs` - `margin: var(--tn-spacing-xs)` (2px)
- `.tn-m-sm` - `margin: var(--tn-spacing-sm)` (4px)
- `.tn-m-md` - `margin: var(--tn-spacing-md)` (8px)
- `.tn-m-lg` - `margin: var(--tn-spacing-lg)` (12px)
- `.tn-m-xl` - `margin: var(--tn-spacing-xl)` (16px)
- `.tn-m-auto` - `margin: auto`

#### Directional
- Horizontal: `.tn-mx-{size}` - Left and right margin
- Vertical: `.tn-my-{size}` - Top and bottom margin
- Individual: `.tn-mt-{size}`, `.tn-mr-{size}`, `.tn-mb-{size}`, `.tn-ml-{size}`

### Padding

#### All Sides
- `.tn-p-0` through `.tn-p-xl` - Same sizes as margin
- Directional: `.tn-px-{size}`, `.tn-py-{size}`, `.tn-pt-{size}`, etc.

### Gap (for Flex/Grid)
- `.tn-gap-0` through `.tn-gap-xl` - Sets gap property
- `.tn-gap-x-{size}` - Column gap only
- `.tn-gap-y-{size}` - Row gap only

## Typography Utilities

### Text Alignment
- `.tn-text-left` - `text-align: left`
- `.tn-text-center` - `text-align: center`
- `.tn-text-right` - `text-align: right`
- `.tn-text-justify` - `text-align: justify`

### Font Weight
- `.tn-font-thin` - `font-weight: 100`
- `.tn-font-light` - `font-weight: 300`
- `.tn-font-normal` - `font-weight: 400`
- `.tn-font-medium` - `font-weight: 500`
- `.tn-font-semibold` - `font-weight: 600`
- `.tn-font-bold` - `font-weight: 700`

### Font Size
- `.tn-text-xs` - `font-size: var(--tn-font-size-xs)`
- `.tn-text-sm` - `font-size: var(--tn-font-size-sm)`
- `.tn-text-base` - `font-size: var(--tn-font-size-md)`
- `.tn-text-lg` - `font-size: var(--tn-font-size-lg)`
- `.tn-text-xl` - `font-size: var(--tn-font-size-xl)`
- `.tn-text-2xl` - `font-size: var(--tn-font-size-2xl)`

### Text Transform
- `.tn-uppercase` - `text-transform: uppercase`
- `.tn-lowercase` - `text-transform: lowercase`
- `.tn-capitalize` - `text-transform: capitalize`
- `.tn-normal-case` - `text-transform: none`

### Text Decoration
- `.tn-underline` - `text-decoration: underline`
- `.tn-line-through` - `text-decoration: line-through`
- `.tn-no-underline` - `text-decoration: none`

### Line Height
- `.tn-leading-none` - `line-height: 1`
- `.tn-leading-tight` - `line-height: 1.25`
- `.tn-leading-normal` - `line-height: 1.5`
- `.tn-leading-relaxed` - `line-height: 1.625`

### Text Colors
- `.tn-text-normal` - Primary text color
- `.tn-text-muted` - Muted text color
- `.tn-text-faint` - Faint text color
- `.tn-text-accent` - Accent color
- `.tn-text-success`, `.tn-text-warning`, `.tn-text-error`, `.tn-text-info` - Semantic colors

## Display Utilities

### Display Types
- `.tn-block` - `display: block`
- `.tn-inline-block` - `display: inline-block`
- `.tn-inline` - `display: inline`
- `.tn-hidden` - `display: none !important`
- `.tn-table`, `.tn-table-row`, `.tn-table-cell` - Table display types

### Visibility
- `.tn-visible` - `visibility: visible`
- `.tn-invisible` - `visibility: hidden`
- `.tn-collapse` - `visibility: collapse`

## Background & Border Utilities

### Background Colors
- `.tn-bg-primary` - Primary background
- `.tn-bg-secondary` - Secondary background
- `.tn-bg-accent` - Accent background
- `.tn-bg-success`, `.tn-bg-warning`, `.tn-bg-error`, `.tn-bg-info` - Semantic backgrounds
- `.tn-bg-transparent` - Transparent background

### Borders
- **Width**: `.tn-border-0`, `.tn-border`, `.tn-border-2`
- **Directional**: `.tn-border-t`, `.tn-border-r`, `.tn-border-b`, `.tn-border-l`
- **Style**: `.tn-border-solid`, `.tn-border-dashed`, `.tn-border-dotted`, `.tn-border-none`
- **Color**: `.tn-border-normal`, `.tn-border-accent`, `.tn-border-error`, etc.

### Border Radius
- `.tn-rounded-none` - No border radius
- `.tn-rounded-xs` through `.tn-rounded-xl` - Various border radius sizes
- `.tn-rounded-full` - Fully rounded (50%)
- `.tn-rounded-t-sm`, `.tn-rounded-r-sm`, etc. - Directional border radius

### Shadows
- `.tn-shadow-none` - No shadow
- `.tn-shadow-light` - Light shadow
- `.tn-shadow`, `.tn-shadow-medium` - Medium shadow
- `.tn-shadow-strong` - Strong shadow
- `.tn-shadow-hover` - Hover state shadow

## State Utilities

### Interactive States
- `.tn-cursor-pointer` - Pointer cursor
- `.tn-cursor-not-allowed` - Not allowed cursor
- `.tn-cursor-grab`, `.tn-cursor-grabbing` - Drag cursors
- `.tn-select-none` - Disable text selection
- `.tn-pointer-events-none` - Disable pointer events

### Loading & Disabled States
- `.tn-loading` - Loading state with spinner
- `.tn-disabled` - Disabled state
- `.tn-opacity-50` - 50% opacity
- `.tn-opacity-75` - 75% opacity

### Hover Effects
- `.tn-hover-opacity:hover` - Reduce opacity on hover
- `.tn-hover-scale:hover` - Scale up on hover
- `.tn-hover-shadow:hover` - Add shadow on hover

### Focus States
- `.tn-focus-ring:focus` - Focus ring outline

## Animation Utilities

### Predefined Animations
- `.tn-animate-spin` - Spinning animation
- `.tn-animate-pulse` - Pulsing animation
- `.tn-animate-bounce` - Bouncing animation
- `.tn-animate-fade-in` - Fade in animation
- `.tn-animate-slide-up` - Slide up animation

### Transitions
- `.tn-transition-none` - No transition
- `.tn-transition-fast` - Fast transition
- `.tn-transition` - Normal transition
- `.tn-transition-slow` - Slow transition
- `.tn-transition-colors` - Color properties only
- `.tn-transition-opacity` - Opacity only
- `.tn-transition-transform` - Transform only

### Transform Utilities
- `.tn-scale-0` through `.tn-scale-125` - Scale transforms
- `.tn-transform-none` - Remove transforms

## Responsive Utilities

Responsive variants are available for key utilities using breakpoints:

- **sm**: `min-width: 768px` (tablets and up)
- **md**: `min-width: 992px` (desktops and up) 
- **lg**: `min-width: 1200px` (large desktops and up)

### Available Responsive Utilities
- Display: `.tn-sm-block`, `.tn-sm-hidden`, `.tn-sm-flex`, `.tn-sm-grid`
- Flex direction: `.tn-sm-flex-row`, `.tn-sm-flex-col`
- Text alignment: `.tn-sm-text-left`, `.tn-sm-text-center`, `.tn-sm-text-right`

### Usage Example
```html
<div class="tn-flex-col tn-sm-flex-row tn-gap-md">
  <!-- Column layout on mobile, row on tablet+ -->
</div>
```

## Accessibility Features

### Screen Reader Utilities
- `.tn-sr-only` - Hide visually but keep accessible to screen readers
- `.tn-not-sr-only` - Make visible again

### Reduced Motion Support
All transition and animation utilities automatically respect `prefers-reduced-motion: reduce`.

### High Contrast Support
Border and focus utilities automatically increase in high contrast mode.

## Usage Guidelines

### When to Use Utilities vs Components

**Use Utilities For:**
- Simple styling that doesn't justify a component
- One-off spacing adjustments
- Layout containers and wrappers
- State changes (hover, focus, loading)
- Responsive behavior

**Use Components For:**
- Complex, reusable UI patterns
- Elements with multiple related styles
- Semantic meaning (buttons, cards, modals)
- Component-specific behavior and states

### Best Practices

1. **Start with Components**: Use BEM components (`.tn-task-card`, `.tn-filter-bar`) as the foundation
2. **Add Utilities for Layout**: Use utilities for spacing, positioning, and layout
3. **Avoid Over-Utilization**: Don't recreate entire components with utilities
4. **Maintain Consistency**: Use the spacing scale consistently across the app
5. **Consider Responsive Design**: Use responsive variants when needed

### Example Component + Utility Pattern

```html
<!-- Good: Component + utilities for layout -->
<div class="tasknotes-plugin">
  <div class="tn-task-card tn-mb-md tn-p-lg">
    <div class="tn-task-card__header tn-flex tn-justify-between tn-items-center">
      <h3 class="tn-task-card__title tn-text-lg tn-font-semibold">Task Title</h3>
      <span class="tn-task-card__status tn-text-sm tn-text-muted">In Progress</span>
    </div>
    <div class="tn-task-card__content tn-mt-sm">
      <p class="tn-text-base tn-leading-normal">Task description...</p>
    </div>
  </div>
</div>
```

## Examples

### Common Layout Patterns

#### Centered Container
```html
<div class="tasknotes-plugin">
  <div class="tn-flex tn-justify-center tn-items-center tn-min-h-full">
    <div class="tn-max-w-md tn-w-full tn-p-lg">
      <!-- Centered content -->
    </div>
  </div>
</div>
```

#### Card Grid
```html
<div class="tasknotes-plugin">
  <div class="tn-grid tn-grid-cols-1 tn-sm-grid-cols-2 tn-lg-grid-cols-3 tn-gap-md">
    <div class="tn-task-card tn-p-md tn-rounded-md tn-shadow">Card 1</div>
    <div class="tn-task-card tn-p-md tn-rounded-md tn-shadow">Card 2</div>
    <div class="tn-task-card tn-p-md tn-rounded-md tn-shadow">Card 3</div>
  </div>
</div>
```

#### Split Layout
```html
<div class="tasknotes-plugin">
  <div class="tn-flex tn-flex-col tn-lg-flex-row tn-gap-lg">
    <div class="tn-flex-1 tn-bg-primary tn-p-lg tn-rounded-lg">
      <!-- Main content -->
    </div>
    <div class="tn-w-full tn-lg-w-64 tn-bg-secondary tn-p-lg tn-rounded-lg">
      <!-- Sidebar -->
    </div>
  </div>
</div>
```

#### Button Row
```html
<div class="tasknotes-plugin">
  <div class="tn-flex tn-justify-end tn-gap-sm tn-mt-lg">
    <button class="tn-btn tn-btn--secondary tn-px-md tn-py-sm">Cancel</button>
    <button class="tn-btn tn-btn--primary tn-px-md tn-py-sm tn-bg-accent tn-text-white">Save</button>
  </div>
</div>
```

### Responsive Patterns

#### Mobile-First Stack
```html
<div class="tasknotes-plugin">
  <!-- Stack on mobile, row on tablet+ -->
  <div class="tn-flex tn-flex-col tn-sm-flex-row tn-gap-md">
    <div class="tn-flex-1">Content 1</div>
    <div class="tn-flex-1">Content 2</div>
  </div>
</div>
```

#### Hide/Show Elements
```html
<div class="tasknotes-plugin">
  <!-- Show on mobile, hide on desktop -->
  <button class="tn-block tn-lg-hidden">Mobile Menu</button>
  
  <!-- Hide on mobile, show on desktop -->
  <nav class="tn-hidden tn-lg-block">Desktop Navigation</nav>
</div>
```

### State Examples

#### Loading Button
```html
<div class="tasknotes-plugin">
  <button class="tn-btn tn-loading tn-cursor-not-allowed">
    Saving...
  </button>
</div>
```

#### Hover Effects
```html
<div class="tasknotes-plugin">
  <div class="tn-task-card tn-transition tn-hover-shadow tn-hover-scale tn-cursor-pointer">
    Hoverable card
  </div>
</div>
```

#### Focus States
```html
<div class="tasknotes-plugin">
  <input class="tn-input tn-focus-ring tn-px-md tn-py-sm tn-border tn-rounded" 
         placeholder="Focus me">
</div>
```

## Migration from Legacy Classes

When migrating from existing CSS classes, use this mapping:

| Legacy Class | New Utility | Notes |
|--------------|-------------|-------|
| `.cs-flex` | `.tn-flex` | Direct replacement |
| `.cs-p-md` | `.tn-p-md` | Direct replacement |
| `.cs-gap-sm` | `.tn-gap-sm` | Direct replacement |
| `.cs-text-center` | `.tn-text-center` | Direct replacement |
| `.is-hidden` | `.tn-hidden` | Use scoped version |
| `.is-loading` | `.tn-loading` | Enhanced with spinner |

## Performance Considerations

1. **Utility Selection**: Only the most commonly used utilities are included
2. **Scoping**: All utilities are scoped to prevent global pollution
3. **Build Integration**: Utilities are concatenated with other CSS in the build process
4. **Purging**: Consider removing unused utilities in production builds

## Browser Support

Utilities support the same browsers as the Obsidian app:
- Modern browsers with CSS Grid and Flexbox support
- CSS custom properties (CSS variables)
- CSS `prefers-reduced-motion` and `prefers-contrast` media queries

## Conclusion

The TaskNotes utility class system provides a powerful foundation for building consistent, maintainable UI components. By combining BEM components with focused utilities, you can create flexible layouts while maintaining the plugin's design system integrity.

For questions or suggestions about the utility system, please refer to the project's documentation or open an issue in the repository.