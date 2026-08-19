// Bans time and randomness in the pure zones. dependency-cruiser only covers imports.
import { globSync, readFileSync } from "node:fs";

const zones = "src/core/{reduce,receipts,attention,conflicts,reports}/**/*.ts";
const banned = [/\bDate\.now\s*\(/, /\bnew Date\s*\(/, /\bMath\.random\s*\(/, /\bperformance\.now\s*\(/];
let bad = 0;
for (const f of globSync(zones)) {
  const src = readFileSync(f, "utf8");
  for (const re of banned)
    if (re.test(src)) {
      console.error(`PURE VIOLATION ${f}: ${re}`);
      bad++;
    }
}
process.exit(bad ? 1 : 0);
