import postcss, { type AtRule, type ChildNode, type Root } from 'postcss'
import type { Plugin } from 'vite'

/** The class an embedded editor's element and portal carry; every embed style is scoped under it. */
export const EMBED_SCOPE_CLASS = 'xop'
const SCOPE = `.${EMBED_SCOPE_CLASS}`

/** The page's root in a selector: `:root`, `html`, `:host`, `body` or the app's `#app`. */
const LEADING_ROOT = /^(?::root|:host|html|body|#app)(?![\w-])/
const ANY_ROOT = /:root(?![\w-])/g

/**
 * A selector moved inside the embed's scope: one that names the page's root names the editor's
 * element instead, and any other matches only inside it. One that already starts at the scope is
 * left as written.
 */
export function scopeSelector(selector: string): string {
  const trimmed = selector.trim()
  if (trimmed.startsWith(SCOPE)) return trimmed
  const rooted = trimmed.replace(LEADING_ROOT, SCOPE).replace(ANY_ROOT, SCOPE)
  return rooted.startsWith(SCOPE) ? rooted : `${SCOPE} ${rooted}`
}

/**
 * Hoists each cascade layer's rules into one place in the declared order, ahead of the unlayered
 * rules, and drops the layers. The host's page is unlayered; a layered rule of the editor's would
 * lose to any of the host's rules, whatever their specificity.
 */
function hoistLayers(root: Root): void {
  const order: string[] = []
  const blocks = new Map<string, AtRule[]>()
  root.walkAtRules('layer', (rule) => {
    if (rule.nodes) return
    for (const layer of rule.params.split(',').map((name) => name.trim())) {
      if (!order.includes(layer)) order.push(layer)
    }
    rule.remove()
  })
  root.each((node) => {
    if (node.type !== 'atrule' || node.name !== 'layer' || !node.nodes) return
    const layer = node.params.trim()
    if (!order.includes(layer)) order.push(layer)
    blocks.set(layer, [...(blocks.get(layer) ?? []), node])
  })
  const hoisted: ChildNode[] = []
  for (const layer of order) {
    for (const block of blocks.get(layer) ?? []) {
      hoisted.push(...(block.nodes ?? []).map((child) => child.clone()))
      block.remove()
    }
  }
  let anchor: ChildNode | null = null
  root.each((node) => {
    if (node.type === 'atrule' && (node.name === 'charset' || node.name === 'import')) anchor = node
  })
  if (anchor) (anchor as ChildNode).after(hoisted)
  else root.prepend(hoisted)
  root.walkAtRules('layer', (rule) => {
    if (rule.nodes) rule.replaceWith(rule.nodes)
    else rule.remove()
  })
}

function scopeRules(root: Root): void {
  root.walkRules((rule) => {
    const parent = rule.parent
    if (parent?.type === 'atrule' && /keyframes$/.test((parent as AtRule).name)) return
    rule.selectors = rule.selectors.map(scopeSelector)
  })
}

export const embedCssPostcss = {
  postcssPlugin: 'open-pencil-embed-css',
  Once(root: Root) {
    hoistLayers(root)
    scopeRules(root)
  }
}

/**
 * The embed build's styles: after Tailwind, every stylesheet is unlayered and scoped under
 * `.xop`, so the editor's styles reach only the editor and win there over the host's.
 */
export function embedCssPlugin(): Plugin {
  return {
    name: 'open-pencil:embed-css',
    async transform(code, id) {
      if (!/\.css(?:\?|$)/.test(id) && !/[?&]lang\.css/.test(id)) return null
      // A page's own inline styles are the host's, as `embed.html`'s are; a stylesheet read as text
      // or an address is the editor's to use, not the page's.
      if (id.includes('html-proxy') || /[?&](?:raw|url|inline)\b/.test(id)) return null
      const result = await postcss([embedCssPostcss]).process(code, { from: undefined })
      return { code: result.css, map: null }
    }
  }
}
