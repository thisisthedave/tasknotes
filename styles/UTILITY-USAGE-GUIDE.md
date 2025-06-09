# TaskNotes Utility Classes - Practical Usage Guide

This guide provides practical examples and patterns for using the TaskNotes utility classes effectively in your components and views.

## Quick Reference Card

### Most Common Utilities

```css
/* Layout */
.tn-flex, .tn-flex-center, .tn-flex-between
.tn-grid, .tn-grid-cols-2, .tn-grid-cols-3

/* Spacing */
.tn-m-{0,xs,sm,md,lg,xl}, .tn-p-{0,xs,sm,md,lg,xl}
.tn-gap-{0,xs,sm,md,lg,xl}

/* Typography */
.tn-text-{xs,sm,base,lg,xl}, .tn-font-{normal,medium,semibold,bold}
.tn-text-{left,center,right}, .tn-text-{normal,muted,accent}

/* Display */
.tn-hidden, .tn-block, .tn-inline-block

/* States */
.tn-loading, .tn-disabled, .tn-hover-scale, .tn-transition
```

## Component Integration Patterns

### 1. Task Card Layout

```html
<div class="tasknotes-plugin">
  <!-- Base component with utility spacing -->
  <div class="tn-task-card tn-mb-md">
    <!-- Header with flex utilities -->
    <div class="tn-task-card__header tn-flex tn-justify-between tn-items-center tn-mb-sm">
      <h3 class="tn-task-card__title tn-text-lg tn-font-semibold tn-text-normal">
        Complete project documentation
      </h3>
      <!-- Status badge with utility styling -->
      <span class="tn-task-card__status tn-text-xs tn-font-medium tn-px-sm tn-py-xs tn-bg-accent tn-text-white tn-rounded-sm">
        In Progress
      </span>
    </div>
    
    <!-- Content area -->
    <div class="tn-task-card__content tn-text-base tn-leading-normal tn-text-muted">
      Write comprehensive documentation for all utility classes and usage patterns.
    </div>
    
    <!-- Footer with flex utilities -->
    <div class="tn-task-card__footer tn-flex tn-justify-between tn-items-center tn-mt-md tn-pt-sm tn-border-t tn-border-normal">
      <div class="tn-flex tn-items-center tn-gap-sm tn-text-sm tn-text-muted">
        <span>Due: Dec 15, 2023</span>
        <span>•</span>
        <span>2h estimated</span>
      </div>
      <button class="tn-btn tn-btn--small tn-bg-transparent tn-text-accent tn-hover-scale tn-transition">
        Edit
      </button>
    </div>
  </div>
</div>
```

### 2. Filter Bar Layout

```html
<div class="tasknotes-plugin">
  <div class="tn-filter-bar tn-bg-secondary tn-p-md tn-rounded-lg tn-border tn-border-normal tn-mb-lg">
    <!-- Main filter row -->
    <div class="tn-flex tn-flex-col tn-sm-flex-row tn-gap-md tn-items-start tn-sm-items-center">
      <!-- Search input with flex grow -->
      <div class="tn-flex-1 tn-w-full tn-sm-w-auto">
        <input class="tn-input tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded tn-bg-primary" 
               placeholder="Search tasks..." />
      </div>
      
      <!-- Filter controls -->
      <div class="tn-flex tn-gap-md tn-items-center tn-w-full tn-sm-w-auto">
        <select class="tn-select tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded tn-bg-primary">
          <option>All Status</option>
          <option>In Progress</option>
          <option>Completed</option>
        </select>
        
        <button class="tn-btn tn-px-md tn-py-sm tn-bg-accent tn-text-white tn-rounded tn-transition tn-hover-scale">
          Filter
        </button>
      </div>
    </div>
  </div>
</div>
```

### 3. Modal Dialog

```html
<div class="tasknotes-plugin">
  <div class="tn-modal-overlay tn-fixed tn-inset-0 tn-bg-black tn-opacity-50 tn-z-modal">
    <div class="tn-flex tn-justify-center tn-items-center tn-min-h-screen tn-p-md">
      <div class="tn-modal tn-bg-primary tn-rounded-lg tn-shadow-strong tn-w-full tn-max-w-md tn-animate-fade-in">
        <!-- Modal header -->
        <div class="tn-modal__header tn-flex tn-justify-between tn-items-center tn-p-lg tn-border-b tn-border-normal">
          <h2 class="tn-text-xl tn-font-semibold tn-text-normal">Create New Task</h2>
          <button class="tn-btn tn-btn--icon tn-text-muted tn-hover-scale tn-transition">×</button>
        </div>
        
        <!-- Modal content -->
        <div class="tn-modal__content tn-p-lg">
          <form class="tn-flex tn-flex-col tn-gap-md">
            <div>
              <label class="tn-block tn-text-sm tn-font-medium tn-text-normal tn-mb-xs">Task Title</label>
              <input class="tn-input tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded tn-focus-ring" 
                     placeholder="Enter task title..." />
            </div>
            
            <div>
              <label class="tn-block tn-text-sm tn-font-medium tn-text-normal tn-mb-xs">Description</label>
              <textarea class="tn-input tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded tn-focus-ring" 
                        rows="3" placeholder="Task description..."></textarea>
            </div>
          </form>
        </div>
        
        <!-- Modal footer -->
        <div class="tn-modal__footer tn-flex tn-justify-end tn-gap-sm tn-p-lg tn-border-t tn-border-normal">
          <button class="tn-btn tn-px-lg tn-py-sm tn-border tn-border-normal tn-rounded tn-transition tn-hover-scale">
            Cancel
          </button>
          <button class="tn-btn tn-px-lg tn-py-sm tn-bg-accent tn-text-white tn-rounded tn-transition tn-hover-scale">
            Create Task
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Layout Patterns

### 1. Calendar Grid

```html
<div class="tasknotes-plugin">
  <div class="tn-calendar tn-bg-primary tn-rounded-lg tn-border tn-border-normal tn-overflow-hidden">
    <!-- Calendar header -->
    <div class="tn-flex tn-justify-between tn-items-center tn-p-md tn-bg-secondary tn-border-b tn-border-normal">
      <button class="tn-btn tn-btn--icon tn-hover-scale tn-transition">‹</button>
      <h2 class="tn-text-lg tn-font-semibold tn-text-normal">December 2023</h2>
      <button class="tn-btn tn-btn--icon tn-hover-scale tn-transition">›</button>
    </div>
    
    <!-- Days of week header -->
    <div class="tn-grid tn-grid-cols-7 tn-bg-secondary">
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Sun</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Mon</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Tue</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Wed</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Thu</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted tn-border-r tn-border-normal">Fri</div>
      <div class="tn-p-sm tn-text-center tn-text-xs tn-font-medium tn-text-muted">Sat</div>
    </div>
    
    <!-- Calendar days -->
    <div class="tn-grid tn-grid-cols-7">
      <!-- Day cell example -->
      <div class="tn-min-h-24 tn-p-xs tn-border-r tn-border-b tn-border-normal tn-bg-primary tn-hover-scale tn-transition tn-cursor-pointer">
        <div class="tn-text-sm tn-text-normal tn-mb-xs">15</div>
        <div class="tn-text-xs tn-text-accent">3 tasks</div>
      </div>
    </div>
  </div>
</div>
```

### 2. Kanban Board

```html
<div class="tasknotes-plugin">
  <div class="tn-kanban tn-flex tn-gap-lg tn-p-lg tn-overflow-x-auto tn-min-h-screen">
    <!-- Kanban column -->
    <div class="tn-kanban-column tn-flex-shrink-0 tn-w-80 tn-bg-secondary tn-rounded-lg tn-border tn-border-normal">
      <!-- Column header -->
      <div class="tn-flex tn-justify-between tn-items-center tn-p-md tn-border-b tn-border-normal">
        <h3 class="tn-text-lg tn-font-semibold tn-text-normal">To Do</h3>
        <span class="tn-text-xs tn-font-medium tn-px-sm tn-py-xs tn-bg-accent tn-text-white tn-rounded-full">5</span>
      </div>
      
      <!-- Column content -->
      <div class="tn-flex tn-flex-col tn-gap-md tn-p-md tn-max-h-screen tn-overflow-y-auto">
        <!-- Task card in column -->
        <div class="tn-task-card tn-bg-primary tn-p-md tn-rounded tn-border tn-border-normal tn-shadow-light tn-hover-shadow tn-transition tn-cursor-grab">
          <h4 class="tn-text-base tn-font-medium tn-text-normal tn-mb-sm">Update documentation</h4>
          <p class="tn-text-sm tn-text-muted tn-mb-md">Review and update all project documentation files.</p>
          <div class="tn-flex tn-justify-between tn-items-center tn-text-xs tn-text-muted">
            <span>Due: Dec 20</span>
            <span class="tn-bg-warning tn-text-white tn-px-xs tn-py-xs tn-rounded">High</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Responsive Patterns

### 1. Mobile-First Navigation

```html
<div class="tasknotes-plugin">
  <nav class="tn-bg-secondary tn-border-b tn-border-normal">
    <div class="tn-flex tn-justify-between tn-items-center tn-p-md">
      <!-- Logo/title -->
      <h1 class="tn-text-xl tn-font-bold tn-text-normal">TaskNotes</h1>
      
      <!-- Mobile menu button (hidden on desktop) -->
      <button class="tn-btn tn-btn--icon tn-md-hidden tn-hover-scale tn-transition">☰</button>
      
      <!-- Desktop navigation (hidden on mobile) -->
      <div class="tn-hidden tn-md-flex tn-gap-lg">
        <a href="#" class="tn-text-base tn-text-normal tn-hover-opacity tn-transition">Tasks</a>
        <a href="#" class="tn-text-base tn-text-normal tn-hover-opacity tn-transition">Calendar</a>
        <a href="#" class="tn-text-base tn-text-normal tn-hover-opacity tn-transition">Notes</a>
      </div>
    </div>
    
    <!-- Mobile menu (shown when toggled) -->
    <div class="tn-md-hidden tn-border-t tn-border-normal tn-bg-primary">
      <div class="tn-flex tn-flex-col tn-p-md tn-gap-sm">
        <a href="#" class="tn-block tn-py-sm tn-text-base tn-text-normal tn-hover-opacity tn-transition">Tasks</a>
        <a href="#" class="tn-block tn-py-sm tn-text-base tn-text-normal tn-hover-opacity tn-transition">Calendar</a>
        <a href="#" class="tn-block tn-py-sm tn-text-base tn-text-normal tn-hover-opacity tn-transition">Notes</a>
      </div>
    </div>
  </nav>
</div>
```

### 2. Responsive Grid Layout

```html
<div class="tasknotes-plugin">
  <div class="tn-container tn-mx-auto tn-px-md">
    <!-- Responsive grid: 1 col mobile, 2 cols tablet, 3 cols desktop -->
    <div class="tn-grid tn-grid-cols-1 tn-sm-grid-cols-2 tn-lg-grid-cols-3 tn-gap-md tn-gap-lg">
      <div class="tn-task-card tn-p-lg tn-bg-primary tn-rounded-lg tn-border tn-border-normal">
        Card 1
      </div>
      <div class="tn-task-card tn-p-lg tn-bg-primary tn-rounded-lg tn-border tn-border-normal">
        Card 2
      </div>
      <div class="tn-task-card tn-p-lg tn-bg-primary tn-rounded-lg tn-border tn-border-normal">
        Card 3
      </div>
    </div>
  </div>
</div>
```

## State Management Examples

### 1. Loading States

```html
<div class="tasknotes-plugin">
  <!-- Loading button -->
  <button class="tn-btn tn-loading tn-px-lg tn-py-sm tn-bg-accent tn-text-white tn-rounded tn-cursor-not-allowed">
    Saving Task...
  </button>
  
  <!-- Loading card -->
  <div class="tn-task-card tn-loading tn-p-lg tn-bg-secondary tn-rounded tn-animate-pulse">
    <div class="tn-h-4 tn-bg-muted tn-rounded tn-mb-sm"></div>
    <div class="tn-h-3 tn-bg-muted tn-rounded tn-w-3/4"></div>
  </div>
  
  <!-- Loading spinner -->
  <div class="tn-flex tn-justify-center tn-items-center tn-p-xl">
    <div class="tn-animate-spin tn-w-8 tn-h-8 tn-border-2 tn-border-accent tn-border-t-transparent tn-rounded-full"></div>
  </div>
</div>
```

### 2. Error and Success States

```html
<div class="tasknotes-plugin">
  <!-- Error message -->
  <div class="tn-bg-error tn-text-white tn-p-md tn-rounded tn-mb-md tn-flex tn-items-center tn-gap-sm">
    <span class="tn-text-lg">⚠</span>
    <span class="tn-text-sm">Failed to save task. Please try again.</span>
  </div>
  
  <!-- Success message -->
  <div class="tn-bg-success tn-text-white tn-p-md tn-rounded tn-mb-md tn-flex tn-items-center tn-gap-sm">
    <span class="tn-text-lg">✓</span>
    <span class="tn-text-sm">Task saved successfully!</span>
  </div>
  
  <!-- Warning message -->
  <div class="tn-bg-warning tn-text-white tn-p-md tn-rounded tn-mb-md tn-flex tn-items-center tn-gap-sm">
    <span class="tn-text-lg">⚠</span>
    <span class="tn-text-sm">Task is overdue. Consider updating the due date.</span>
  </div>
</div>
```

### 3. Interactive States

```html
<div class="tasknotes-plugin">
  <!-- Hover effects -->
  <div class="tn-task-card tn-p-md tn-bg-primary tn-rounded tn-transition tn-hover-shadow tn-hover-scale tn-cursor-pointer">
    Hover me for effects
  </div>
  
  <!-- Focus states -->
  <input class="tn-input tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded tn-focus-ring tn-transition" 
         placeholder="Focus me to see ring" />
  
  <!-- Disabled state -->
  <button class="tn-btn tn-disabled tn-px-lg tn-py-sm tn-bg-muted tn-text-muted tn-rounded tn-cursor-not-allowed">
    Disabled Button
  </button>
</div>
```

## Advanced Patterns

### 1. Card with Actions Menu

```html
<div class="tasknotes-plugin">
  <div class="tn-task-card tn-relative tn-p-md tn-bg-primary tn-rounded tn-border tn-border-normal tn-group">
    <!-- Card content -->
    <div class="tn-pr-8">
      <h3 class="tn-text-lg tn-font-semibold tn-text-normal tn-mb-sm">Task Title</h3>
      <p class="tn-text-base tn-text-muted">Task description goes here...</p>
    </div>
    
    <!-- Actions menu (shown on hover) -->
    <div class="tn-absolute tn-top-md tn-right-md tn-opacity-0 group-hover:tn-opacity-100 tn-transition">
      <button class="tn-btn tn-btn--icon tn-w-6 tn-h-6 tn-text-muted tn-hover-scale tn-transition">⋮</button>
    </div>
  </div>
</div>
```

### 2. Collapsible Section

```html
<div class="tasknotes-plugin">
  <div class="tn-bg-secondary tn-rounded-lg tn-border tn-border-normal tn-overflow-hidden">
    <!-- Toggle header -->
    <button class="tn-w-full tn-flex tn-justify-between tn-items-center tn-p-md tn-bg-secondary tn-hover-scale tn-transition">
      <span class="tn-text-lg tn-font-semibold tn-text-normal">Advanced Filters</span>
      <span class="tn-text-lg tn-transition">▼</span>
    </button>
    
    <!-- Collapsible content -->
    <div class="tn-p-md tn-bg-primary tn-border-t tn-border-normal">
      <div class="tn-grid tn-grid-cols-1 tn-sm-grid-cols-2 tn-gap-md">
        <div>
          <label class="tn-block tn-text-sm tn-font-medium tn-text-normal tn-mb-xs">Priority</label>
          <select class="tn-select tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded">
            <option>All Priorities</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div>
          <label class="tn-block tn-text-sm tn-font-medium tn-text-normal tn-mb-xs">Status</label>
          <select class="tn-select tn-w-full tn-px-md tn-py-sm tn-border tn-border-normal tn-rounded">
            <option>All Statuses</option>
            <option>To Do</option>
            <option>In Progress</option>
            <option>Completed</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Performance Tips

### 1. Minimize Class Usage
```html
<!-- Good: Combine utilities efficiently -->
<div class="tn-flex tn-items-center tn-gap-md tn-p-lg tn-bg-primary tn-rounded-lg">
  Content
</div>

<!-- Avoid: Excessive utility stacking -->
<div class="tn-flex tn-flex-row tn-justify-start tn-items-center tn-pt-lg tn-pr-lg tn-pb-lg tn-pl-lg tn-bg-primary tn-border tn-border-normal tn-rounded-lg tn-shadow-medium">
  Content
</div>
```

### 2. Use Component Classes for Complex Patterns
```html
<!-- Good: Use component for complex, repeated patterns -->
<div class="tn-task-card tn-task-card--priority-high tn-mb-md">
  <!-- Utilities for layout only -->
  <div class="tn-flex tn-justify-between tn-items-center">
    <span class="tn-task-card__title">Task</span>
    <span class="tn-task-card__status">Status</span>
  </div>
</div>

<!-- Avoid: Recreating complex components with utilities -->
<div class="tn-p-md tn-bg-primary tn-border tn-border-error tn-border-l-4 tn-rounded tn-shadow tn-mb-md">
  <div class="tn-flex tn-justify-between tn-items-center tn-text-lg tn-font-semibold">
    <!-- Too many utilities for a reusable pattern -->
  </div>
</div>
```

## Troubleshooting Common Issues

### 1. Specificity Issues
If utilities aren't applying, ensure they're properly scoped:

```html
<!-- Correct scoping -->
<div class="tasknotes-plugin">
  <div class="tn-flex tn-justify-center">Content</div>
</div>

<!-- May not work without scoping -->
<div class="tn-flex tn-justify-center">Content</div>
```

### 2. CSS Variable Availability
Ensure CSS variables are loaded before utilities:

```css
/* variables.css must be loaded before utilities.css */
.tasknotes-plugin {
  --tn-spacing-md: 8px;
}

/* utilities.css can then use these variables */
.tasknotes-plugin .tn-p-md {
  padding: var(--tn-spacing-md);
}
```

### 3. Responsive Breakpoints
Remember the mobile-first approach:

```html
<!-- Mobile-first: base styles apply to mobile, larger screens override -->
<div class="tn-flex-col tn-sm-flex-row tn-gap-sm tn-sm-gap-lg">
  <!-- Column on mobile, row on tablet+ -->
  <!-- Small gap on mobile, large gap on tablet+ -->
</div>
```

This guide should help you effectively use the TaskNotes utility class system in your development work. Remember to balance utility usage with component-based development for the best maintainability and performance.