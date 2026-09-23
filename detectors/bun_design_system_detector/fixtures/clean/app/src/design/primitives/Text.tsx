import { colors } from "../tokens/colors";

export function Text(props: { children: unknown }) {
  return <span style={{ color: colors.ink }}>{props.children}</span>;
}
