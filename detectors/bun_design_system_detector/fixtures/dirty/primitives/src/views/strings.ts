// FRG shape: an htmx/Bun server-rendered app builds its controls as HTML
// strings in .ts presentation files, not in .tsx components.
export const caseForm = (action: string) =>
  '<form action="' + action + '"><input type="text" name="caseId"><textarea name="notes" rows="4"></textarea></form>';

export const severityPicker = `<select name="severity"></select>`;

function html(parts: TemplateStringsArray, ...values: unknown[]) {
  return parts.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
}

export const submitRow = () => html`<button type="submit" class="btn">Open case</button>`;
