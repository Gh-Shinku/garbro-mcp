# MyAdv PAC resource archive

GARBro reference: `ArcFormats/MyAdv/ArcPAC.cs`, class `PacOpener` (tag `PAC/MyAdv`, MIT).

The archive begins with a count and a variable-size name index. Every name record declares its CP932 byte length,
unpacked buffer size, and zlib-packed size, followed by the compressed name. A fixed table of payload offset, stored
size, and unpacked size follows all names. Payloads are zlib streams and paths may be hierarchical.

Synthetic fixtures cover CP932 name decompression, path normalization, entry extraction, and name-record bounds.
Archive creation is not supported.
