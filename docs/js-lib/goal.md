## JavaScript library

### Goal

Create a TypeScript library to be used by web applications. The goal of the library is to process markdown content and add markup surrounding certain patterns that match a specific criteria in the markdown.

### Main function

The main function of the library should take the following arguments:

- `markdown`: string - The markdown text that needs to be processed
- `annotateInfo`: object - Information about the patterns to look for in the markdown text and how to annotate them. The object contains the following properties:
  - `name`: string - This is the name which should be used for the annotation
  - `parent`: string (optional) - Parent to set for the annotated element
  - `terms`: string[] - Array of terms/patterns to look for within the markdown text and annotate
  - `isImportant`: boolean - If this is truthy, will be marked as important in the annotation
  - `isFootnote`: boolean - If this is truthy, will be marked as footnote in the annotation

The function should return a string with the processed text.

### How terms should be searched

- whole terms (no partial matches)
- Search should be case insensitive
- Terms could be adjacent to symbols such as commas, dots, parentheses etc.

### Content to consider vs content to ignore

- Frontmatter: Any text within the frontmatter of the markdown document should be ignored. If it exists, it will be between lines with `---` at the start of the document.
- Content in headings, quotes, tables and regular text should be considered.
- Bibliographic citations. Examples:
  - `[@text]`
  - `[@text;@other]`
  - `[@text 23, 64]`
  - `[@text 10-12]`
  - Also this special syntax: `[p @text]`
- Footnotes:
  - Declarations should be ignored. Example: `[^footnoteName]`
  - The text for a footnote should be considered if it's not a bibligraphic citation. Example: `[^footnoteName]: This text should be considered`
- In terms of tags, the following patterns should be ignored:
  - `kbd` tag with the `class` attribute containing `indexEntrytct` or `tct` and the text specified inside
  - `kbd` tag with the `class` attribute containing `enlacetct` and the text specified inside
  - `kbd` tag with the `class` attribute containing `anchortct` and the text specified inside
- If a line starts with `Table: `, any text after it should be considered as content that could be changed but not the `Table: ` at the start of the line.
- If a line starts with `> `, any text after it should be considered as content that could be changed but not the `> ` at the start of the line.
- Images: `![](path/to/file.png)` - Text between the square brackets should be considered unless it's a forbidden element.
- Any text parts of a url should be ignored

### How to annotate a match

When one of the terms specified in **annotateInfo** is found within the markup document, the text will be surrounded with the `kbd` tag and the following attributes will be specified using the information provided in the **annotateInfo** object:

- The `title` attribute should contain the text `En el índice analítico como '${annotateInfo.name}'`
- The `class` attribute should contain the following words (separated by spaces):
  - `indexEntrytct` (always)
  - `footnote` (if **annotateInfo.isFootnote** is truthy)
  - `important` (if **annotateInfo.isImportant** is truthy)
- The `entryText` attribute should contain **annotateInfo.name**
- The `entryParent` attribute should contain **annotateInfo.parent** if specified

### Examples

1. Ignoring frontmatter but not content

With the following markdown:

```
---
random: Creu Roja
---

# La promoción de la donación voluntaria y no remunerada en la Cruz Roja española y la Creu Roja.
```

If we call the function with:

- The markdown content
- An `annotateInfo` object with:
  - `name`: 'Red Cross'
  - `terms`: ['Cruz Roja española','Creu Roja']
  - `isImportant`: false
  - `isFootnote`: false

The result should be:

```
---
random: Creu Roja
---

# La promoción de la donación voluntaria y no remunerada en la <kbd title = "En el índice analítico como 'Red Cross'" class="indexEntrytct  " entryText="Red Cross" >Cruz Roja española</kbd> y la <kbd title = "En el índice analítico como 'Red Cross'" class="indexEntrytct  " entryText="Red Cross" >Creu Roja</kbd>.
```

### Work to do:

- Implement main function
- Create any helper functions might be needed
- Add tests using vitest to verify the code behaves as expected
- Create test files alongside the logic files instead of adding them to their own folder.

# Tech specs:

- ESM should be used instead of CJS
- TypeScript should be used
- The following libraries could be used:
  - `@benrbray/remark-cite`
  - `mdast-util-find-and-replace`
  - `mdast-util-to-hast`
  - `remark-frontmatter`
  - `remark-gfm`
  - `remark-parse`
  - `remark-stringify`
  - `unified`
  - `unist-util-visit`
  - Any other libraries considered relevant to solve the problem
