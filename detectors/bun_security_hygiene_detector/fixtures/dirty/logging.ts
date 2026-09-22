export function handle(order) {
  console.log("processing", order.id);
  logger.info("order processed");
}
