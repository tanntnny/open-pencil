// The page `embed.html` runs: the embed in a host page of its own, on a sample document.
import { mountDesignEditor } from './index'

const log = document.querySelector('#log') as HTMLElement
const say = (text: string) => {
  log.textContent = text
}

const response = await fetch('/tests/fixtures/circle-text.fig')
const bytes = new Uint8Array(await response.arrayBuffer())
let dark = document.documentElement.classList.contains('dark')
let editable = true
let saves = 0

const editor = mountDesignEditor(document.querySelector('#host') as HTMLElement, {
  bytes,
  name: 'Sample',
  theme: dark ? 'dark' : 'light',
  onChange: (data) => {
    saves++
    say(`Saved ${saves}× · ${data.byteLength.toLocaleString()} bytes`)
  },
  onSelection: (nodes) => say(nodes.length ? `Selected ${nodes.map((n) => n.name).join(', ')}` : 'Nothing selected'),
  onError: (error) => {
    console.error(error)
    say(`Error: ${String(error)}`)
  }
})
say('Opened')

document.querySelector('#theme')?.addEventListener('click', () => {
  dark = !dark
  document.documentElement.classList.toggle('dark', dark)
  editor.setTheme(dark ? 'dark' : 'light')
})
document.querySelector('#editable')?.addEventListener('click', () => {
  editable = !editable
  editor.setEditable(editable)
  say(editable ? 'Editing on' : 'View only')
})
document.querySelector('#flush')?.addEventListener('click', () => void editor.flush())
Object.assign(window, { designEditor: editor })
