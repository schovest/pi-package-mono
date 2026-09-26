import { verifyShipManifest } from "@schovest/pi-test-utils";
import { expect, test } from "vitest";

test("ship manifest: files 字段与磁盘生产文件树双向一致", () => {
  expect(verifyShipManifest(import.meta.url).missing).toEqual([]);
});
