# Studio Sakura DAT resource archive

GARBro reference: `ArcFormats/StudioSakura/ArcDAT.cs`, class `DatOpener` (tag `DAT/SAKURA`, MIT).

The archive has a count and 0x110-byte CP932 index records at 0x20. `.pr3` names drop their suffix; `ACMPRS03`
payloads wrap a default LZSS stream after 0x24 bytes.
