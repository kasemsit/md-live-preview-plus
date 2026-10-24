/**
 * md-live-preview-plus: entry point of the separately built KaTeX bundle
 * (`dist/katex-chunk.js`). Loaded on demand by webview-editor/plus/math.ts as a
 * nonce'd classic <script>, so it publishes KaTeX on `window` rather than
 * exporting it — the same arrangement as the Mermaid chunk.
 */
import katex from 'katex';

window.mlpKatex = katex;
