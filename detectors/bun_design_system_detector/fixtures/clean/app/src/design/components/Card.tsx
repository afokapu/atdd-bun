import { Text } from "../primitives/Text";
import { space } from "../tokens/spacing";

export function Card(props: { title: string; children: unknown }) {
  return <section class="card" style={{ padding: space[4], borderRadius: "var(--radius)" }}><Text>{props.title}</Text>{props.children}</section>;
}
