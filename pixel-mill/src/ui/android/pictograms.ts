import type { ToolId } from "../../config";

// Flat tool pictograms on a 24 x 32 grid: holder band (tool's rack-ring colour), collet, cutter.
// .fg follows the key's text colour; .cut (flute grooves) uses --ti-cut so it matches the key face.
const BODY: Record<ToolId, string> = {
  flat: '<rect class="fg" x="9" y="10" width="6" height="19"/><g class="cut"><path d="M9 15l6-2.2v1.6L9 16.6z"/><path d="M9 20l6-2.2v1.6L9 21.6z"/><path d="M9 25l6-2.2v1.6L9 26.6z"/></g>',
  ball: '<path class="fg" d="M9 10h6v15a3 3 0 0 1-6 0z"/><g class="cut"><path d="M9 15l6-2.2v1.6L9 16.6z"/><path d="M9 20l6-2.2v1.6L9 21.6z"/></g>',
  vbit: '<rect class="fg" x="10" y="10" width="4" height="9"/><path class="fg" d="M6 19h12l-6 11z"/>',
  drill: '<path class="fg" d="M10 10h4v17l-2 4-2-4z"/><g class="cut"><path d="M10 14l4-1.8v1.4L10 15.4z"/><path d="M10 18l4-1.8v1.4L10 19.4z"/><path d="M10 22l4-1.8v1.4L10 23.4z"/></g>',
  face: '<rect class="fg" x="10" y="10" width="4" height="6"/><rect class="fg" x="2" y="16" width="20" height="7"/><g class="cut"><rect x="4" y="21" width="3" height="2"/><rect x="10.5" y="21" width="3" height="2"/><rect x="17" y="21" width="3" height="2"/></g>',
  engrave: '<rect class="fg" x="10.5" y="10" width="3" height="12"/><path class="fg" d="M10.5 22h3l-1.5 9z"/>',
};

export function toolPictogram(id: ToolId, ringColor: string) {
  return (
    `<svg class="ti" viewBox="0 0 24 32" aria-hidden="true">` +
    `<rect x="5" y="1" width="14" height="5" fill="${ringColor}" stroke="#1d1d1b" stroke-width="1"/>` +
    `<path class="fg" d="M7 6h10l-2 4H9z"/>${BODY[id]}</svg>`
  );
}
