## Web application

### Goal

A React Vite web application which uses the TypeScript library found in this monorepo to annotate a markdown file.

The interface should present a textarea in which the user can write some markdown, then have a button called `process` and once pressed, the result should display another textarea with the text processed

The way it should use the library is to annotate the following patterns:

- `sangre` using `blood` as name, and marking it as important
- `Guerra` using `war` as name, `conflict` as parent but not important
- `transfusion` using `transfuxion` as name.

The terms should be annotated as footnotes if they happen to appear in a footnote.

### Tech specs:

- Use `Vite` with `React`
- Use `Shadcn` for the UI components
- Use tailwind for styling
- Separate components into their own files
- Follow best practices
- Use `zod` for validation
- ESM should be used instead of CJS
