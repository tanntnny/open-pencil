# OpenPencil headless engine

`worker.mjs` opens, edits and writes OpenPencil `.fig` documents with no window. A host runs one
process per operation:

```sh
node --permission --allow-fs-read=<this folder> --max-old-space-size=1536 <this folder>/worker.mjs
```

with an empty environment and a time limit, writes one JSON request to stdin and reads the reply
from the stdout line that starts with the request's `nonce`. Binary data travels as base64.

| `op` | Request | Reply |
|---|---|---|
| `new` | `name?` | `fig` |
| `outline` | `fig` | `pages`, `text` |
| `run` | `fig`, `code` (Figma Plugin API; `figma` and `openpencil` in scope), `pageId?` | `fig`, `result`, `changed`, `pages`, `logs` |
| `import_html` | `fig`, `html`, `name`, `width`, `height`, `x?`, `y?`, `pageId?` | `fig`, `nodeId`, `pages` |
| `render` | `fig`, `format` (`png` or `svg`), `nodeId?` or `pageId?`, `scale?` | `png` (base64) or `svg` |
| `migrate` | `canvas` (an earlier `canvas.json`), `text`, `binary` (its files by path) | `fig`, `pages` |

Every reply has `ok` and `logs`, and `error` when `ok` is false. A `run` script cannot load the
network or process modules, and the network globals are gone; the process's own permissions keep
it to reading this folder. Fonts come from this folder only: a family it lacks is drawn in a
stand-in.

Built from [`tanntnny/open-pencil`](https://github.com/tanntnny/open-pencil) (`xingular` branch) by
`bun run build:headless`, after the packages are built; `node headless/smoke.mjs` checks it.
MIT, as upstream OpenPencil; the bundled CanvasKit, HarfBuzz and fonts carry their own licences in
`LICENSES/`, `canvaskit/` and `core/assets/`.
