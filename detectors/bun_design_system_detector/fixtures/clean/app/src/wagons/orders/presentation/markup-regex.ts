// Regex literals and comments are never rendered markup, and a <div> string is
// not an interactive control: none of these may produce a primitives finding.
export const STRIP_CONTROLS = /<button>|<input>|<select>|<textarea>/g;

// A raw <button> or <textarea> mentioned in a comment is prose, not markup.
export const rowMarkup = '<div class="row"><span class="label"></span></div>';
