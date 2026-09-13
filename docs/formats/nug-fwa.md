# NUG FWA resource archive

GARBro reference: `Legacy/Nug/ArcDAT.cs`, class `FwaOpener` (tag `DAT/FWA`, MIT).

The `1AWF` header locates variable-size 0x40-byte CP932 records. `SCWF` payloads hold a default LZSS stream after
0x20 bytes; `CCWF` payloads are exposed verbatim after the same wrapper with their size stored at +0x10.
