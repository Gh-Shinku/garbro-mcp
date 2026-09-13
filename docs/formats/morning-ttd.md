# Morning TTD resource archive

GARBro reference: `ArcFormats/Morning/ArcTTD.cs`, class `TtdOpener` (tag `TTD`, baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

The `.FRC` header supplies a 32-bit XOR key and entry count. Its 0x2c-byte index records are XORed word-by-word and
hold a stored size, offset, and CP932 name. Entries beginning `DSFF` are LZSS streams after an eight-byte header,
with the ring initialized at `0xff0`; other entries are stored.
