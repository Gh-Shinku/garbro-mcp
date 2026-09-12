# BGI/Ethornell ARC

## Reference and attribution

- GARBro reference: `ArcFormats/Ethornell/ArcBGI.cs`, classes `ArcOpener` and `Arc2Opener`
- GARBro tags: `BGI` and `BURIKO ARC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014-2015 morkt
- License: MIT

The implementations are independent TypeScript rewrites based on GARbro behavior.

## Structure

The original archive begins with `PackFile    `. Its 0x20-byte index records contain a 16-byte
CP932 filename, a data-relative offset, and a stored size. `BURIKO ARC20` uses 0x80-byte records and
expands the CP932 filename field to 0x60 bytes. Both variants place entry offsets relative to the end
of the index.

Entries beginning with `DSC FORMAT 1.00\0` use a keyed Huffman depth table followed by an MSB-first
Huffman/LZ bitstream. BURIKO ARC20 can additionally wrap image headers as BSE 1.00 or 1.01. BSE
selects and transforms each of the 64 encrypted header bytes with the version-specific key
generator, discards the 16-byte wrapper, and joins the restored header to the unchanged body.

## Support

| Capability | PackFile | BURIKO ARC20 |
| --- | --- | --- |
| Signature and structural detection | Supported | Supported |
| CP932 filenames | Supported | Supported |
| Raw entry extraction | Supported | Supported |
| DSC Huffman/LZ decompression | Supported | Supported |
| BSE 1.00/1.01 header decryption | Not applicable | Supported |
| Archive creation | Unsupported | Unsupported |

The implementations are covered by synthetic raw, DSC, and reversibly generated BSE fixtures plus
malformed-placement tests. They have not been validated against real game data, following the
current migration policy.
