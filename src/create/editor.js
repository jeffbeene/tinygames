import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightActiveLineGutter, drawSelection, rectangularSelection,
         highlightSpecialChars } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting,
         defaultHighlightStyle } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, autocompletion,
         completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { paddingBottom: '40vh' },
  '&.cm-focused': { outline: 'none' },
})

/**
 * @param {HTMLElement} parent
 * @param {{ doc: string, onChange: (doc: string) => void, onRun: () => void }} opts
 */
export function createEditor(parent, { doc, onChange, onRun }) {
  const editable = new Compartment()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-Enter', run: () => (onRun(), true) },
          // Swallow the browser's save dialog; the URL is the document here.
          { key: 'Mod-s', run: () => (onRun(), true) },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        javascript(),
        oneDark,
        theme,
        editable.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString())
        }),
      ],
    }),
  })

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: 0 },
        scrollIntoView: true,
      })
    },
    focus: () => view.focus(),
  }
}
