* **The frame overlap agrees.** A frame carries 4064 samples and keeps 32 more, which the frame after it
  mixes into its first 32 places. The independent reading mixes the last 32 samples of the frame before into
  them, and so does the reference: its walk writes the places of a frame at the **sample** of the frame's own
  place while reading the places of the frame before out of the same buffer, and the two steps of a frame —
  4096 places written, 4064 places apart — meet in exactly those 32 places. The arithmetic of `DecodeV1`
  settles it: `v6 = decoded` steps by 8128 places while a frame writes 8192 of them.