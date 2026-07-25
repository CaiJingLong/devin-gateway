import { expect, test, describe } from "bun:test";

import { ProtoEncoder, ProtoDecoder } from "../src/proto.ts";

// ─── Byte-construction helpers (mirror the wire format) ─────────────────────
// Used to craft raw protobuf payloads for decoder-only assertions, so we
// exercise the decoder independently of the encoder under test.

function encodeVarint(value: number | bigint): number[] {
  const bytes: number[] = [];
  let n = BigInt(value);
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0n);
  return bytes;
}

function encodeTag(field: number, wire: number): number[] {
  return encodeVarint((field << 3) | wire);
}

function encodeString(field: number, value: string): number[] {
  const payload = new TextEncoder().encode(value);
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeUint32(field: number, value: number): number[] {
  return [...encodeTag(field, 0), ...encodeVarint(value)];
}

function encodeFixed64(field: number, bytes: number[]): number[] {
  return [...encodeTag(field, 1), ...bytes];
}

function encodeFixed32(field: number, bytes: number[]): number[] {
  return [...encodeTag(field, 5), ...bytes];
}

function encodeMessage(field: number, payload: number[]): number[] {
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

// ─── Encoder/Decoder primitives ─────────────────────────────────────────────

describe("ProtoEncoder.string", () => {
  test("round-trips a non-empty string via readString", () => {
    const enc = new ProtoEncoder();
    enc.string(3, "héllo 🌍");
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(3);
    expect(wire).toBe(2);
    expect(dec.readString()).toBe("héllo 🌍");
    expect(dec.done).toBe(true);
  });

  test("empty string produces no bytes (proto3 zero-value omission)", () => {
    const enc = new ProtoEncoder();
    enc.string(1, "");
    expect(enc.finish().length).toBe(0);
  });

  test("undefined and null produce no bytes", () => {
    const enc = new ProtoEncoder();
    enc.string(1, undefined);
    enc.string(2, null);
    expect(enc.finish().length).toBe(0);
  });
});

describe("ProtoEncoder.uint32", () => {
  test("zero is omitted (no bytes)", () => {
    const enc = new ProtoEncoder();
    enc.uint32(1, 0);
    expect(enc.finish().length).toBe(0);
  });

  test("undefined is omitted", () => {
    const enc = new ProtoEncoder();
    enc.uint32(1, undefined);
    expect(enc.finish().length).toBe(0);
  });

  test("non-zero round-trips via readVarint", () => {
    const enc = new ProtoEncoder();
    enc.uint32(4, 300);
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(4);
    expect(wire).toBe(0);
    expect(dec.readVarint()).toBe(300n);
    expect(dec.done).toBe(true);
  });
});

describe("ProtoEncoder.uint64", () => {
  test("bigint 0 is omitted", () => {
    const enc = new ProtoEncoder();
    enc.uint64(1, 0n);
    expect(enc.finish().length).toBe(0);
  });

  test("number 0 is omitted", () => {
    const enc = new ProtoEncoder();
    enc.uint64(1, 0);
    expect(enc.finish().length).toBe(0);
  });

  test("undefined is omitted", () => {
    const enc = new ProtoEncoder();
    enc.uint64(1, undefined);
    expect(enc.finish().length).toBe(0);
  });

  test("bigint non-zero round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint64(2, 0xFFFFFFFFn);
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(2);
    expect(wire).toBe(0);
    expect(dec.readVarint()).toBe(0xFFFFFFFFn);
    expect(dec.done).toBe(true);
  });

  test("number non-zero round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint64(5, 123456);
    const dec = new ProtoDecoder(enc.finish());
    dec.readTag();
    expect(dec.readVarint()).toBe(123456n);
  });
});

describe("ProtoEncoder.bool", () => {
  test("false is omitted", () => {
    const enc = new ProtoEncoder();
    enc.bool(1, false);
    expect(enc.finish().length).toBe(0);
  });

  test("undefined is omitted", () => {
    const enc = new ProtoEncoder();
    enc.bool(1, undefined);
    expect(enc.finish().length).toBe(0);
  });

  test("true encodes as varint 1", () => {
    const enc = new ProtoEncoder();
    enc.bool(7, true);
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(7);
    expect(wire).toBe(0);
    expect(dec.readVarint()).toBe(1n);
    expect(dec.done).toBe(true);
  });
});

describe("ProtoEncoder.double", () => {
  test("0 is omitted", () => {
    const enc = new ProtoEncoder();
    enc.double(1, 0);
    expect(enc.finish().length).toBe(0);
  });

  test("undefined is omitted", () => {
    const enc = new ProtoEncoder();
    enc.double(1, undefined);
    expect(enc.finish().length).toBe(0);
  });

  test("non-zero round-trips via readDouble (little-endian)", () => {
    const enc = new ProtoEncoder();
    enc.double(3, 3.141592653589793);
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(3);
    expect(wire).toBe(1);
    expect(dec.readDouble()).toBe(3.141592653589793);
    expect(dec.done).toBe(true);
  });

  test("negative double round-trips", () => {
    const enc = new ProtoEncoder();
    enc.double(1, -2.5);
    const dec = new ProtoDecoder(enc.finish());
    dec.readTag();
    expect(dec.readDouble()).toBe(-2.5);
  });
});

describe("ProtoEncoder.message", () => {
  test("nested submessage has length prefix and round-trips via readMessage", () => {
    const enc = new ProtoEncoder();
    enc.message(4, (e) => {
      e.string(1, "inner");
      e.uint32(2, 42);
    });
    const dec = new ProtoDecoder(enc.finish());
    const { field, wire } = dec.readTag();
    expect(field).toBe(4);
    expect(wire).toBe(2);
    const sub = dec.readMessage((d) => {
      const out: { s: string; n: bigint } = { s: "", n: 0n };
      while (!d.done) {
        const t = d.readTag();
        if (t.field === 1) out.s = d.readString();
        else if (t.field === 2) out.n = d.readVarint();
        else d.skip(t.wire);
      }
      return out;
    });
    expect(sub).toEqual({ s: "inner", n: 42n });
    expect(dec.done).toBe(true);
  });

  test("empty submessage still emits tag + zero length", () => {
    const enc = new ProtoEncoder();
    enc.message(1, () => {});
    const bytes = enc.finish();
    // tag (field 1, wire 2) = 0x0a, length 0
    expect(Array.from(bytes)).toEqual([0x0a, 0x00]);
  });
});

describe("ProtoEncoder.repeatedMessage", () => {
  test("undefined and empty array are omitted", () => {
    const enc = new ProtoEncoder();
    enc.repeatedMessage(1, undefined, (_e, _v) => {});
    enc.repeatedMessage(1, [], (_e, _v) => {});
    expect(enc.finish().length).toBe(0);
  });

  test("multiple elements produce repeated same-field tags", () => {
    const enc = new ProtoEncoder();
    enc.repeatedMessage(2, ["a", "b", "c"], (e, v) => e.string(1, v));
    const dec = new ProtoDecoder(enc.finish());
    const fields: number[] = [];
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      fields.push(field);
      expect(wire).toBe(2);
      const inner = dec.readMessage((d) => {
        d.readTag();
        return d.readString();
      });
      // keep value to assert ordering
      void inner;
    }
    expect(fields).toEqual([2, 2, 2]);
  });
});

describe("ProtoEncoder.repeatedString", () => {
  test("undefined and empty array are omitted", () => {
    const enc = new ProtoEncoder();
    enc.repeatedString(1, undefined);
    enc.repeatedString(1, []);
    expect(enc.finish().length).toBe(0);
  });

  test("multiple elements produce repeated same-field tags preserving order", () => {
    const enc = new ProtoEncoder();
    enc.repeatedString(5, ["one", "two", "three"]);
    const dec = new ProtoDecoder(enc.finish());
    const got: string[] = [];
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      expect(field).toBe(5);
      expect(wire).toBe(2);
      got.push(dec.readString());
    }
    expect(got).toEqual(["one", "two", "three"]);
  });
});

// ─── Varint boundary values ─────────────────────────────────────────────────

describe("varint boundaries", () => {
  test("single-byte max 0x7f round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint32(1, 0x7f);
    const bytes = enc.finish();
    // tag(1,0)=0x08, value 0x7f single byte
    expect(Array.from(bytes)).toEqual([0x08, 0x7f]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    expect(dec.readVarint()).toBe(0x7fn);
  });

  test("two-byte value 0x80 round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint32(1, 0x80);
    const bytes = enc.finish();
    // 0x80 -> 0x80 0x01
    expect(Array.from(bytes)).toEqual([0x08, 0x80, 0x01]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    expect(dec.readVarint()).toBe(0x80n);
  });

  test("large 0xFFFFFFFF round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint32(1, 0xFFFFFFFF);
    const dec = new ProtoDecoder(enc.finish());
    dec.readTag();
    expect(dec.readVarint()).toBe(0xFFFFFFFFn);
  });

  test("64-bit bigint round-trips", () => {
    const enc = new ProtoEncoder();
    enc.uint64(1, 0xFFFFFFFFFFFFFFFn);
    const dec = new ProtoDecoder(enc.finish());
    dec.readTag();
    expect(dec.readVarint()).toBe(0xFFFFFFFFFFFFFFFn);
  });
});

// ─── readTag ────────────────────────────────────────────────────────────────

describe("ProtoDecoder.readTag", () => {
  test("returns correct {field, wire} for each wire type", () => {
    const bytes = Uint8Array.from([
      ...encodeTag(1, 0), // varint
      0x01,
      ...encodeTag(2, 2), // length-delimited
      0x00,
      ...encodeTag(3, 1), // fixed64
      0, 0, 0, 0, 0, 0, 0, 0,
      ...encodeTag(4, 5), // fixed32
      0, 0, 0, 0,
    ]);
    const dec = new ProtoDecoder(bytes);
    expect(dec.readTag()).toEqual({ field: 1, wire: 0 });
    dec.readVarint();
    expect(dec.readTag()).toEqual({ field: 2, wire: 2 });
    dec.readBytes();
    expect(dec.readTag()).toEqual({ field: 3, wire: 1 });
    dec.skip(1);
    expect(dec.readTag()).toEqual({ field: 4, wire: 5 });
    dec.skip(5);
    expect(dec.done).toBe(true);
  });
});

// ─── skip ───────────────────────────────────────────────────────────────────

describe("ProtoDecoder.skip", () => {
  test("wire 0 (varint) skips the varint", () => {
    const bytes = Uint8Array.from([...encodeTag(1, 0), 0xac, 0x02, ...encodeString(2, "after")]);
    const dec = new ProtoDecoder(bytes);
    const t = dec.readTag();
    dec.skip(t.wire);
    const t2 = dec.readTag();
    expect(t2.field).toBe(2);
    expect(dec.readString()).toBe("after");
  });

  test("wire 1 (fixed64) skips 8 bytes", () => {
    const bytes = Uint8Array.from([
      ...encodeFixed64(1, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...encodeString(2, "after"),
    ]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    dec.skip(1);
    const t2 = dec.readTag();
    expect(t2.field).toBe(2);
    expect(dec.readString()).toBe("after");
  });

  test("wire 2 (length-delimited) skips the payload", () => {
    const bytes = Uint8Array.from([...encodeMessage(1, [0xaa, 0xbb, 0xcc]), ...encodeString(2, "after")]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    dec.skip(2);
    const t2 = dec.readTag();
    expect(t2.field).toBe(2);
    expect(dec.readString()).toBe("after");
  });

  test("wire 5 (fixed32) skips 4 bytes", () => {
    const bytes = Uint8Array.from([
      ...encodeFixed32(1, [1, 2, 3, 4]),
      ...encodeString(2, "after"),
    ]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    dec.skip(5);
    const t2 = dec.readTag();
    expect(t2.field).toBe(2);
    expect(dec.readString()).toBe("after");
  });

  test("unknown wire type (3) throws", () => {
    // field 1, wire 3 -> tag = (1<<3)|3 = 0x0b
    const bytes = Uint8Array.from([0x0b]);
    const dec = new ProtoDecoder(bytes);
    dec.readTag();
    expect(() => dec.skip(3)).toThrow(/Unknown wire type/);
  });
});

// ─── done ───────────────────────────────────────────────────────────────────

describe("ProtoDecoder.done", () => {
  test("empty data is immediately done", () => {
    const dec = new ProtoDecoder(new Uint8Array(0));
    expect(dec.done).toBe(true);
  });

  test("done becomes true after consuming all fields", () => {
    const enc = new ProtoEncoder();
    enc.string(1, "x");
    enc.uint32(2, 9);
    const dec = new ProtoDecoder(enc.finish());
    expect(dec.done).toBe(false);
    dec.readTag();
    dec.readString();
    expect(dec.done).toBe(false);
    dec.readTag();
    dec.readVarint();
    expect(dec.done).toBe(true);
  });
});
