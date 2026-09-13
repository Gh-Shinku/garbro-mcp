# Giga TPF resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Nexas/ArcTPF.cs`, class `TpfOpener`
- GARBro tag: `TPF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with the ASCII signature `TPF FILE`. A signed 32-bit entry count sits at offset 0x0c, and 0x30-byte
records start at 0x10: a 0x20-byte CP932 name, a compression byte at 0x23, the payload offset at 0x24, an
intermediate size at 0x28, and the unpacked size at 0x2c.

GARbro derives each stored size from the offset word of the *following* record, so the reference reads one trailing
offset word beyond the last record; the port requires that slot to be readable and rejects the archive otherwise.
A record whose unpacked size is zero is dropped from the directory without a placement check, which the port
reproduces. Records that pass are checked against the file before being listed.

## Extraction

`TpfOpener.OpenEntry` selects the decoder from the compression byte:

| Value | Decoder |
| --- | --- |
| 0 | verbatim |
| 1 | default GARBro LZSS |
| 2 | Huffman stream followed by default LZSS |
| 3 or more | verbatim |

GARbro wraps the Huffman decoder in `HuffmanStream` and lets `LzssStream` consume it until the stream ends, without
consulting the stored intermediate size. The port bounds the Huffman decoder with the declared intermediate size when
it is non-zero — producing the same bytes for well-formed archives — and otherwise with one output byte per stored
input bit. Packed entries report the declared unpacked size and are marked as having an inexact size because the
LZSS decoder stops at the end of the stream.

GARbro's resource-catalog type inference (`FormatCatalog.Instance.Create<TpfEntry>`) is not reproduced; the
compression byte is exposed in entry metadata instead.

## Support

| Capability | Status |
| --- | --- |
| `TPF FILE` signature and entry count | Supported |
| Fixed 0x30-byte index records | Supported |
| CP932 names | Supported |
| Next-record stored size derivation | Supported |
| Zero-unpacked-size record skipping | Supported |
| Entry placement validation | Supported |
| Default LZSS extraction | Supported |
| Huffman then LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored, LZSS, Huffman+LZSS and unknown-compression entries, zero-unpacked-size skipping,
and out-of-file and foreign-signature rejection.
