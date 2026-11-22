/**
 * A design document engine for a host that keeps designs as `.fig` bytes and edits them with no
 * window: open, run a Plugin API script, lay HTML out as layers, render, and outline as text. It
 * is the CLI's headless path (`packages/cli/src/headless.ts`, `tool-data.ts`) without the CLI's
 * files and arguments: every input and output is bytes or JSON.
 */
import { createEditor, createDocumentGraph } from '@open-pencil/core'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { FigmaAPI, flushPendingComponentSync, flushPendingLayout } from '@open-pencil/core/figma-api'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import {
  figThumbnailPageId,
  pendingFigPageOfNode,
  populateAllFigPages,
  populateFigPage
} from '@open-pencil/core/io/formats/fig'
import { readHTMLDocument } from '@open-pencil/core/io/formats/html/import'
import {
  createCanvasKitRasterCodec,
  headlessRenderer,
  headlessRenderNodes
} from '@open-pencil/core/io/formats/raster'
import { computeAllLayouts, installTextMeasurer, sizeAutoResizingText } from '@open-pencil/core/layout'
import { fontManager, installTextInkMeasurer, prepareGraphFonts } from '@open-pencil/core/text'
import { compileScript } from '@open-pencil/core/tools'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { collectSceneMutation } from '@open-pencil/scene-graph/mutation-impact'

const io = new IORegistry(BUILTIN_IO_FORMATS)

function binary(data: Uint8Array | string): Uint8Array {
  if (typeof data === 'string') throw new Error('Expected binary output.')
  return data
}

type Renderer = Awaited<ReturnType<typeof headlessRenderer>>
let renderer: Promise<Renderer> | null = null

/** CanvasKit, the fonts' measurer and the renderer, loaded once per process. */
export function init(): Promise<Renderer> {
  renderer ??= (async () => {
    // Fonts come from the bundle only: the engine runs with no network, and a provider it cannot
    // reach only delays each text with its retries. A family it lacks is drawn in a stand-in.
    fontManager.setOnlineFontProviders({})
    const r = await headlessRenderer()
    installTextMeasurer((node, maxWidth) => r.measureTextNode(node, maxWidth))
    installTextInkMeasurer((node) => r.measureTextInk(node))
    return r
  })()
  return renderer
}

function layOut(graph: SceneGraph, pageId?: string) {
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph, pageId))
}

/** A new design with one empty page. */
export function newDocument(name = 'Page 1'): SceneGraph {
  const graph = createDocumentGraph('design', 'light')
  const [page] = graph.getPages()
  if (page) page.name = name
  return graph
}

/** Opens `.fig` bytes with every page loaded and its text measured in the fonts it names. */
export async function openFig(bytes: Uint8Array): Promise<SceneGraph> {
  await init()
  const { graph } = await io.readDocument({
    name: 'design.fig',
    data: bytes,
    readAsset: async () => null,
    readImport: async () => null
  })
  layOut(graph)
  if (populateAllFigPages(graph)) layOut(graph)
  await prepareGraphFonts(
    graph,
    graph.getPages(true).map((page) => page.id)
  )
  return graph
}

/** The document as `.fig` bytes, with the thumbnail a `.fig` carries. */
export async function toFig(graph: SceneGraph): Promise<Uint8Array> {
  await init()
  flushPendingLayout(graph)
  const cover = figThumbnailPageId(graph.getPages())
  if (cover && populateFigPage(graph, cover)) layOut(graph, cover)
  const result = await io.writeDocument('fig', graph, { renderThumbnail: true })
  return binary(result.data)
}

/** Runs `edit`, then sizes the text it touched again in the fonts that text needs. */
async function edit<T>(graph: SceneGraph, change: () => T | Promise<T>): Promise<{ result: T; changed: string[] }> {
  const { result, impact } = await collectSceneMutation(graph, async () => {
    const value = await change()
    flushPendingComponentSync(graph)
    return value
  })
  const changed = [...impact.changedNodeIds]
  const textIds = changed.filter((id) => graph.getNode(id)?.type === 'TEXT')
  if (textIds.length) {
    await prepareGraphFonts(graph, textIds)
    for (const id of textIds) sizeAutoResizingText(graph, id)
  }
  return { result, changed }
}

/** The Figma Plugin API over `graph`, as the CLI's `eval` gives a script. */
export async function figmaFor(graph: SceneGraph, pageId?: string): Promise<FigmaAPI> {
  const r = await init()
  const figma = new FigmaAPI(graph, {
    loadPage: async (id) => {
      if (populateFigPage(graph, id)) layOut(graph, id)
    },
    pageOfNode: (id) => pendingFigPageOfNode(graph, id)
  })
  r.nodePaths.clear()
  r.invalidateAllPictures()
  figma.setRenderer(r)
  figma.exportImage = (nodeIds, options) =>
    headlessRenderNodes(graph, options.pageId ?? figma.currentPageId, nodeIds, options)
  figma.rasterCodec = createCanvasKitRasterCodec(await getCanvasKit())
  if (pageId) figma.currentPage = figma.wrapNode(pageId)
  return figma
}

function plain(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value ?? null
  if (depth > 6) return '…'
  if (typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    return plain(value.toJSON(), depth + 1)
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => plain(item, depth + 1))
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 200).map(([key, item]) => [key, plain(item, depth + 1)])
    )
  }
  if (typeof value === 'function') return '<function>'
  if (typeof value === 'bigint') return value.toString()
  return value
}

/** Runs a Plugin API script (`figma` and `openpencil` in scope; top-level await allowed). */
export async function runScript(
  graph: SceneGraph,
  code: string,
  pageId?: string
): Promise<{ result: unknown; changed: string[] }> {
  const figma = await figmaFor(graph, pageId)
  const { result, changed } = await edit(graph, () => compileScript(code)(figma))
  return { result: plain(result), changed }
}

export interface HTMLPlacement {
  name: string
  width: number
  height: number
  x?: number
  y?: number
  pageId?: string
}

/**
 * Lays HTML out at `width`×`height` as a browser window would and adds it to the page as one
 * frame of editable layers, named `name`, at `x`,`y` (to the right of what the page holds when
 * neither is given). Returns the frame's id.
 */
export async function importHTML(graph: SceneGraph, html: string, place: HTMLPlacement): Promise<string> {
  await init()
  const page = place.pageId ? graph.getNode(place.pageId) : graph.getPages()[0]
  if (!page || page.type !== 'CANVAS') throw new Error(`No page ${place.pageId ?? ''}`.trim())
  const { graph: imported } = await readHTMLDocument(html, {
    pageName: place.name,
    viewport: { width: place.width, height: place.height },
    framed: true
  })
  const roots = imported.getChildren(imported.getPages()[0]!.id)
  let frame: SceneNode | undefined
  if (roots.length) {
    // Copied from the laid-out page and pasted into this one, as a copy between two open documents.
    const source = createEditor({ graph: imported, skipInitialGraphSetup: true })
    source.state.currentPageId = imported.getPages()[0]!.id
    source.state.selectedIds = new Set(roots.map((node) => node.id))
    const { snapshot } = await source.prepareCopy()
    if (!snapshot) throw new Error('The HTML did not import.')
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    editor.state.currentPageId = page.id
    editor.state.selectedIds = new Set()
    await editor.pasteSnapshot(snapshot, { x: 0, y: 0 })
    const [frameId] = [...editor.state.selectedIds]
    frame = frameId ? graph.getNode(frameId) : undefined
  } else {
    // A page that shows nothing, such as a blank screen, is a blank frame of the window's size.
    frame = graph.createNode('FRAME', page.id, {
      name: place.name,
      width: place.width,
      height: place.height,
      clipsContent: true,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
  }
  if (!frame) throw new Error('The HTML did not import.')
  frame.name = place.name
  const origin = place.x === undefined && place.y === undefined ? nextSlot(graph, page, frame) : null
  frame.x = place.x ?? origin?.x ?? 0
  frame.y = place.y ?? origin?.y ?? 0
  layOut(graph, page.id)
  return frame.id
}

/** Right of the page's other top-level layers, 80 apart, on the row of the topmost. */
function nextSlot(graph: SceneGraph, page: SceneNode, except: SceneNode) {
  const others = graph.getChildren(page.id).filter((node) => node.id !== except.id)
  if (!others.length) return { x: 0, y: 0 }
  return {
    x: Math.max(...others.map((node) => node.x + node.width)) + 80,
    y: Math.min(...others.map((node) => node.y))
  }
}

export type RenderTarget = { nodeId: string } | { pageId?: string }

function exportTarget(graph: SceneGraph, target: RenderTarget) {
  if ('nodeId' in target) {
    if (!graph.getNode(target.nodeId)) throw new Error(`No layer ${target.nodeId}`)
    return { scope: 'node' as const, nodeId: target.nodeId }
  }
  const page = target.pageId ? graph.getNode(target.pageId) : graph.getPages()[0]
  if (!page || page.type !== 'CANVAS') throw new Error(`No page ${target.pageId ?? ''}`.trim())
  return { scope: 'page' as const, pageId: page.id }
}

/** A PNG of a layer or a page. */
export async function renderPNG(graph: SceneGraph, target: RenderTarget, scale = 1): Promise<Uint8Array> {
  await init()
  const result = await io.exportContent(
    'png',
    { graph, target: exportTarget(graph, target), fileName: 'render.png' },
    { format: 'PNG', scale }
  )
  return binary(result.data)
}

/** An SVG of a layer or a page. */
export async function renderSVG(graph: SceneGraph, target: RenderTarget): Promise<string> {
  await init()
  const result = await io.exportContent('svg', {
    graph,
    target: exportTarget(graph, target),
    fileName: 'render.svg'
  })
  return typeof result.data === 'string' ? result.data : new TextDecoder().decode(result.data)
}

export interface OutlineNode {
  id: string
  name: string
  type: string
  x: number
  y: number
  w: number
  h: number
  text?: string
  children?: OutlineNode[]
}
export interface OutlinePage {
  id: string
  name: string
  nodes: OutlineNode[]
}

function outlineNode(graph: SceneGraph, node: SceneNode, depth: number): OutlineNode {
  const entry: OutlineNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: Math.round(node.width),
    h: Math.round(node.height)
  }
  if (node.type === 'TEXT' && node.text) entry.text = node.text.slice(0, 300)
  const children = graph.getChildren(node.id)
  if (children.length && depth < 4) {
    entry.children = children.slice(0, 60).map((child) => outlineNode(graph, child, depth + 1))
  }
  return entry
}

/** The pages and their layers, four levels deep, with each text's characters. */
export function outline(graph: SceneGraph): OutlinePage[] {
  return graph.getPages().map((page) => ({
    id: page.id,
    name: page.name,
    nodes: graph.getChildren(page.id).map((node) => outlineNode(graph, node, 0))
  }))
}

/** The outline as indented text, for a reader or a model. */
export function outlineText(pages: OutlinePage[]): string {
  const lines: string[] = []
  const walk = (node: OutlineNode, indent: string) => {
    const text = node.text ? ` "${node.text.replace(/\s+/g, ' ').slice(0, 120)}"` : ''
    const label = node.type === 'TEXT' ? '' : ` "${node.name}"`
    lines.push(`${indent}${node.type.toLowerCase()} ${node.id}${label} ${node.x},${node.y} ${node.w}×${node.h}${text}`)
    for (const child of node.children ?? []) walk(child, `${indent}  `)
  }
  for (const page of pages) {
    lines.push(`--- ${page.name} (${page.id}) ---`)
    if (!page.nodes.length) lines.push('(empty)')
    for (const node of page.nodes) walk(node, '')
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

// ---- Migration from the earlier canvas format --------------------------------------------------

/** One item of a design saved in the earlier `canvas.json` format. */
export interface CanvasItem {
  id: string
  kind: 'frame' | 'text' | 'note' | 'shape' | 'draw' | 'image'
  x: number
  y: number
  w: number
  h: number
  name?: string
  file?: string
  text?: string
  style?: { fontSize?: number; shape?: string; color?: string }
  points?: number[][]
}
export interface CanvasFile {
  version: 1
  pages: { id: string; name: string; items: CanvasItem[] }[]
}

function hexColor(value: unknown, fallback: { r: number; g: number; b: number }) {
  if (typeof value !== 'string') return fallback
  const hex = value.trim().replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback
  const n = Number.parseInt(full, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const solid = (color: { r: number; g: number; b: number }) => [{ type: 'SOLID' as const, color }]
const INK = { r: 0.08, g: 0.08, b: 0.08 }

/**
 * A design in the earlier format as a `.fig` document: each frame's HTML laid out as layers at its
 * size, and text, notes, shapes, strokes and images as native layers where they were.
 */
export async function migrateCanvas(
  canvas: CanvasFile,
  files: { text: Record<string, string>; binary: Record<string, Uint8Array> }
): Promise<SceneGraph> {
  await init()
  const graph = newDocument(canvas.pages[0]?.name ?? 'Page 1')
  for (const [index, page] of canvas.pages.entries()) {
    const target = index === 0 ? graph.getPages()[0]! : graph.addPage(page.name || `Page ${index + 1}`)
    for (const item of page.items) {
      if (item.kind === 'frame') {
        const html = item.file ? files.text[item.file] : undefined
        if (html === undefined) continue
        await importHTML(graph, html, {
          name: item.name || 'Frame',
          width: Math.max(1, Math.round(item.w)),
          height: Math.max(1, Math.round(item.h)),
          x: item.x,
          y: item.y,
          pageId: target.id
        })
        continue
      }
      const figma = await figmaFor(graph, target.id)
      await edit(graph, async () => {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
        const color = hexColor(item.style?.color, INK)
        if (item.kind === 'text' || item.kind === 'note') {
          const text = figma.createText()
          text.fontName = { family: 'Inter', style: 'Regular' }
          text.fontSize = item.style?.fontSize ?? (item.kind === 'note' ? 16 : 24)
          text.characters = item.text ?? ''
          text.fills = solid(color)
          if (item.kind === 'text') {
            text.name = item.name || (item.text ?? 'Text').slice(0, 40)
            text.textAutoResize = 'HEIGHT'
            text.resize(Math.max(1, item.w), Math.max(1, item.h))
            text.x = item.x
            text.y = item.y
            return
          }
          const note = figma.createFrame()
          note.name = item.name || 'Note'
          note.resize(Math.max(1, item.w), Math.max(1, item.h))
          note.x = item.x
          note.y = item.y
          note.cornerRadius = 8
          note.fills = solid({ r: 1, g: 0.95, b: 0.74 })
          note.appendChild(text)
          text.textAutoResize = 'HEIGHT'
          text.x = 12
          text.y = 12
          text.resize(Math.max(1, item.w - 24), Math.max(1, item.h - 24))
          return
        }
        if (item.kind === 'shape') {
          const shape = item.style?.shape === 'ellipse' ? figma.createEllipse() : figma.createRectangle()
          shape.name = item.name || (item.style?.shape === 'ellipse' ? 'Ellipse' : 'Rectangle')
          shape.resize(Math.max(1, item.w), Math.max(1, item.h))
          shape.x = item.x
          shape.y = item.y
          shape.fills = solid(hexColor(item.style?.color, { r: 0.85, g: 0.87, b: 0.9 }))
          return
        }
        if (item.kind === 'draw' && item.points?.length) {
          const points = item.points.map(([x = 0, y = 0]) => `${x},${y}`).join(' ')
          const stroke = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, item.w)}" height="${Math.max(1, item.h)}"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          const drawing = figma.createNodeFromSvg(svg)
          drawing.name = item.name || 'Drawing'
          drawing.x = item.x
          drawing.y = item.y
          return
        }
        if (item.kind === 'image') {
          const bytes = item.file ? files.binary[item.file] : undefined
          const rect = figma.createRectangle()
          rect.name = item.name || 'Image'
          rect.resize(Math.max(1, item.w), Math.max(1, item.h))
          rect.x = item.x
          rect.y = item.y
          rect.fills = bytes
            ? [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: figma.createImage(bytes).hash }]
            : solid({ r: 0.9, g: 0.9, b: 0.9 })
        }
      })
    }
    layOut(graph, target.id)
  }
  return graph
}
