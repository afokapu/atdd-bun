import { Card } from "../components/Card";

export function Page(props: { title: string; children: unknown }) {
  return <main><Card title={props.title}>{props.children}</Card></main>;
}
