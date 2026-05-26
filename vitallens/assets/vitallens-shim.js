// Tiny shim: import the ESM bundle locally, expose VitalLens as a global so
// the rest of the page can use `window.VitalLens` without any module syntax.
import { VitalLens, Frame } from './vitallens.browser.js';
window.VitalLens = VitalLens;
window.VitalLensFrame = Frame;
window.dispatchEvent(new Event('vitallens-ready'));
