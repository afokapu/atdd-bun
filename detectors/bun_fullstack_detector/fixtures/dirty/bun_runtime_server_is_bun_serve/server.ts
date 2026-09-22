import express from "express";

const app = express();
app.get("/orders", (req, res) => res.send(renderOrders()));
app.listen(3000);
