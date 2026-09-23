import { colors } from "../tokens/colors";
import { space } from "../tokens/spacing";

export function Button(props: { children: unknown; [attr: string]: unknown }) {
  return <button class="btn" style={{ color: colors.ink, padding: space[2] }} {...props}>{props.children}</button>;
}
