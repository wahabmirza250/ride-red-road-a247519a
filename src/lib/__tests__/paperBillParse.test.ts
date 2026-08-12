import { expect, test } from "vitest";
import { digitsFromBracketAware } from "../paperBillParse";
test("brackets", () => {
  expect(digitsFromBracketAware("(8)")).toBe("8");
  expect(digitsFromBracketAware("1 (8)")).toBe("8");
  expect(digitsFromBracketAware("(8) 12mi")).toBe("8");
  expect(digitsFromBracketAware("[8] miles")).toBe("8");
  expect(digitsFromBracketAware("124,563")).toBe("124563");
  expect(digitsFromBracketAware("(124,563) odo")).toBe("124563");
});
