export async function findOrder(db, id) {
  return db.query(`SELECT * FROM orders WHERE id = ${id}`);
}
export async function findUser(db, name) {
  return db.query("SELECT * FROM users WHERE name = " + name);
}
