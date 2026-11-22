/**
 * The editor as another application embeds it: one design, read from and saved to `.fig` bytes the
 * host keeps. The host owns the file, the window and the theme; the editor has no tabs, Home, AI
 * chat, collaboration, Cloud or desktop features of its own.
 */
export type DesignEditorTheme = 'light' | 'dark'

/** A layer the person selected, for a host that anchors comments or requests to it. */
export interface DesignEditorNode {
  id: string
  name: string
  type: string
}

export interface DesignEditorOptions {
  /** The design's `.fig` bytes; null opens an empty design. */
  bytes: Uint8Array | null
  /** What the document is called, as its first page and exports name it. */
  name?: string
  editable?: boolean
  theme?: DesignEditorTheme
  /** The design after an edit, as `.fig` bytes; edits that follow quickly are saved together. */
  onChange?: (bytes: Uint8Array) => void | Promise<void>
  /** The layers the person selected; empty when nothing is. */
  onSelection?: (nodes: DesignEditorNode[]) => void
  /** A load or save failed. */
  onError?: (error: unknown) => void
  /** How long after the last edit the design saves, in milliseconds. */
  saveDelay?: number
}

export interface DesignEditorHandle {
  /** Shows other bytes, such as a newer revision the host received; unsaved edits are dropped. */
  load(bytes: Uint8Array | null, name?: string): Promise<void>
  setTheme(theme: DesignEditorTheme): void
  setEditable(editable: boolean): void
  /** Saves any edit not yet saved, now. */
  flush(): Promise<void>
  destroy(): void
}
