# OpenPencil, embedded

The OpenPencil design editor for another application's page: one design, read from and saved to
`.fig` bytes the host keeps. No tabs, Home, AI chat, collaboration, Cloud or desktop features; the
host owns the file, the window, comments and the theme.

```ts
import type { DesignEditorHandle } from '@xingular/open-pencil-embed'

// Serve this folder as it is, link embed.css, then import embed.js from where it is served.
const { mountDesignEditor } = await import('/open-pencil/embed.js')
const editor: DesignEditorHandle = mountDesignEditor(element, {
  bytes, // a .fig document, or null for an empty one
  theme: 'dark',
  onChange: (fig) => save(fig), // after each edit, debounced
  onSelection: (layers) => anchor(layers)
})
```

Every style is scoped under `.xop`, so the host's page is left alone; menus portal into a `.xop`
element on `body`. The editor takes keys and the clipboard only while the person is using it. Its
panels read the host's colour variables (`--background`, `--panel`, `--border`, `--foreground`,
`--muted-foreground` and others, see `embed.css`) with fallbacks. It loads WebAssembly, so the
host's content policy needs `script-src 'wasm-unsafe-eval'`; fonts come from this folder only.

Built from [`tanntnny/open-pencil`](https://github.com/tanntnny/open-pencil) (`xingular` branch)
with `bun run build:embed`. MIT, as upstream OpenPencil; what it bundles keeps its licence
(`LICENSES/`).
