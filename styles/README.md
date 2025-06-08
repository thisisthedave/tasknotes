# CSS Build System

This directory contains the modular CSS source files for the TaskNotes plugin. The main `styles.css` file is generated from these source files during the build process.

## File Structure

- `variables.css` - CSS custom properties and design system variables
- `base.css` - Basic styles, animations, card components, and layout
- `components.css` - Reusable UI components, utilities, and modals  
- `calendar.css` - Calendar view specific styles
- `tasks.css` - Task list and task item specific styles
- `kanban.css` - Kanban board view specific styles
- `filters.css` - Unified filtering system styles
- `index.css` - Documentation file (not included in build)
- `README.md` - This documentation file

## Development Workflow

### Making Changes
1. Edit the appropriate CSS file in this directory
2. Run `npm run build-css` to regenerate the main `styles.css` file
3. Test your changes in the application
4. Commit your changes to the source files (the generated `styles.css` is ignored by git)

### Build Commands
- `npm run build-css` - Build CSS only
- `npm run dev` - Build CSS + start development server
- `npm run build` - Build CSS + full production build

### File Loading Order
The CSS files are concatenated in dependency order:
1. `variables.css` (loaded first so variables are available everywhere)
2. `base.css` (foundational styles)
3. `components.css` (reusable components)
4. `calendar.css` (view-specific styles)
5. `tasks.css` (view-specific styles)
6. `kanban.css` (view-specific styles)
7. `filters.css` (cross-view filtering system)

## CI/CD Process

The GitHub Actions workflow automatically:
1. Builds the CSS from source files during release
2. Includes the generated `styles.css` in the release artifacts
3. Ensures the plugin has all necessary files for distribution

## Important Notes

- **Never edit `styles.css` directly** - it will be overwritten during builds
- The `styles.css` file is **not tracked in git** - only source files are committed
- All CSS variables should be defined in `variables.css`
- Follow the existing patterns and naming conventions
- Use CSS custom properties (variables) instead of hardcoded values
- Test changes across different views (Calendar, Tasks, Kanban, etc.)

## Troubleshooting

If styles aren't updating:
1. Run `npm run build-css` to regenerate the CSS
2. Check that your changes are in the correct source file
3. Verify the build completed without errors
4. Clear browser cache if testing in development

If the build fails:
1. Check the console output for specific error messages
2. Verify all CSS files exist and are readable
3. Check for syntax errors in your CSS
4. Ensure file paths in `build-css.mjs` are correct