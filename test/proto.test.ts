import { expect, test } from "bun:test";

import { decodeGetChatMessageResponse } from "../src/proto.ts";

test("decodes delta_text after an unknown length-delimited field", () => {
  const responseBytes = Uint8Array.of(
    0x12,
    0x0c, // field 2: Timestamp, 12-byte payload
    0x08,
    0x80,
    0xe2,
    0xcf,
    0xaa,
    0x06, // seconds: 1700000000
    0x10,
    0xff,
    0x93,
    0xeb,
    0xdc,
    0x03, // nanos: 999999999
    0x1a,
    0x05,
    0x68,
    0x65,
    0x6c,
    0x6c,
    0x6f, // field 3: delta_text = "hello"
  );

  expect(decodeGetChatMessageResponse(responseBytes).deltaText).toBe("hello");
});
