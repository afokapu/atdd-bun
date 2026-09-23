import { Button, Text } from "../../../design/primitives";
import { Page } from "../../../design/templates/Page";

export function OrdersView() {
  return <Page title="Orders"><Text>Open orders</Text><Button hx-post="/orders">Place order</Button></Page>;
}
