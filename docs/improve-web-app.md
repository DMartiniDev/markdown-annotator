# Goal

Improve the web application so that it contains the following screens and behavior.

## Screens

1. An initial screen should ask the user for the markdown content to process. The user should be presented with two options (upload a markdown file) or write the markdown content to process:

- If the user wants to upload the file, it should be able to click a button and select the file to upload or drag and drop the file to be used.
- If the user wants to write the text, should be presented with a textbox in which it can write the contents to be processed.

If the user uploads the markdown or decides to write it in the text area, it should be presented with the option to navigate to screen #2.

2. In the second screen, the user should be able to specify the terms to look for as well as specify how they need to be annotated:

- TODO: Should keep track of which matches have been processed or not
- It should present the user with a list of annotation entries (See **AnnotateInfo** type) and allow the following operations:
  - Add new entry (presenting a dialog to fill the information)
  - Delete an existing entry
  - Click an entry to edit its details

This screen should also present the user with import/export annotation information. This should work with JSON files using the following:

```ts
{
  annotateInfo: AnnotateInfo[]
}
```

Finally, this screen should have a button called `Process` that will navigate to screen #3.

3. This screen is where the user can decide what to do with each of the matches found within the markdown document. It should contain the following information:

- Buttons to import/export a new session with information about matches and their current information. See **Session** type.
- Text indicating what is the current match we are looking at: Something like: `23/130`
- Buttons to move to the next of previous match (without marking them as complete)
- Two columns:
  - A textarea displaying where the match has been found
    - The match should be highlighted
    - The textarea should include text before and after so that the user can see the match in context. The textarea should always be the same size so the rest of UI doesn't jump when checking different matches.
  - Information on how the match will be annotatted based on `AnnotateInfo` (displaying both `name` and `parent`). Those should be automatically filled but allow the user to do changes or reset to the defaults based on data.
    - In the case of `name`, any text would be accepted
    - In the case of `parent` the user should be presented with a list of all names found in AnnotateInfo from the previous screen but automatically selecting the expected value.
    - Checkbox to specify if the match is important (unchecked by default)
    - read only checkbox showing if the match has been found in a footnote
- Two buttons to decide what the next action is:
  - `Accept` information: This should store the annotation information for the current match, mark it as complete and move to the next one
  - `Skip`: This should mark it as complete and go to the next one. These entries will use empty string for `name` and an empty array for `terms`, and set both `footnote` and `important` to false and should not create annotation for the word.

Once all the elements are complete, a button should be enabled to export the processed markdown as a brand new file.

### Relevant types

```ts
type AnnotateInfo {
  name: string
  terms: string[]
  parent?: string
}
```

```ts
type MatchInfo = AnnotateInfo & {
  important: boolean;
  footnote: boolean;
  complete: boolean;
};
```

```ts
type Session {
  markdown: string
  matchesInfo: MatchInfo[]
}
```
