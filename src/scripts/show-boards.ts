import { db } from "../db";

const boards = db
  .query("SELECT * FROM discovered_boards ORDER BY created_at DESC LIMIT 10")
  .all();
console.table(boards);
