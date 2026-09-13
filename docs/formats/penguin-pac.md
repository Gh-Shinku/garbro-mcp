# Penguin Works PAC resource archive

## Reference and attribution

- GARBro reference: `Legacy/PenguinWorks/ArcPAC.cs`, class `PacOpener`
- Shared payload decoder: `IkeReader` in `Legacy/UMeSoft/ArcBIN.cs`
- GARBro tag: `PAC/PENGUIN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive needs a `.pac` extension, a 32-bit record count at offset zero and twelve-byte records at offset four: a
numeric identifier, the payload offset and the stored size. Every entry must pass the placement check.

Names are derived from the archive itself rather than stored: the reference takes the file name without its extension,
upper-cases it, and appends the record's identifier as four digits. Archives whose base name is one of the engine's known
kinds also gain a fixed extension — `TAK` becomes `.bin`, `VIS` becomes `.bmp`, `EFT` becomes `.wav` and `BGM`
becomes `.str`.

Whether a payload is packed is only decided from its data: a payload that carries an `ike` marker two bytes in is
packed, its three size bytes at +10 declare the unpacked size, and its thirteen-byte header is removed from both the
offset and the stored size. The reference probes this during extraction; the port does it while parsing the index so
listing and extraction agree, and requires the stored extent to be larger than the header before treating it as packed.

## Extraction

Packed payloads are decoded with the Ike reader the U-Me Soft archives also use: a 16-bit little-endian bit window
drives flag bits that select between a literal byte and a back reference, back references come in a short two-byte form
and a long form whose distance is assembled from a chain of sign bits and whose length is coded in a ladder from three
up to a literal byte plus seventeen, and copies expand byte by byte into the output. A distance of -1 either ends the
stream or is skipped. The decoder allocates the declared size outright, so the reported size is exact. Everything else
is emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `.pac` extension requirement | Supported |
| Record count and 0x0C records | Supported |
| Archive-derived names with a four-digit identifier | Supported |
| Known content extension table | Supported |
| `ike` marker probe with a three-byte unpacked size | Supported |
| Shared Ike LZ decoding | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a `VIS` archive with bitmap names, an unknown archive kind without an extension, a packed
payload, the extension requirement, an out-of-range payload and an implausible record count.
