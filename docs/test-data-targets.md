# Representative game test-data targets

This checklist is generated from GARbro's official `docs/supported.html` at commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.
GARbro describes the Titles column as tested titles, so each row uses the first listed title as a
representative acquisition target. Rows joined by HTML `rowspan` inherit the same brand and game.
This user-facing table groups implementation variants, so its row count differs from the lower-level
export inventory in `garbro-inventory.json`.

A representative game demonstrates a known sample source; it does not prove that every release,
regional edition, or encrypted variant uses the same resource format. The sole row without a
GARbro-tested title, RPG Maker RGSSAD, uses the freely available official Knight Blade sample and
labels it as an external selection rather than a GARbro-tested title.

External selection source: [RPG Maker downloads](https://www.rpgmakerweb.com/downloads).

Only use lawfully obtained game data. Keep copyrighted archives and GARbro output under
`fixtures/private/`, which is excluded from version control. Record hashes and provenance rather
than committing redistributable copies without permission.

Total format rows: **472**.

| # | Files | Signature | Brand / engine | Representative game | Sample |
| ---: | --- | --- | --- | --- | --- |
| 1 | `*.pak` | `ADPACK32` | Active Soft | Arabica | Pending |
| 2 | `*.edt` | `.TRUE` | Active Soft | Arabica | Pending |
| 3 | `*.ed8` | `.8Bit` | Active Soft | Arabica | Pending |
| 4 | `*.afs` | `AFS` | CRI | Iwaihime | Pending |
| 5 | `*.bip` | - | CRI | Iwaihime | Pending |
| 6 | `*.cpk` | `CPK` | CRI | Iwaihime | Pending |
| 7 | `*.spc` | - | CRI | Iwaihime | Pending |
| 8 | `*.xtx` | `xtx` | CRI | Iwaihime | Pending |
| 9 | `*.hca` | `HCA` | CRI | Iwaihime | Pending |
| 10 | `*.adx` | `\x80\x00` | CRI | Iwaihime | Pending |
| 11 | `data.ami` | `AMI` | - | Muv-Luv Amaterasu Translation data files | Pending |
| 12 | `*.arc` | `PackFile`<br>`BURIKO ARC20` | BGI/Ethornell | 11gatsu no Arcadia | Pending |
| 13 | - | `CompressedBG___` | BGI/Ethornell | 11gatsu no Arcadia | Pending |
| 14 | `*` | -<br>`SM2MPX10` | DRS | Anata no Osanazuma | Pending |
| 15 | `*.ggd` | `\xB9\xAA\xB3\xB3`<br>`\xAB\xAD\xAA\xBA`<br>`\xB7\xB6\xB8\xB7`<br>`\xCD\xCA\xC9\xB8` | DRS | Anata no Osanazuma | Pending |
| 16 | `*.gg1`<br>`*.gg2`<br>`*.gg3`<br>`*.gg0` | `GGA00000` | DRS | Anata no Osanazuma | Pending |
| 17 | `*.ggp` | `GGPFAIKE` | DRS | Anata no Osanazuma | Pending |
| 18 | `*.gan` | `GANM0100` | DRS | Anata no Osanazuma | Pending |
| 19 | `*.ygp` | `YGP` | DRS | Anata no Osanazuma | Pending |
| 20 | `*.vrs` | `DO` | DRS | Anata no Osanazuma | Pending |
| 21 | `*.bin` | `ACPXPK01`<br>`ACP_PK.1` | Escu:de<br>Unison Shift | Eiyuu x Maou | Pending |
| 22 | `*.gsp` | - | GSD | Asanagi no Aquanauts | Pending |
| 23 | `*.bmz` | `ZLC3` | GSD | Asanagi no Aquanauts | Pending |
| 24 | `*.int` | `KIF` | CatSystem2 | Grisaia no Kajitsu | Pending |
| 25 | `*.hg3` | `HG-3` | CatSystem2 | Grisaia no Kajitsu | Pending |
| 26 | `*.hg2` | `HG-2` | CatSystem2 | Grisaia no Kajitsu | Pending |
| 27 | `*.pak`<br>`*.dat` | `PACKDAT.` | SYSTEM-ε | Aoiro Rinne | Pending |
| 28 | `DATA.Pack` | `KCAP` | Interheart<br>Willow Soft | Itazura Mahjong | Pending |
| 29 | `*.pak` | `HyPack` | Kogado | Haken Seifuku | Pending |
| 30 | `*+*.lst` | - | Nexton LikeC | Chikan Ou ~Inkoku no Souzousha~ | Pending |
| 31 | `*.tgf` | - | Nexton LikeC | Chikan Ou ~Inkoku no Souzousha~ | Pending |
| 32 | `*.arc` | `MajiroArcV1.000`<br>`MajiroArcV2.000`<br>`MajiroArcV3.000` | Majiro | Ai Suru Tsuma, Misaki no Furin Shouko | Pending |
| 33 | `*.rct` | `\x98\x5A\x92\x9AT` | Majiro | Ai Suru Tsuma, Misaki no Furin Shouko | Pending |
| 34 | `*.rc8` | `\x98\x5A\x92\x9A8_00` | Majiro | Ai Suru Tsuma, Misaki no Furin Shouko | Pending |
| 35 | `*.dat` | `NEKOPACK` | Rosebleu<br>Lime | Inpyuri -Hito to Anata to Ayakashi to- | Pending |
| 36 | `*.dat` | - | Meteor<br>Silver Bullet | Ayase Ke no Onna ~Inka no Ketsumyaku~ | Pending |
| 37 | `*.npa` | `NPA` | Nitro+ | Axanael | Pending |
| 38 | `*.npa` | - | Nitro+ | Steins;Gate | Pending |
| 39 | `*.pak` | `\002\000\000\000`<br>`\003\000\000\000` | Nitro+<br>CoreMoreco<br>MAGI | Hanachirasu | Pending |
| 40 | `*.nsa`<br>`*.sar` | - | NScripter | Binary Pot | Pending |
| 41 | `*.pac` | `PAC` | NeXAS | Aqua Blue | Pending |
| 42 | `*.grp` | `GR3` | NeXAS | Aqua Blue | Pending |
| 43 | `*.pac` | `PAC1` | RAGE | Brightia Plus | Pending |
| 44 | `*.gcp` | `CMP1` | RAGE | Brightia Plus | Pending |
| 45 | `*.pd` | `PackOnly`<br>`PackPlus`<br>`FlyingShinePDFile` | Flying Shine | Akarui Mirai ~Wet And Messy 2nd time~ | Pending |
| 46 | `*.rpa` | `RPA-3.0` | Ren'Py | Katawa Shoujo | Pending |
| 47 | `*.arc` | - | Will | Chaste ☆ Chase! | Pending |
| 48 | `*.wip`<br>`*.msk`<br>`*.mos` | `WIPF` | Will | Chaste ☆ Chase! | Pending |
| 49 | `*.pna` | `PNAP` | Will | Chaste ☆ Chase! | Pending |
| 50 | `*.xfl` | `LB` | Liar-soft | Angel Bullet | Pending |
| 51 | `*.lwg` | `LG` | Liar-soft | Angel Bullet | Pending |
| 52 | `*.wcg` | `WGq` | Liar-soft | Angel Bullet | Pending |
| 53 | `*.lim` | `LM` | Liar-soft | Angel Bullet | Pending |
| 54 | `*.xp3` | `XP3` | KiriKiri | 11eyes | Pending |
| 55 | `*.tlg` | `TLG0.0`<br>`TLG5.0`<br>`TLG6.0` | KiriKiri | 11eyes | Pending |
| 56 | `*.ypf` | `YPF` | YU-RIS | 77 (Sevens) ~And, Two Stars Meet Again~ | Pending |
| 57 | `*.ycg` | `YCG` | YU-RIS | 77 (Sevens) ~And, Two Stars Meet Again~ | Pending |
| 58 | `*.isa` | `ISM ARCHIVED` | ISM | Green ~Akizora no Screen~ | Pending |
| 59 | `*.isg` | `ISM IMAGEFILE` | ISM | Green ~Akizora no Screen~ | Pending |
| 60 | `*.dat`<br>`*.pak`<br>`*.ads` | - | Black Rainbow | Gadget | Pending |
| 61 | `*.bmd` | `_BMD` | Black Rainbow | Gadget | Pending |
| 62 | `*.asd` | - | Black Rainbow | Gadget | Pending |
| 63 | `*.dat` | - | Studio e.go! | Men at Work 2 | Pending |
| 64 | `*.mbl` | - | Marble | Amai Seikatsu -Saikou no Gibo to Saikou no Gishimai- | Pending |
| 65 | `*.prs` | `YB` | Marble | Amai Seikatsu -Saikou no Gibo to Saikou no Gishimai- | Pending |
| 66 | `*.way` | `WADY` | Marble | Amai Seikatsu -Saikou no Gibo to Saikou no Gishimai- | Pending |
| 67 | `*.dat` | - | M no Violet<br>Snack Factory | Nanase Ren | Pending |
| 68 | `*` | `gra`<br>`mas`<br>`dif` | M no Violet<br>Snack Factory | Nanase Ren | Pending |
| 69 | `*.ald` | - | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 70 | `*.afa` | `AFAH` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 71 | `*.alk` | `ALK0` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 72 | `*.red` | `AAR` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 73 | `*.qnt` | `QNT` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 74 | `*.dcf` | `dcf` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 75 | `*.pms` | `PM` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 76 | `*.ajp` | `AJP` | Alice Soft | Boku dake no Hokenshitsu | Pending |
| 77 | `*.pd`<br>`*.pb` | - | Discovery | Hitozuma Sentai Aisaiger | Pending |
| 78 | `*.ifl` | `IFLS` | Silky's | Flutter of Birds | Pending |
| 79 | `*.grd` | `CMP_` | Silky's | Flutter of Birds | Pending |
| 80 | `*.igf` | `ZEUS` | Silky's | Flutter of Birds | Pending |
| 81 | `*.dat`<br>`*.arc` | -<br>`M2TYPE` | FFA System/G-SYS | Dokusen Kango | Pending |
| 82 | `*.pt1` | - | FFA System/G-SYS | Dokusen Kango | Pending |
| 83 | `*.wa1` | - | FFA System/G-SYS | Dokusen Kango | Pending |
| 84 | `*.wa2` | `APCM` | FFA System/G-SYS | Dokusen Kango | Pending |
| 85 | `*.pak` | `DataPack5`<br>`GsPack4` | Autobahn<br>Root<br>Clover | Aiyoku no Apron | Pending |
| 86 | `*` | `\x00\x00\x04\x00` | Autobahn<br>Root<br>Clover | Aiyoku no Apron | Pending |
| 87 | `*.war` | `WARC 1.7`<br>`WARC 1.5`<br>`WARC 1.4`<br>`WARC 1.3`<br>`WARC 1.2`<br>`WARC 1.1` | Shiina Rio | Ao no Juuai ShiinaRio v2.34 | Pending |
| 88 | `*.s25` | `S25` | Shiina Rio | Ao no Juuai ShiinaRio v2.34 | Pending |
| 89 | `*.mi4` | `MAI4` | Shiina Rio | Ao no Juuai ShiinaRio v2.34 | Pending |
| 90 | `*.ogv` | `OGV` | Shiina Rio | Ao no Juuai ShiinaRio v2.34 | Pending |
| 91 | `*.pad` | `PAD` | Shiina Rio | Ao no Juuai ShiinaRio v2.34 | Pending |
| 92 | `*` | `ARC2`<br>`ARC1` | AST | Bokura wa Piacere | Pending |
| 93 | `*.dat` | -<br>`LNK2` | Ail | Baiin Reijou ~Suouin Sakurako no Zaiwai~ | Pending |
| 94 | `*.lpk` | `LPK1` | Lucifen | Doki Doki Rooming | Pending |
| 95 | `*.elg` | `ELG` | Lucifen | Doki Doki Rooming | Pending |
| 96 | `*.arc` | `ARC\x1a`<br>`ARC` | AZ System | Amaenbou ~Mou! Ikenai Ko ne~ | Pending |
| 97 | `*.cpb` | `CPB\x1a`<br>`TYP1` | AZ System | Amaenbou ~Mou! Ikenai Ko ne~ | Pending |
| 98 | `*.mfg`<br>`*.mfm`<br>`*.mfs` | `ALPF` | Silky's | Jokei Kazoku | Pending |
| 99 | `*` | `MFG_`<br>`MFGA`<br>`MFGC` | Silky's | Jokei Kazoku | Pending |
| 100 | `*.pmp`<br>`*.pmw` | - | ScenePlayer | Eraburu ~Erabu + Love x Double de~ | Pending |
| 101 | `*.dat` | `GAMEDAT PACK`<br>`GAMEDAT PAC2` | bootUP!<br>Pajamas Soft<br>Aries | Aneimo 2 ~Second Stage~ | Pending |
| 102 | `*.epa` | `EP` | bootUP!<br>Pajamas Soft<br>Aries | Aneimo 2 ~Second Stage~ | Pending |
| 103 | `*.arc` | `MAI` | Matsuri Kikaku | Chikan Sharyou Nigousha | Pending |
| 104 | `*.ami`<br>`*.cmp` | `AM`<br>`CM` | Matsuri Kikaku | Chikan Sharyou Nigousha | Pending |
| 105 | `*.mgd`<br>`*.mgs` | `MGD`<br>`MGS` | MEGU | Drill Shoujo Spiral Nami | Pending |
| 106 | `*.agc` | `AGd` | MEGU | Drill Shoujo Spiral Nami | Pending |
| 107 | `*.pak+*.idx` | - | EAGLS | 110 ~Sanfujinka Shikeishuu Byouin Jack~ | Pending |
| 108 | `*.gr` | - | EAGLS | 110 ~Sanfujinka Shikeishuu Byouin Jack~ | Pending |
| 109 | `*.dat` | `SPack` | Goku-Fero<br>Kuro Hina | Inchuu Reiki Elenova | Pending |
| 110 | `*.fpk` | -<br>`FPK 2.00` | Candy Soft<br>Interheart | Aimai Ren'ai | Pending |
| 111 | `*.kg` | `GCGK` | Candy Soft<br>Interheart | Aimai Ren'ai | Pending |
| 112 | `*.noa`<br>`*.dat` | `Entis\x1a` | Entis GLS | Alea Akaki Tsuki o Haruka ni Nozomi | Pending |
| 113 | `*.eri`<br>`*.mio` | `Entis\x1a` | Entis GLS | Alea Akaki Tsuki o Haruka ni Nozomi | Pending |
| 114 | `*.saf` | - | Rit's | Bishoujo Ryoujoku Seminar | Pending |
| 115 | `*.arc+*.ari` | `WFL1` | KaGuYa | Bishoku | Pending |
| 116 | `*.bg_`<br>`*.cg_`<br>`*.sp_`<br>`*.prs` | `AP`<br>`AO` | KaGuYa | Bishoku | Pending |
| 117 | `*.dpk` | `DPK` | DAC | Yumemiru Tsuki no Lunalutia | Pending |
| 118 | `*.dgc` | `DGC` | DAC | Yumemiru Tsuki no Lunalutia | Pending |
| 119 | `*.pck` | - | Crowd<br>Anim | X Change R | Pending |
| 120 | `*.cwp`<br>`*.amp` | `CWDP`<br>`AMNP` | Crowd<br>Anim | X Change R | Pending |
| 121 | `*.cwd` | `cwd` | Crowd<br>Anim | X Change R | Pending |
| 122 | `*.eog` | `CRM` | Crowd<br>Anim | X Change R | Pending |
| 123 | `*.zbm`<br>`*.cwl` | `SZDD` | Crowd<br>Anim | X Change R | Pending |
| 124 | `*.gax` | `\x00\x00\x00\x01` | Crowd<br>Anim | X Change R | Pending |
| 125 | `*.pack` | `FilePackVer1.0`<br>`FilePackVer2.0`<br>`FilePackVer3.0`<br>`FilePackVer3.1` | QLIE | Amanatsu Adolesence Trial 2 | Pending |
| 126 | `*.b` | `ABMP7`<br>`abmp10`<br>`abmp11`<br>`abmp12` | QLIE | Amanatsu Adolesence Trial 2 | Pending |
| 127 | `*.png` | `DPNG` | QLIE | Amanatsu Adolesence Trial 2 | Pending |
| 128 | `*.dat` | - | Circus | Aries | Pending |
| 129 | `*.pck` | - | Circus | Aries | Pending |
| 130 | `*.crx` | `CRXG` | Circus | Aries | Pending |
| 131 | `*.crm` | `CRXB` | Circus | Aries | Pending |
| 132 | `*.pcm` | `XPCM` | Circus | Aries | Pending |
| 133 | `*.pak` | `CHERRY PACK 2.0`<br>`CHERRY PACK 3.0`<br>- | Cherry | Angel's Lesson | Pending |
| 134 | `*.lib`<br>`*.dat` | `LIB`<br>`LIBP`<br>`LIBUencrypted` | Malie | Aki Uso -The only neat thing to do- | Pending |
| 135 | `*.mgf` | `MalieGF` | Malie | Aki Uso -The only neat thing to do- | Pending |
| 136 | `*.dzi` | `DZI` | Malie | Aki Uso -The only neat thing to do- | Pending |
| 137 | `*.arc` | - | AI5WIN | Ai no Katachi ~Ecchi na Onna no Ko wa Kirai... Desu ka?~ | Pending |
| 138 | `*.gcc` | `G24n`<br>`G24m`<br>`R24n`<br>`R24m` | AI5WIN | Ai no Katachi ~Ecchi na Onna no Ko wa Kirai... Desu ka?~ | Pending |
| 139 | `*.arc` | - | RPM | Heartful Days ~Hi no Ataru Basho e~ | Pending |
| 140 | `*.iks` | `NPSR` | X[iks] | Shikkan ~Hazukashimerareta Karada, Oreta Kokoro~ | Pending |
| 141 | `*.wbp` | `ARCFORM3 WBUG`<br>`ARCFORM4 WBUG` | Wild Bug | Happy Planning | Pending |
| 142 | `*.wbm` | `WPX\x1ABMP` | Wild Bug | Happy Planning | Pending |
| 143 | `*.wpn` | `WBD\x1AWAV` | Wild Bug | Happy Planning | Pending |
| 144 | `*.wwa` | `WPX\x1AWAV` | Wild Bug | Happy Planning | Pending |
| 145 | `*.mrg` | `MRG` | F&C | Asa no Konai Yoru ni Dakarete -Eternal Night- | Pending |
| 146 | `*.mcg` | `MCG 2.00`<br>`MCG 1.01`<br>`MCG 1.00` | F&C | Asa no Konai Yoru ni Dakarete -Eternal Night- | Pending |
| 147 | `*.acd` | `ACD 1.00` | F&C | Asa no Konai Yoru ni Dakarete -Eternal Night- | Pending |
| 148 | `*.pk`<br>`*.gpk`<br>`*.tpk`<br>`*.wpk` | - | U-Me Soft | Do M Otoko Tantei ga Iku Katte ni Ittara Oshioki yo! | Pending |
| 149 | `*.grx` | `GRX\x1a`<br>`SGX\x1a` | U-Me Soft | Do M Otoko Tantei ga Iku Katte ni Ittara Oshioki yo! | Pending |
| 150 | `*.fpk` | `MFWY` | Caligula | Shinsetsu Ryouki no Ori | Pending |
| 151 | `*.gr2` | `GR2_`<br>`*Pola*` | Caligula | Shinsetsu Ryouki no Ori | Pending |
| 152 | `*.arc` | `TACTICS_ARC_FILE` | Nexton/Tactics | Gokudou no Hanayome | Pending |
| 153 | `*.sud` | - | Triangle | Kourin Tenshi En Ciel Rena | Pending |
| 154 | `*.iaf` | - | Triangle | Kourin Tenshi En Ciel Rena | Pending |
| 155 | `*.cgf` | - | Triangle | Kourin Tenshi En Ciel Rena | Pending |
| 156 | `*.bin+*.pak` | `hed` | elf | Adult Video King | Pending |
| 157 | `*.hip`<br>`*.hiz` | `hip`<br>`hiz` | elf | Adult Video King | Pending |
| 158 | `*.gpk+*.gtb`<br>`*.vpk+*.vtb` | - | System-NNN | Before Dawn Daybreak ~Shinen no Utahime~ | Pending |
| 159 | `*.dwq` | `BMP`<br>`JPEG`<br>`PNG`<br>`JPEG+MASK`<br>`PACKBMP+MASK` | System-NNN | Before Dawn Daybreak ~Shinen no Utahime~ | Pending |
| 160 | `*.vaw`<br>`*.wgq` | `IF PACKTYPE==`<br>`OGG` | System-NNN | Before Dawn Daybreak ~Shinen no Utahime~ | Pending |
| 161 | `*.aos` | - | LiLiM | Answer Dead | Pending |
| 162 | `*.abm` | `BM` | LiLiM | Answer Dead | Pending |
| 163 | `*.arc`<br>`*.xarc`<br>`*.bin` | `MIKO`<br>`KOTORI`<br>`XARC` | Xuse<br>ETERNAL | Barbaroi | Pending |
| 164 | `*.wag`<br>`*.4ag`<br>`*.004` | `WAG@`<br>`GAF4` | Xuse<br>ETERNAL | Barbaroi | Pending |
| 165 | `*.ykc` | `YKC001`<br>`YKC002` | Yuka | Aozora no Mieru Oka | Pending |
| 166 | `*.ykg` | `YKG000` | Yuka | Aozora no Mieru Oka | Pending |
| 167 | `*.pak` | `GCEX` | G2 | Aster | Pending |
| 168 | `*.arg`<br>`*.argb` | `BGRA` | G2 | Aster | Pending |
| 169 | `*.pac` | `PACK` | Emic | Chikan Densha Otoko ~Densetsu no Target~ | Pending |
| 170 | `*.bmp` | `MWP`<br>`TEYL` | Emic | Chikan Densha Otoko ~Densetsu no Target~ | Pending |
| 171 | `*.dat+*l.dat` | -<br>`GLNK` | Studio Miris<br>Caligula | Itadaki Jangarian | Pending |
| 172 | `*.bdf`<br>`*.spl` | - | Zyx | Innai Kansen series | Pending |
| 173 | `*.pak` | `PAK` | Debonosu Works | Gigai no Alruna | Pending |
| 174 | `sys4ini.bin`<br>`sys3ini.bin`<br>`*.alf` | `S4IC`<br>`S3ICS3IN` | Eushully | Himegari Dungeon Meister | Pending |
| 175 | `*.agf` | `ACGF` | Eushully | Himegari Dungeon Meister | Pending |
| 176 | `*.dxa`<br>`*.usi`<br>`*.hud`<br>`*.dat` | `DXencrypted` | DxLib | Ashita wa Kitto, Haremasu you ni | Pending |
| 177 | `*.med` | `MD` | DxLib | Ashita wa Kitto, Haremasu you ni | Pending |
| 178 | `*.tcd` | `TCD2`<br>`TCD3` | TopCat | Atori no Sora to Shinchuu no Tsuki | Pending |
| 179 | `*.spd` | `SPDC`<br>`SPD8` | TopCat | Atori no Sora to Shinchuu no Tsuki | Pending |
| 180 | `*.dat` | `CHE00`<br>`MYK00` | Cherry Soft | Blood Royal | Pending |
| 181 | `*.arc`<br>`*.awf` | - | Silky's | Shitai o Arau | Pending |
| 182 | `*.g24` | - | Silky's | Shitai o Arau | Pending |
| 183 | `*.msk` | `Rmsk` | Silky's | Shitai o Arau | Pending |
| 184 | `*.iar`<br>`*.war` | `iar`<br>`war`<br>`war2` | Studio Ryokucha | Hanikami Clover | Pending |
| 185 | `*.bsa` | `BSArc` | Bishop | Houkago ~Nureta Seifuku~ | Pending |
| 186 | `*.bsg` | `BSS-Graphics`<br>`BSS-Composition` | Bishop | Houkago ~Nureta Seifuku~ | Pending |
| 187 | `*.gsa` | `\x8C\x8EBM` | Bishop | Houkago ~Nureta Seifuku~ | Pending |
| 188 | `*` | `GPK2` | Studio Ryokucha | Princess Serenade | Pending |
| 189 | `*.gfb` | `GFB` | Studio Ryokucha | Princess Serenade | Pending |
| 190 | `*.pak` | `\x05PACK2` | Palette | Moshimo Ashita ga Harenaraba | Pending |
| 191 | `*.pga` | `PGAPGAH` | Palette | Moshimo Ashita ga Harenaraba | Pending |
| 192 | `*.chr` | `char` | Palette | Moshimo Ashita ga Harenaraba | Pending |
| 193 | `*.gyu` | `GYU\x1a` | ExHIBIT | Ane Ane Double Saimin 2 | Pending |
| 194 | `*.grp` | `AiFS` | ExHIBIT | Ane Ane Double Saimin 2 | Pending |
| 195 | `*.dat`<br>`*.cg` | - | ACTGS | Bin Can Darling | Pending |
| 196 | `*.dat` | `pack` | AnimeGameSystem | Eye's Only ~Sono Kagayaki wa Mabushisa ni Michite~ | Pending |
| 197 | `*.ani` | - | AnimeGameSystem | Eye's Only ~Sono Kagayaki wa Mabushisa ni Michite~ | Pending |
| 198 | `*.cg` | - | AnimeGameSystem | Eye's Only ~Sono Kagayaki wa Mabushisa ni Michite~ | Pending |
| 199 | `*.pcm` | `WAV` | AnimeGameSystem | Eye's Only ~Sono Kagayaki wa Mabushisa ni Michite~ | Pending |
| 200 | `*.nfs` | - | NAGS | Trouble Trap Laboratory | Pending |
| 201 | `*.ngp` | `NGP` | NAGS | Trouble Trap Laboratory | Pending |
| 202 | `*.hxp` | `Him4`<br>`Him5`<br>`SHS6`<br>`SHS7` | SH System | Natsumero | Pending |
| 203 | `*.det`<br>`+*.nme`<br>`+*.atm` | - | μ-GameOperationSystem | Ippai Shimasho | Pending |
| 204 | `*.bmp` | `Fe` | μ-GameOperationSystem | Ippai Shimasho | Pending |
| 205 | `*.gpc+*.gph`<br>`*.snd+*.snh`<br>`*.snr+*.snh` | - | Eushully | Genrin no Kishougun | Pending |
| 206 | `*.mpk` | - | propeller | Bullet Butlers | Pending |
| 207 | `*.mgr` | - | propeller | Bullet Butlers | Pending |
| 208 | `*.dat` | `PAK0` | Studio e.go! | GakuPara!! ~Gakuen Paradise!!~ | Pending |
| 209 | `*.pbx` | `Pandora.box` | Terios | Elysion ~Eien no Sanctuary~ | Pending |
| 210 | `*.bmp` | `XL24` | Terios | Elysion ~Eien no Sanctuary~ | Pending |
| 211 | `*.pk`<br>`*.dat` | - | BANANA Shu-Shu<br>Yellow Pig | Tama Tama ~Tonari no Kanojo... | Pending |
| 212 | `*.mag` | - | BANANA Shu-Shu<br>Yellow Pig | Tama Tama ~Tonari no Kanojo... | Pending |
| 213 | `*.gec` | - | BANANA Shu-Shu<br>Yellow Pig | Tama Tama ~Tonari no Kanojo... | Pending |
| 214 | `*.arc` | - | AI6WIN | Biniku no Kaori Bangai Hen | Pending |
| 215 | `*.rmt` | `RMT` | AI6WIN | Biniku no Kaori Bangai Hen | Pending |
| 216 | `*.akb` | `AKB`<br>`AKB+` | AI6WIN | Biniku no Kaori Bangai Hen | Pending |
| 217 | `*.cpz` | `CPZ1`<br>`CPZ2`<br>`CPZ5`<br>`CPZ6` | CMVS<br>CVNS | Alto | Pending |
| 218 | `*.pb2` | `PB2A` | CMVS<br>CVNS | Alto | Pending |
| 219 | `*.pb3` | `PB3B` | CMVS<br>CVNS | Alto | Pending |
| 220 | `*.msk` | `MSK0` | CMVS<br>CVNS | Alto | Pending |
| 221 | `*.mv2` | `MV2X` | CMVS<br>CVNS | Alto | Pending |
| 222 | `*.g2`<br>`*.stx` | - | GLib2 | Aniyome Dakara! | Pending |
| 223 | `*.pgx` | `PGX` | GLib2 | Aniyome Dakara! | Pending |
| 224 | `*.bin` | - | Favorite | AstralAir no Shiroki Towa | `data/favorite/se_sys.bin` (local-only) |
| 225 | `*.hzc` | `hzc1` | Favorite | AstralAir no Shiroki Towa | Pending |
| 226 | `*.bin` | `ESC-ARC1`<br>`ESC-ARC2` | Escu:de | Aristear Remain | Pending |
| 227 | `*.pac` | - | Tmr-Hiro ADV System | Dennou Shinpan Kisaragi Sanjikan | Pending |
| 228 | `*.snn+*.inx` | - | BlueGale | Bifronte ~Kugaitou Kitan~ | Pending |
| 229 | `*.zbm` | `amp_` | BlueGale | Bifronte ~Kugaitou Kitan~ | Pending |
| 230 | `*.amv` | `ampV` | BlueGale | Bifronte ~Kugaitou Kitan~ | Pending |
| 231 | `*.vfs` | `VF` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 232 | `*.iph` | `RIFF....IPH fmt` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 233 | `*.ipf` | `RIFF....IPF fmt` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 234 | `*.aog` | `AoiOgg` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 235 | `*.box` | `AOIBOX4`<br>`AOIBOX5`<br>`AOIBOX7`<br>`AOIBX10`<br>`AOIBX12`<br>`AOIMY01` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 236 | `*.agf` | `AGF` | Aoi | Alfred Gakuen Mamono Daitai | Pending |
| 237 | `*.gd+*.dll` | - | Xuse | Eien no Aselia -The Spirit of Eternity Sword- | Pending |
| 238 | `*.dat` | `DAF1`<br>`DAF2` | DenSDK | Ayakashi | Pending |
| 239 | `*.arc` | `LIN2`<br>`LINK3`<br>`LINK5`<br>`LINK6`<br>`UF01` | KaGuYa | Dokidoki Onee-san | Pending |
| 240 | `*.alp` | `AP-0`<br>`AP-2` | KaGuYa | Dokidoki Onee-san | Pending |
| 241 | `*.ap3` | `\x04APS3` | KaGuYa | Dokidoki Onee-san | Pending |
| 242 | `*.anm` | `AN00`<br>`AN10`<br>`AN20`<br>`AN21` | KaGuYa | Dokidoki Onee-san | Pending |
| 243 | `*.plt` | `PL00` | KaGuYa | Dokidoki Onee-san | Pending |
| 244 | `*.pcs` | `PCCS` | C's ware | Gakuen Ojou-sama Kitan | Pending |
| 245 | `*.bpc` | - | C's ware | Gakuen Ojou-sama Kitan | Pending |
| 246 | `*.052`<br>`*.055`<br>`*.056`<br>`*.058` | `VAFSH` | Softpal | Komorebi ni Yureru Tamashii no Koe | Pending |
| 247 | `*` | `BPIC` | Softpal | Komorebi ni Yureru Tamashii no Koe | Pending |
| 248 | `*` | `NNNN` | Moko Pro | Houmon Hanbai ~Otona no Omocha Irimasen ka?~ | Pending |
| 249 | `*.pac` | -<br>`PAC` | Unison Shift<br>Softpal | Bakunyuu Saimin Onna Kyoushi | Pending |
| 250 | `*.pgd` | `GE`<br>`PGD3` | Unison Shift<br>Softpal | Bakunyuu Saimin Onna Kyoushi | Pending |
| 251 | `*.npk` | `NPK2` | Nitro+ | Sonicomi | Pending |
| 252 | `*` | `arc` | ADVEngine | Thanatos no Koi ~In Ane Otouto Soukan~ | Pending |
| 253 | `*.gps` | `GPS` | ADVEngine | Thanatos no Koi ~In Ane Otouto Soukan~ | Pending |
| 254 | `*.szs` | `SZS100__` | SLG system | Sangoku Hime 3 | Pending |
| 255 | `*.spd+*.spl` | `SFP` | SLG system | Sangoku Hime 3 | Pending |
| 256 | `*.tig` | `\x7C\xF3\xC2\x8B` | SLG system | Sangoku Hime 3 | Pending |
| 257 | `*.alb` | `ALB1.21` | SLG system | Sangoku Hime 3 | Pending |
| 258 | `*.voi` | - | SLG system | Sangoku Hime 3 | Pending |
| 259 | `*.wag` | `IAF_` | Hexenhaus | Angenehm Platz -Kleiner Garten Sie Erstellen- | Pending |
| 260 | `*.arc` | `ARCC` | Hexenhaus | Angenehm Platz -Kleiner Garten Sie Erstellen- | Pending |
| 261 | `*.bin` | `ODIO` | Hexenhaus | Angenehm Platz -Kleiner Garten Sie Erstellen- | Pending |
| 262 | `*.eme`<br>`*.rre` | `RREDATA` | Emon Engine | Ase Nure Shoujo Misaki "Anata no Nioi de Icchau!" | Pending |
| 263 | `*.grp`<br>`*.bin` | -<br>`TPW` | Tirol<br>Talisman<br>Ankh | Aigan Shoujo | Pending |
| 264 | `*.gpc` | `Gpc7` | Super NekoX | Jorou Gumo ~Makotogatari~ | Pending |
| 265 | `*.psb` | `PSB` | E-mote | Angenehm Platz -Kleiner Garten Sie Erstellen- | Pending |
| 266 | `*.zit` | `ZT` | Silky's | Sweet ~Hanjuku na Tenshi-tachi~ | Pending |
| 267 | `*.ovk` | - | RealLive | Devote 2 Ikenai Houkago | Pending |
| 268 | `*.nwa` | - | RealLive | Devote 2 Ikenai Houkago | Pending |
| 269 | `*.koe` | `KOEPAC` | RealLive | Devote 2 Ikenai Houkago | Pending |
| 270 | `*.g00` | - | RealLive | Devote 2 Ikenai Houkago | Pending |
| 271 | `*.pdt` | `PDT10`<br>`PDT11` | RealLive | Devote 2 Ikenai Houkago | Pending |
| 272 | `*.pak`<br>`*.pac` | `ＶＣ製品版`<br>`\x01\x00\x00\x00` | Circus | Valkyrie Complex | Pending |
| 273 | `*.cps` | - | Circus | Valkyrie Complex | Pending |
| 274 | `arc*.dat`<br>`script.dat` | -<br>`ACV1` | non color<br>mirai | Doubly na Kanojo | Pending |
| 275 | `*.pak` | `PACK` | Studio Nekopunch | Colorfull!! | Pending |
| 276 | `*.syg` | `$SYG` | Risa | Chijoku Yuugi | Pending |
| 277 | `*.cmp` | `SBI` | Vitamin | Big Magnum Harimoto-sensei | Pending |
| 278 | `*.mfc` | `MFC` | Vitamin | Big Magnum Harimoto-sensei | Pending |
| 279 | `game.dat` | `vff` | LiveMaker | Aido-kan | Pending |
| 280 | `*.gal` | `Gale105`<br>`Gale106` | LiveMaker | Aido-kan | Pending |
| 281 | `*.png`<br>`*.bmp` | `EENC`<br>`EENZ` | Bruns | Majiyome | Pending |
| 282 | `*.um3` | `\xB0\x98\x98\xAC` | Bruns | Majiyome | Pending |
| 283 | `*.pbz` | `PBZ1` | PVNS | Karen | Pending |
| 284 | `*.psb` | `PSBP` | PVNS | Karen | Pending |
| 285 | `*.mk` | `MKVS` | PVNS | Karen | Pending |
| 286 | `*.pak` | - | Black Rainbow<br>Melty | Ingoku Chikan Ressha | Pending |
| 287 | `*.gxp` | `GXP` | Astronauts | Demonion 2 ~Maou to Sannin no Joou~ | Pending |
| 288 | `*.axr` | `AXRe` | GEM/vnengine | Natsunone -Ring- | Pending |
| 289 | `*.zaw` | `ZAW` | GEM/vnengine | Natsunone -Ring- | Pending |
| 290 | `*.pac` | `MGPK` | MangaGamer | Cartagra | Pending |
| 291 | `data.NN`<br>`ArcNN.dat` | - | Cyberworks | Abunai Kankei | Pending |
| 292 | `*.bin` | `OZ` | Patisserie | Matsuyoigusa | Pending |
| 293 | `*.arc` | - | KISS | xx na Kanojo no Tsukurikata | Pending |
| 294 | `*.pak` | `IPAC` | Nounai Kanojo | Chichi Ninja ~Matenrou e Chichi Bomber~ | Pending |
| 295 | `*.ies` | `IES2` | Nounai Kanojo | Chichi Ninja ~Matenrou e Chichi Bomber~ | Pending |
| 296 | `*.wst` | `WST2` | Nounai Kanojo | Chichi Ninja ~Matenrou e Chichi Bomber~ | Pending |
| 297 | `*.dat` | `DDP2`<br>`DDP3` | DDSystem | Nukiani!! Sweet Home | Pending |
| 298 | `*.arc` | `ARCX` | Studio Jaren | Denpa no Dorei | Pending |
| 299 | `*.ns2` | - | NScripter2 | Rakuin Hime Runed Princess | Pending |
| 300 | `*.dat` | - | NekoSDK | Elevator Panic ~Misshitsu no Inkou~ | Pending |
| 301 | `*.dat` | `MIK01`<br>`MK2.0`<br>`BL2.0`<br>`SL1.0`<br>`MP2.0` | MAIKA | Choukou Sentai Justice Blade 2 | Pending |
| 302 | `*.wav` | `WV5A` | MAIKA | Choukou Sentai Justice Blade 2 | Pending |
| 303 | `*.ttd` | `.FRC` | Morning | Binkan Ecchi! ~Futari no Oyatsu wa Tokunou Milk~ | Pending |
| 304 | `*.bin` | `ARC4`<br>`arc3` | Caramel BOX | Boku no Te no Naka no Rakuen | Pending |
| 305 | `*.fcb` | `fcb1` | Caramel BOX | Boku no Te no Naka no Rakuen | Pending |
| 306 | `*.dat` | `YOX` | Shelf | Kagiroi ~Shaku Kei~ | Pending |
| 307 | `*.lac` | `LAC` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 308 | `*.a` | `\x1E\xAF` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 309 | `*.am` | `am00` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 310 | `*.px` | - | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 311 | `*.g` | - | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 312 | `*.w` | - | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 313 | `*.pak` | `LAC` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 314 | `*.tex` | `TEX PACK0.02` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 315 | `*.lgf` | `lgf` | Leaf | Kimi ga Yobu, Megiddo no Oka de | Pending |
| 316 | `*.ark` | - | Irrlicht | Alter Ego | Pending |
| 317 | `*.kpc` | `SCRPACK1` | KScript | Inumimi Berserk | Pending |
| 318 | `*.kgp` | `GRPH` | KScript | Inumimi Berserk | Pending |
| 319 | `*.ksl` | `KSLM` | KScript | Inumimi Berserk | Pending |
| 320 | `*.moe` | -<br>`MMD\x1A` | Ivory | Triangle Heart 1998 release | Pending |
| 321 | `*.pak` | `pack`<br>`pac2` | ScrPlayer | Fortune Cookie | Pending |
| 322 | `*.i` | `IMG2` | ScrPlayer | Fortune Cookie | Pending |
| 323 | `*.pk` | `fPK` | Ivory | Happy Breeding | Pending |
| 324 | `*.sg` | `fSG` | Ivory | Happy Breeding | Pending |
| 325 | `*.px` | `fPX` | Ivory | Happy Breeding | Pending |
| 326 | `*.fpk` | `FPK 0100` | MoonhirGames | Bitchin Beach | Pending |
| 327 | `*.epk` | `EPK` | TamaSoft | Lost Child | Pending |
| 328 | `*.sur` | `ESUR` | TamaSoft | Lost Child | Pending |
| 329 | `*.esd` | `ESD` | TamaSoft | Lost Child | Pending |
| 330 | `*.pak` | `NEKOPACK4A` | NekoSDK | Eden's Ritter - Inetsu no Seima Kishi Lucifer Hen | Pending |
| 331 | `*.pcf` | `PackCode` | Symphony | Fortuna Rhapsody | Pending |
| 332 | `*.gbc` | `GBCF` | Symphony | Fortuna Rhapsody | Pending |
| 333 | `*.paz` | - | Musica | Haru no Ashioto | Pending |
| 334 | `arc.dat` | - | AdvSys3 | Chijoku Tsuma Natsuki | Pending |
| 335 | `*.gwd` | `GWD` | AdvSys3 | Chijoku Tsuma Natsuki | Pending |
| 336 | `*.dat` | `tskforce` | Taskforce | Musumaker | Pending |
| 337 | `*.dsk+*.pft` | - | Abogado Powers | Pigeon Blood | Pending |
| 338 | `*.kg` | `KG` | Abogado Powers | Pigeon Blood | Pending |
| 339 | `*.adp` | - | Abogado Powers | Pigeon Blood | Pending |
| 340 | `*.cab` | `PackDat3` | Entertainment<br>Executive Engine | Ryoujoku Fukushuu Gakuen ~Rinkan no Houkago~ | Pending |
| 341 | `*.dat` | - | YaneSDK | Ore-sama no RagnaRock | Pending |
| 342 | `*.rio` | - | rUGP | Age Maniax | Pending |
| 343 | `*.rip`<br>`*.s5i` | - | rUGP | Age Maniax | Pending |
| 344 | `*.rha` | - | rUGP | Age Maniax | Pending |
| 345 | `*.pak` | `PACK` | Black Rainbow | Soukan Yuugi | Pending |
| 346 | `*.odn` | - | Valkyria | Hyakushou Ryouran Konagi Ikki! | Pending |
| 347 | `*` | `FJSYS` | NSystem | Idol★Harem | Pending |
| 348 | `*.mgd` | `MGD` | NSystem | Idol★Harem | Pending |
| 349 | `*.dat+*.db` | - | IGS | Maou no Ingu | Pending |
| 350 | `*.bin` | `KAR` | Cadath | DA Pantsu!! | Pending |
| 351 | `*.kgf` | `KGF` | Cadath | DA Pantsu!! | Pending |
| 352 | `*.arc` | `DAF\x1A` | Cadath | DA Pantsu!! | Pending |
| 353 | `*.cgf` | `CGF\x1A` | Cadath | DA Pantsu!! | Pending |
| 354 | `*.pfs` | `pf2`<br>`pf6`<br>`pf8` | Artemis Engine | Boku no Elf Onee-san | Pending |
| 355 | `*.mja` | `MJA0` | Artemis Engine | Boku no Elf Onee-san | Pending |
| 356 | `*.dat` | - | Youkai Tamanokoshi | Tsumadori | Pending |
| 357 | `*.epk` | `EPK` | Ellefin Game System | Angelium -Tokimeki Love God- | Pending |
| 358 | `*.elg` | `ELG` | Ellefin Game System | Angelium -Tokimeki Love God- | Pending |
| 359 | `*.arc` | `ARC0` | Mixwill soft | Onepapa ~Onegai PaPa!~ | Pending |
| 360 | `*.pb` | `PB00` | Mixwill soft | Onepapa ~Onegai PaPa!~ | Pending |
| 361 | `*.cmp` | - | 0verflow | Imouto de Ikou! | Pending |
| 362 | `*.cgd`<br>`*.bgd`<br>`*.chr`<br>`*.crgb` | - | 0verflow | Imouto de Ikou! | Pending |
| 363 | `*.adp4` | - | 0verflow | Imouto de Ikou! | Pending |
| 364 | `*.vfs` | `VFS File` | VNSystem | Cherry Works ~Boku ga Imouto o Daita Riyuu~ | Pending |
| 365 | `*.gd` | `GD2`<br>`GD3` | C4 | Inran Byoutou 24 Ji | Pending |
| 366 | `*.vmd` | - | C4 | Inran Byoutou 24 Ji | Pending |
| 367 | `*.dpm`<br>`*.bin` | `DPMX` | Hot Soup Processor | femme fatale | Pending |
| 368 | `*.cdt`<br>`*.pdt`<br>`*.vdt`<br>`*.ovd` | `RK1` | NEJII | Kidou Houshinki | Pending |
| 369 | `*.pcd` | - | NEJII | Kidou Houshinki | Pending |
| 370 | `*.tac`<br>`*.stx` | `TArc1.10`<br>`TArc1.00` | TanukiSoft | Onii-chan Daisuki! | Pending |
| 371 | `*.arc` | `\x00ARC` | One-up | Dedenden! | Pending |
| 372 | `*.arc` | `ARC0`<br>`ARCG` | Will | Bishimai Kutsujoku no Heya | Pending |
| 373 | `*.bmx` | - | Will | Bishimai Kutsujoku no Heya | Pending |
| 374 | `*.mbf` | `MBF0`<br>`MBF1` | Will | Bishimai Kutsujoku no Heya | Pending |
| 375 | `*.vpk` | `VPK1` | Will | Bishimai Kutsujoku no Heya | Pending |
| 376 | `*.wvx*.wrc` | `WVX0` | Will | Bishimai Kutsujoku no Heya | Pending |
| 377 | `*.wsm` | `WSM1`<br>`WSM2`<br>`WSM3`<br>`WSM4` | Will | Bishimai Kutsujoku no Heya | Pending |
| 378 | `*` | `BC` | Will | Bishimai Kutsujoku no Heya | Pending |
| 379 | `*.pak` | `Graphic PackData` | cromwell | Anagan Oyako | Pending |
| 380 | `*.opk` | `VoiceOggPackFile` | cromwell | Anagan Oyako | Pending |
| 381 | `CG` | - | Software House Parsley | Jangyaku Trilogy | Pending |
| 382 | `*.fa2` | `FA2` | Foster<br>BeF | Akirame | Pending |
| 383 | `*.c24` | `C24` | Foster<br>BeF | Akirame | Pending |
| 384 | `*.c25` | `C25` | Foster<br>BeF | Akirame | Pending |
| 385 | `*.imp` | - | Black Rainbow | From M | Pending |
| 386 | `*.pak` | `CCf"` | Black Rainbow | From M | Pending |
| 387 | `*.dat` | - | Valkyria | Gedou Mahou Shoujo Rinne ~Akuin Akka~ | Pending |
| 388 | `*.mg2` | `MICOCG01` | Valkyria | Gedou Mahou Shoujo Rinne ~Akuin Akka~ | Pending |
| 389 | `*.mal` | `MICOMSK00` | Valkyria | Gedou Mahou Shoujo Rinne ~Akuin Akka~ | Pending |
| 390 | `*.pkg` | - | Yatagarasu | Obscene Guild -Katayoku no Datenshi- | Pending |
| 391 | `*` | `UnityFS` | Unity | Magic and Slash | Pending |
| 392 | `*.ogg`<br>`*.wav` | `FSB5` | Unity | Magic and Slash | Pending |
| 393 | `*.dat` | - | YaneSDK? | Hataraku Otona no Ren'ai Jijou 2 | Pending |
| 394 | `*.pac` | `ぱく` | LunaSoft | Mahou Shoujo Lyiene | Pending |
| 395 | `*.fga` | - | SFA | Maokko Crisis | Pending |
| 396 | `*.abm` | `BM` | SFA | Maokko Crisis | Pending |
| 397 | `*.alo` | - | BeF | Manatsu no Yoru no Yume | Pending |
| 398 | `*.vzy` | - | BeF | Manatsu no Yoru no Yume | Pending |
| 399 | `*.dat` | `RepiPack` | Littlewitch | Eiyu*Senki - The World Conquest | Pending |
| 400 | `arc*.dat` | - | non color | Hana Hime * Absolute! | Pending |
| 401 | `*.pck` | `PACK_FILE001` | TamamoSystem | Boukensha no Machi o Tsukurou! 2 | Pending |
| 402 | `*.rgss2a`<br>`*.rgss3a`<br>`*.rgssad` | `RGSSAD` | RPG Maker | Knight Blade -Howling of Kerberos- (official sample; not GARbro-tested) | Pending |
| 403 | `*` | `UK`<br>`PF` | for | Innocent na Tenshi-tachi | Pending |
| 404 | `*.gpc` | `GP` | for | Innocent na Tenshi-tachi | Pending |
| 405 | `*.dat` | `BLD00` | BELL-DA | She is... | Pending |
| 406 | `*.wav` | `PW10` | BELL-DA | She is... | Pending |
| 407 | `*.dpk` | `PA` | SYSD | Nakanai Neko | Pending |
| 408 | `*.dbm` | `DB` | SYSD | Nakanai Neko | Pending |
| 409 | `*.dwv` | `DW` | SYSD | Nakanai Neko | Pending |
| 410 | `*.gx`<br>`*.fx`<br>`*.vx` | `PARROT1.0` | ScooP | Success! | Pending |
| 411 | `*.rlz` | `RLZ2` | DiceSystem | Ore no Miko-san | Pending |
| 412 | `*.rbp` | `RBP1` | DiceSystem | Ore no Miko-san | Pending |
| 413 | `*.kwf` | `KWF0` | DiceSystem | Ore no Miko-san | Pending |
| 414 | `*.pak` | - | TinkerBell | Ikenai Kankei | Pending |
| 415 | `*.tb1` | `LEAF64K` | TinkerBell | Ikenai Kankei | Pending |
| 416 | `*.dat` | `CATF` | SystemAQUA | Kakuriyo no Mon | Pending |
| 417 | `*.tlz` | `TLZ1` | Otemoto | Memories Natsuiro no Kioku | Pending |
| 418 | `*.mag` | `MAKI02` | Otemoto | Memories Natsuiro no Kioku | Pending |
| 419 | `*.tpf` | `TPF FILE` | Giga | Harlem Blade II | Pending |
| 420 | `*.dat` | `CLS_FILELINK` | Lambda | Amairo Senki | Pending |
| 421 | `*` | `CLS_TEXFILE` | Lambda | Amairo Senki | Pending |
| 422 | `*.pac` | `DAI_SYSTEM_01000` | Atelier D | Nurse no Obenkyou Ouyou Hen | Pending |
| 423 | `*.pak` | `PACK` | H℃ | Yumemishi | Pending |
| 424 | `*.opf` | `OPF` | H℃ | Yumemishi | Pending |
| 425 | `*.pak` | `MD002` | ADVScripter | Pinku no Ayumi! | Pending |
| 426 | `*.caf` | `CAF0` | Raccoon<br>Tail | Faust | Pending |
| 427 | `*.cfp` | `REP`<br>`REP2` | Raccoon<br>Tail | Faust | Pending |
| 428 | `*.pak` | `vav` | FrontWing | Futago Ecchi | Pending |
| 429 | `*.dat` | `FILECMB-DATA` | DJSYSTEM | Kininaru Roommate | Pending |
| 430 | `ArchPac.dat` | - | Seraphim | 12nin no Onna Kyoushi | Pending |
| 431 | `*` | `CF`<br>`CT`<br>`CB` | Seraphim | 12nin no Onna Kyoushi | Pending |
| 432 | `*.cbf` | `CBF` | Abel | Fukakutei Sekai no Tantei Shinshi | Pending |
| 433 | `*.dat` | `FPK` | Abel | Fukakutei Sekai no Tantei Shinshi | Pending |
| 434 | `*.dat` | `ACHV` | An*tique | Kami Tama ~Kami-sama no Tamago~ | Pending |
| 435 | `*.gpd` | `GPD` | An*tique | Kami Tama ~Kami-sama no Tamago~ | Pending |
| 436 | `*.iga` | `IGA0` | Noesis | Love es M | Pending |
| 437 | `*.dat` | `MPF2` | Apricot | Skko Queen ~Kaichou no Maid-tachi~ | Pending |
| 438 | `*.pkd` | `PACK` | ADV_DX | Houkago Ryoujoku Seitokai | Pending |
| 439 | `*.p`<br>`*.mus` | `PACK` | AIMS | Tropical Liquor | Pending |
| 440 | `*.ifp` | `IAGS_IFP_01` | Winters | Kiss x 300 Konna Sekai | Pending |
| 441 | `*.dat` | `CAPYBARA DAT 001` | Winters | Kiss x 300 Konna Sekai | Pending |
| 442 | `*.dat` | `yanepkDx`<br>`yanepkEx` | YaneSDK | Auction | Pending |
| 443 | `*.sda` | `SQDARC` | YaneSDK | Auction | Pending |
| 444 | `*.yga` | `yga` | YaneSDK | Auction | Pending |
| 445 | `*.epf` | `epf` | YaneSDK | Auction | Pending |
| 446 | `*.mma` | `ARC!` | MNP | Izayoi Renka | Pending |
| 447 | `*.red` | `RE0` | Ocarina | Stay ~Anata no Tonari ni~ | Pending |
| 448 | `*.g` | `GML_ARC` | GLib | Little Monica Monogatari | Pending |
| 449 | `*.pkz` | `PKZ0` | SVIU | Fall in Love | Pending |
| 450 | `*.gbp` | `GYBP` | SVIU | Fall in Love | Pending |
| 451 | `*.jbp` | `JBP1` | SVIU | Fall in Love | Pending |
| 452 | `*.kog` | - | SVIU | Fall in Love | Pending |
| 453 | `*.pac+*.hed` | `PPAC-PAC` | Digital Works | Cafe Little Wish | Pending |
| 454 | `*.bin` | - | Digital Works | Cafe Little Wish | Pending |
| 455 | `*.tm2` | `TIM2` | Digital Works | Cafe Little Wish | Pending |
| 456 | `*.tmx` | `TX` | Digital Works | Cafe Little Wish | Pending |
| 457 | `*.pak` | `PACK` | AGSI | Can Can Bunny 6 | Pending |
| 458 | `*.til` | `TIL0` | AGSI | Can Can Bunny 6 | Pending |
| 459 | `*.wm2` | `2.0` | AGSI | Can Can Bunny 6 | Pending |
| 460 | `*.gpk` | `STKFile0PACKFILE` | Stack | Shiny Days | Pending |
| 461 | `*.pak` | `KCAP` | Leaf | Hoshi no Ouji-kun | Pending |
| 462 | `*.bjr` | `BM` | Leaf | Hoshi no Ouji-kun | Pending |
| 463 | `*.dat` | - | KID | Ever17 | Pending |
| 464 | `*.cps` | `PRT` | KID | Ever17 | Pending |
| 465 | `*.waf` | `WAF` | KID | Ever17 | Pending |
| 466 | `*.npp` | `nitP` | Nitro+ | Tenshi no Nichou Kenjuu | Pending |
| 467 | `*` | `CSAF` | D.O. | Kazoku Keikaku Re:Tsumugu Ito | Pending |
| 468 | `*.dat` | `CsPack2` | CatSystem | Yuibashi | Pending |
| 469 | `*.pck` | - | Strikes | Niizuma Kyoushi Kagurazaka Naomi | Pending |
| 470 | `*.lag` | `\x01\x10LA` | Strikes | Niizuma Kyoushi Kagurazaka Naomi | Pending |
| 471 | `*.pac` | - | ads | Injoku Hitozuma Onna Kyoushi | Pending |
| 472 | `*.060` | `POG` | ads | Injoku Hitozuma Onna Kyoushi | Pending |

## Recording acquired samples

After obtaining a target, replace `Pending` with a short private fixture identifier. Add a
differential manifest containing the detected format, entry metadata, and SHA-256 values; do not
add the original copyrighted archive to Git.
