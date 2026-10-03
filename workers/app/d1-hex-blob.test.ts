import { expect, it } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { decodeD1HexBlob } from "../_shared/storage/d1-hex-blob";

it("roundtrips every byte through the actual D1 hex projection without interpreting text", async () => {
  const original = new Uint8Array(65536);
  for (let i = 0; i < original.length; i++) original[i] = i % 256;
  const hex = await db.prepare("SELECT hex(?) AS body_hex").bind(original.buffer).first("body_hex");
  expect(decodeD1HexBlob(hex, 65536)).toEqual(original);
  expect(decodeD1HexBlob(hex, 65535)).toBeNull();
  expect(decodeD1HexBlob("", 65536)).toEqual(new Uint8Array());
});

it("rejects malformed projections and SQL text masquerading as a BLOB", async () => {
  for (const value of [null, undefined, [], {}, "0", "GG", "0x", " 0", "\n0", "Ａ0", "ff"]) {
    expect(decodeD1HexBlob(value, 65536)).toBeNull();
  }
  const projected = await db.prepare("SELECT CASE WHEN typeof(?)='blob' THEN hex(?) END AS body_hex")
    .bind("{}", "{}").first("body_hex");
  expect(decodeD1HexBlob(projected, 65536)).toBeNull();
});
