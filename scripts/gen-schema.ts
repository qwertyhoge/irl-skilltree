// 交換用 JSON Schema を zod の定義から生成する（npm run schema）。
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { TreeDocSchema } from "../src/model/schema";

const schema = {
  title: "IRL Skilltree v1",
  ...z.toJSONSchema(TreeDocSchema),
};
writeFileSync(
  new URL("../schema/skilltree.v1.schema.json", import.meta.url),
  JSON.stringify(schema, null, 2) + "\n",
);
console.log("schema/skilltree.v1.schema.json を書き出しました");
