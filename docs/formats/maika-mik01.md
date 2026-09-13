# MAIKA MIK01 resource archive

GARBro references: `ArcFormats/Maika/ArcMIK01.cs` (`MikOpener`, tag `DAT/MIK01`) and its extraction behavior inherited
from `ArcFormats/Maika/ArcMK2.cs` (MIT).

`MIK01` and `USG01` archives store payloads sequentially from `0x10`; a fixed CP932 index elsewhere in the file gives
each name and stored size. Entries beginning with `C1`, `D1`, `E1`, or `F1` wrap a default LZSS stream after a ten-byte
header. `E1` streams reverse two prefix swaps before LZSS decoding, with a distinct 15-byte map for `USG01`.

An LZSS result beginning with `BPR01` or `BPR02` receives a second command-stream expansion using control byte 1 or 3
as the repeat command. Other results are emitted directly, and entries that fail the packed-header checks remain raw.
Synthetic fixtures cover raw and LZSS extraction, both BPR variants, both E1 maps, and index bounds. Archive creation
is not supported.
