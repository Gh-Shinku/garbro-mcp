import { FormatRegistry } from "@garbro-mcp/core";

export { formatSupportCatalog } from "./support.generated.js";

import { aaruBm2ImageFormat } from "./aaru/bm2-image.js";
import { fl2Format, fl3Format } from "./aaru/fl2.js";
import { aaruFl4Format } from "./aaru/fl4.js";
import { aaruWv1AudioFormat } from "./aaru/wv1-audio.js";
import { abelArcFormat } from "./abel/arc.js";
import { abelBinFormat } from "./abel/bin.js";
import { abelCbfImageFormat } from "./abel/cbf-image.js";
import { abelFpkFormat } from "./abel/fpk.js";
import { abelGpsImageFormat } from "./abel/gps-image.js";
import { abogadoAdpAudioFormat } from "./abogado/adp-audio.js";
import { dskFormat } from "./abogado/dsk.js";
import { abogadoPakFormat } from "./abogado/pak.js";
import { ardImageFormat } from "./acme/ard-image.js";
import { acmePmgImageFormat } from "./acme/pmg-image.js";
import { a98Format } from "./active-soft/a98.js";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { activeSoftEd8ImageFormat } from "./active-soft/ed8-image.js";
import { activeSoftEdtImageFormat } from "./active-soft/edt-image.js";
import { airFormat } from "./adobe/air.js";
import { adobePsdImageFormat } from "./adobe/psd-image.js";
import { adsPacFormat } from "./ads/pac.js";
import { pogFormat } from "./ads/pog.js";
import { adv98GpcImageFormat } from "./adv98/gpc-image.js";
import { advdxPkdFormat } from "./advdx/pkd.js";
import { advgImageFormat } from "./advgsys/bmp-image.js";
import { advizBizImageFormat } from "./adviz/biz-image.js";
import { biz2ImageFormat } from "./adviz/biz2-image.js";
import { advizGiz2ImageFormat } from "./adviz/giz2-image.js";
import { advscripterPakFormat } from "./advscripter/pak.js";
import { advSys3Format } from "./advsys/arc3.js";
import { advSysFpkFormat } from "./advsys/fpk.js";
import { advsysGr2ImageFormat } from "./advsys/gr2-image.js";
import { advSysGwdImageFormat } from "./advsys/gwd-image.js";
import { advsysPolaImageFormat } from "./advsys/pola-image.js";
import { gssImageFormat } from "./ags32i/gss-image.js";
import { agsAudioFormat } from "./ags32i/wav-audio.js";
import { ailDatFormat, lnk2Format } from "./ail/dat.js";
import { aimsPackFormat } from "./aims/pack.js";
import { airyuChrFormat } from "./airyu/chr.js";
import { akatomboFbImageFormat } from "./akatombo/fb-image.js";
import { akatomboXFormat } from "./akatombo/x.js";
import { aarFormat } from "./alicesoft/aar.js";
import { alicesoftAfaFormat } from "./alicesoft/afa.js";
import { alicesoftAjpImageFormat } from "./alicesoft/ajp-image.js";
import { aldFormat } from "./alicesoft/ald.js";
import { alkFormat } from "./alicesoft/alk.js";
import { alicesoftQntImageFormat } from "./alicesoft/qnt-image.js";
import { alphaSystemPakFormat } from "./alpha-system/pak.js";
import { sfgImageFormat } from "./alpha-system/sfg-image.js";
import { alternaBinFormat } from "./alterna/bin.js";
import { AmiFormat } from "./amaterasu/ami.js";
import { amaterasuGrpImageFormat } from "./amaterasu/grp-image.js";
import { scrScriptFormat } from "./amaterasu/scr-script.js";
import { animeGameSystemAniFormat } from "./anime-game-system/ani.js";
import { animeGameSystemCgImageFormat } from "./anime-game-system/cg-image.js";
import { animeGameSystemDatFormat } from "./anime-game-system/dat.js";
import { agsPcmAudioFormat } from "./anime-game-system/pcm-audio.js";
import { ankhDatFormat } from "./ankh/dat.js";
import { ankhGpdImageFormat } from "./ankh/gpd-image.js";
import { ankhGrpFormat } from "./ankh/grp.js";
import { iceAudioFormat } from "./ankh/ice-audio.js";
import { ankhMskImageFormat } from "./ankh/msk-image.js";
import { gr1ImageFormat } from "./anotherroom/gr1-image.js";
import { wazAudioFormat } from "./anotherroom/waz-audio.js";
import { antiqueDatFormat } from "./antique/dat.js";
import { gpdImageFormat } from "./antique/gpd-image.js";
import { aoiAgfImageFormat } from "./aoi/agf-image.js";
import { aoiAogAudioFormat } from "./aoi/aog-audio.js";
import { aoimyFormat, aoimyUnicodeFormat, boxFormat } from "./aoi/box.js";
import { vfsFormat } from "./aoi/vfs.js";
import { aosDatFormat } from "./aos/dat.js";
import { applePieArcFormat } from "./applepie/arc.js";
import { applePieGtImageFormat } from "./applepie/gt-image.js";
import { apricotDatFormat } from "./apricot/dat.js";
import { aapFormat } from "./aquarium/aap.js";
import { aquariumCp2ImageFormat } from "./aquarium/cp2-image.js";
import { cpaFormat } from "./aquarium/cpa.js";
import { arcxFormat } from "./arcx/arc.js";
import { arkCmpImageFormat } from "./ark/cmp-image.js";
import { artelMrlImageFormat } from "./artel/mrl-image.js";
import { muwAudioFormat } from "./artel/muw-audio.js";
import { pfdFormat } from "./artel/pfd.js";
import { mjaFormat } from "./artemis/mja.js";
import { iptImageFormat } from "./artemis/ipt-image.js";
import { pfsFormat } from "./artemis/pfs.js";
import { astArcFormat } from "./ast/arc.js";
import { gxpFormat } from "./astronauts/gxp.js";
import { mtgImageFormat } from "./asura/mtg-image.js";
import { asuraPakFormat } from "./asura/pak.js";
import { dlbFormat, dlbV0Format } from "./aypio/dlb.js";
import { aypioPdtBmpImageFormat } from "./aypio/pdt-bmp-image.js";
import { aypioPdtImageFormat } from "./aypio/pdt-image.js";
import { aypioPdt5ImageFormat } from "./aypio/pdt5-image.js";
import { aypioVocAudioFormat } from "./aypio/voc-audio.js";
import { azArcFormat } from "./azsys/arc-archive.js";
import { azsysCpbImageFormat } from "./azsys/cpb-image.js";
import { azEncryptedArchiveFormat } from "./azsys/encrypted-archive.js";
import { azIsaacArchiveFormat } from "./azsys/isaac-archive.js";
import { azSysTyp1ImageFormat } from "./azsys/typ1-image.js";
import { bananaGecImageFormat } from "./banana/gec-image.js";
import { bananaMagImageFormat } from "./banana/mag-image.js";
import { bananaPkFormat } from "./banana/pk.js";
import { basilBcfImageFormat } from "./basil/bcf-image.js";
import { mifFormat } from "./basil/mif.js";
import { basilNg3ImageFormat } from "./basil/ng3-image.js";
import { whcAudioFormat } from "./basil/whc-audio.js";
import { aloImageFormat } from "./bef/alo-image.js";
import { befAlpImageFormat } from "./bef/alp-image.js";
import { vzyAudioFormat } from "./bef/vzy-audio.js";
import { bellDaCpImageFormat } from "./bellda/cp-image.js";
import { bldFormat } from "./bellda/dat.js";
import { bellDaPwAudioFormat } from "./bellda/pw-audio.js";
import { bsaFormat } from "./bishop/bsa.js";
import { bishopBscFormat } from "./bishop/bsc.js";
import { bishopBsgImageFormat } from "./bishop/bsg-image.js";
import { bishopPkFormat } from "./bishop/pk.js";
import { blackButterflyDatFormat } from "./black-butterfly/dat.js";
import { gpkFormat } from "./black-cyc/gpk.js";
import { blackCycVawAudioFormat } from "./black-cyc/vaw-audio.js";
import { vpkFormat } from "./black-cyc/vpk.js";
import { blackRainbowBmdImageFormat } from "./black-rainbow/bmd-image.js";
import { bmzImageFormat } from "./black-rainbow/bmz-image.js";
import { ccfFormat } from "./black-rainbow/ccf.js";
import { blackRainbowDatFormat } from "./black-rainbow/dat.js";
import { dxFormat } from "./black-rainbow/dx.js";
import { GspFormat } from "./black-rainbow/gsp.js";
import { blackRainbowImpFormat } from "./black-rainbow/imp.js";
import { meltyPakFormat } from "./black-rainbow/melty.js";
import { spPakFormat } from "./black-rainbow/sp.js";
import { blueGaleAmvFormat } from "./blue-gale/amv.js";
import { bbmImageFormat } from "./blue-gale/bbm-image.js";
import { snnFormat } from "./blue-gale/snn.js";
import { blueGaleZbmImageFormat } from "./blue-gale/zbm-image.js";
import { cpcFormat } from "./broom/cpc.js";
import { ezsAudioFormat } from "./broom/ezs-audio.js";
import { broomEncryptedPkFormat, broomPkFormat } from "./broom/pk.js";
import { nafFormat } from "./brownie/naf.js";
import { brownieNgcImageFormat } from "./brownie/ngc-image.js";
import { ngwImageFormat } from "./brownie/ngw-image.js";
import { brownieWavAudioFormat } from "./brownie/wav-audio.js";
import { brunsEencImageFormat } from "./bruns/eenc-image.js";
import { um3AudioFormat } from "./bruns/um3-audio.js";
import { c4GdImageFormat, c4XexGdImageFormat } from "./c4/gd-image.js";
import { vmdAudioFormat } from "./c4/vmd-audio.js";
import { cadathCgfImageFormat } from "./cadath/cgf-image.js";
import { dafFormat } from "./cadath/daf.js";
import { karFormat } from "./cadath/kar.js";
import { cadathKgfImageFormat } from "./cadath/kgf-image.js";
import { cadathVwfAudioFormat } from "./cadath/vwf-audio.js";
import { caramelBoxArc3Format } from "./caramel-box/arc3.js";
import { caramelBoxArc4Format } from "./caramel-box/arc4.js";
import { caramelBoxFcbImageFormat } from "./caramel-box/fcb-image.js";
import { carriereArcFormat, carriereScenarioFormat } from "./carriere/arc.js";
import { cgdImageFormat } from "./carriere/cgd-image.js";
import { csPackFormat } from "./cat-system/cspack.js";
import { hg2Format } from "./cat-system/hg2.js";
import { catSystemHg2ImageFormat } from "./cat-system/hg2-image.js";
import { hg3Format } from "./cat-system/hg3.js";
import { catSystemHg3ImageFormat } from "./cat-system/hg3-image.js";
import { IntFormat } from "./cat-system/int.js";
import { cdpaPackFormat } from "./cdpa/pack.js";
import {
	cherryGrp3ImageFormat,
	cherryGrpEncImageFormat,
	cherryGrpImageFormat,
} from "./cherry/grp-image.js";
import { mykFormat } from "./cherry/myk.js";
import { cherryPak2Format, cherryPakFormat } from "./cherry/pak.js";
import { crmFormat } from "./circus/crm.js";
import { circusDatFormat } from "./circus/dat.js";
import { circusPckFormat } from "./circus/pck.js";
import { circusVcPacFormat, vcPakFormat } from "./circus/vc.js";
import { clickTeamMfsFormat } from "./clickteam/mf.js";
import { clioExpImageFormat } from "./clio/exp-image.js";
import { clioPacFormat } from "./clio/pac.js";
import { cpz1Format } from "./cmvs/cpz1.js";
import { cpz2Format } from "./cmvs/cpz2.js";
import { mskImageFormat } from "./cmvs/msk-image.js";
import { cmvsPb2ImageFormat } from "./cmvs/pb2-image.js";
import { mv2AudioFormat } from "./cmvs/mv2-audio.js";
import { mvAudioFormat } from "./cmvs/mv-audio.js";
import { actressDatFormat } from "./actgs/dat-archive.js";
import { willWipImageFormat } from "./will/wip-image.js";
import { clsImageFormat } from "./lambda/cls-image.js";
import { rmskImageFormat } from "./silky/rmsk-image.js";
import { czImageFormat } from "./key/cz-image.js";
import { ncgImageFormat } from "./nekotaro/ncg-image.js";
import { pmsImageFormat } from "./alicesoft/pms-image.js";
import { mgpkFormat } from "./manga-gamer/mgpk.js";
import { kgImageFormat } from "./abogado/kg-image.js";
import { graFormat, mblFormat } from "./marble/mbl-archive.js";
import { moonhirFpkFormat } from "./moonhir/fpk-archive.js";
import { lagImageFormat } from "./strikes/lag-image.js";
import { tmrHiroGrdImageFormat } from "./tmr-hiro/grd-image.js";
import { csafArchiveFormat } from "./family-adv-system/csaf-archive.js";
import { advizGiz3ImageFormat } from "./adviz/giz3-image.js";
import { cmbArchiveFormat } from "./pinesoft/cmb-archive.js";
import { mi4ImageFormat } from "./shiina-rio/mi4-image.js";
import { gpImageFormat } from "./eushully/gp-image.js";
import { gsaImageFormat } from "./bishop/gsa-image.js";
import { miaImageFormat } from "./miami/mia-image.js";
import { gbcImageFormat } from "./primel/gbc-image.js";
import { cmvsPb3ImageFormat } from "./cmvs/pb3-image.js";
import { cmvsPsbImageFormat } from "./cmvs/psb-image.js";
import { cottonClubLmgImageFormat } from "./cotton-club/lmg-image.js";
import { creativeVocAudioFormat } from "./creative/voc-audio.js";
import { criAdxAudioFormat } from "./cri/adx-audio.js";
import { AfsFormat } from "./cri/afs.js";
import { CpkFormat } from "./cri/cpk.js";
import { criGxtImageFormat } from "./cri/gxt-image.js";
import { spcFormat } from "./cri/spc.js";
import { criSpcImageFormat } from "./cri/spc-image.js";
import { criXtxImageFormat } from "./cri/xtx-image.js";
import { cromwellOpkFormat } from "./cromwell/opk.js";
import { cromwellPakFormat } from "./cromwell/pak.js";
import { crossNetAdpAudioFormat } from "./crossnet/adp-audio.js";
import { crossNetGrbImageFormat } from "./crossnet/grb-image.js";
import { crowdCwdImageFormat, crowdCwlImageFormat } from "./crowd/cwl-image.js";
import { crowdCwpImageFormat } from "./crowd/cwp-image.js";
import { eogAudioFormat } from "./crowd/eog-audio.js";
import { crowdGaxImageFormat } from "./crowd/gax-image.js";
import { crowdPckFormat, crowdPkwvFormat } from "./crowd/pck.js";
import { crowdZbmImageFormat } from "./crowd/zbm-image.js";
import { arc2Format } from "./csware/arc2.js";
import { cswareB5ImageFormat } from "./csware/b5-image.js";
import { csWareBpcImageFormat } from "./csware/bpc-image.js";
import { cswareDatFormat } from "./csware/dat.js";
import { dl1Format } from "./csware/dl1.js";
import { cswareGdtImageFormat } from "./csware/gdt-image.js";
import { pcsFormat } from "./csware/pcs.js";
import { cswareWavAudioFormat } from "./csware/wav-audio.js";
import { cyberworksAppendixFormat } from "./cyberworks/appendix.js";
import {
	cyberworksCsystemDat2Format,
	cyberworksCsystemDatFormat,
	cyberworksDatFormat,
} from "./cyberworks/dat.js";
import { daiPacFormat } from "./dai-system/pac.js";
import { dallPelFormat } from "./dall/pel.js";
import { ddp2Format, ddp3Format } from "./dd-system/ddp.js";
import { debonosuPakFormat } from "./debonosu/pak.js";
import { densdkDaf1Format, densdkDaf2Format } from "./densdk/daf.js";
import { desImageFormat } from "./desire/des-image.js";
import { dpcImageFormat } from "./desire/dpc-image.js";
import { dsvFormat } from "./desire/dsv.js";
import { kwfAudioFormat } from "./dice/kwf-audio.js";
import { rbpImageFormat } from "./dice/rbp-image.js";
import { diceRlzFormat } from "./dice/rlz.js";
import { dmFormat } from "./digital-monkey/dm.js";
import { digitalMonkeyPktImageFormat } from "./digital-monkey/pkt-image.js";
import { digitalWorksPacFormat } from "./digital-works/pac.js";
import { digitalWorksTim2ImageFormat } from "./digital-works/tim2-image.js";
import { digitalWorksTxImageFormat } from "./digital-works/tx-image.js";
import { digitalWorksBinPacFormat } from "./digitalworks/bin-pac.js";
import { directDrawDdsImageFormat } from "./directdraw/dds-image.js";
import { discoveryAn1ImageFormat } from "./discovery/an1-image.js";
import { discoveryDatFormat } from "./discovery/dat.js";
import { discoveryPr1ImageFormat } from "./discovery/pr1-image.js";
import { djDatFormat } from "./djsystem/dat.js";
import { dmotionPackFormat } from "./dmotion/pack.js";
import { dogenzakaBinFormat, dogenzakaGameDatFormat } from "./dogenzaka/bin.js";
import { dogenzakaRc4PngImageFormat } from "./dogenzaka/rc4-png-image.js";
import { medFormat } from "./dxlib/med.js";
import { eaglsGrImageFormat } from "./eagls/gr-image.js";
import { ebgSystemBinFormat } from "./ebg-system/bin.js";
import { ebisuEp1Format } from "./ebisu/ep1.js";
import { electriciteitDatFormat } from "./electriciteit/dat.js";
import { pkkFormat } from "./electriciteit/pkk.js";
import { ai5DatFormat } from "./elf/ai5dat.js";
import { ai5G24ImageFormat, ai5Msk16ImageFormat } from "./elf/g24-image.js";
import { ai5Gp8ImageFormat, ai5MskImageFormat } from "./elf/gp8-image.js";
import { hedFormat } from "./elf/hed.js";
import { ai5HipImageFormat, ai5HizImageFormat } from "./elf/hiz-image.js";
import { rmtImageFormat } from "./elf/rmt-image.js";
import { volFormat } from "./elf/vol.js";
import { ellefinEpkFormat } from "./ellefin/epk.js";
import { mwpImageFormat } from "./emic/mwp-image.js";
import { emicFormat } from "./emic/pack.js";
import { emonEmeFormat } from "./emon/eme.js";
import { cabFormat } from "./entexec/cab.js";
import { entisEriFormat } from "./entis/eri.js";
import { entisPacFormat } from "./entis/pac.js";
import { EscudeBinFormat } from "./escude/bin.js";
import { glnkFormat } from "./eternity/glnk.js";
import { mirisDatFormat } from "./eternity/miris.js";
import { eternitySgfImageFormat } from "./eternity/sgf-image.js";
import { BgiArcFormat, BurikoArcFormat } from "./ethornell/arc.js";
import { ethornellBgiImageFormat } from "./ethornell/bgi-image.js";
import { bgiAudioFormat } from "./ethornell/bw-audio.js";
import { eushullyAgfImageFormat } from "./eushully/agf-image.js";
import { eushullyAlfFormat } from "./eushully/alf.js";
import { eushullyAogAudioFormat } from "./eushully/aog-audio.js";
import { gpcFormat, sndFormat, snrFormat } from "./eushully/gpc.js";
import { eveGmFormat } from "./eve/gm.js";
import { eveWv3AudioFormat } from "./eve/wv3-audio.js";
import { exhGRPFormat } from "./ex-hibit/grp.js";
import { csfImageFormat } from "./eye/csf-image.js";
import { factorResFormat } from "./factor/res.js";
import { AcpxFormat } from "./favorite/acpx.js";
import { FavoriteBinFormat } from "./favorite/bin.js";
import { favoriteHzcImageFormat } from "./favorite/hzc-image.js";
import { hzcMultiFormat } from "./favorite/hzc-multi.js";
import { fgpImageFormat } from "./fazex/fgp-image.js";
import { fc01AcdImageFormat } from "./fc01/acd-image.js";
import { fc01BdtFormat } from "./fc01/bdt.js";
import { fc01ClmImageFormat } from "./fc01/clm-image.js";
import { mcaFormat } from "./fc01/mca.js";
import { mrgFormat } from "./fc01/mrg.js";
import { mrg0Format } from "./fc01/mrg0.js";
import { mrg2Format } from "./fc01/mrg2.js";
import { fc01PakFormat } from "./fc01/pak-agsi.js";
import { fc01TilImageFormat } from "./fc01/til-image.js";
import { wm2ImageFormat } from "./fc01/wm2-image.js";
import { wmkImageFormat } from "./fc01/wmk-image.js";
import { ffaFormat } from "./ffa/arc.js";
import { ffaDatFormat, ffaJdatFormat } from "./ffa/dat.js";
import { ffaWa1AudioFormat } from "./ffa/wa1-audio.js";
import { ffaWa2AudioFormat } from "./ffa/wa2-audio.js";
import { flyingShinePd3Format } from "./flying-shine/pd.js";
import { flyingShinePdFormat } from "./flying-shine/pd-legacy.js";
import { flyingShinePd2Format } from "./flying-shine/pd2.js";
import { forceDzpImageFormat } from "./force/dzp-image.js";
import { paqFormat } from "./force/paq.js";
import { c24Format, c25Format } from "./foster/c24.js";
import { fosterC24ImageFormat } from "./foster/c24-image.js";
import { fosterC25ImageFormat } from "./foster/c25-image.js";
import { fa2Format } from "./foster/fa2.js";
import { fgFormat } from "./frontwing/fg.js";
import {
	frontWingFweiImageFormat,
	frontWingFwgiImageFormat,
} from "./frontwing/fg-image.js";
import { frontWingFltFormat } from "./frontwing/flt.js";
import { vavFormat } from "./frontwing/vav.js";
import { bgraImageFormat } from "./g2/bgra-image.js";
import { g2ArchiveFormat } from "./g2/g2-archive.js";
import { g2PakFormat } from "./g2/pak.js";
import { g2PgxImageFormat } from "./g2/pgx-image.js";
import { hiddenJpegImageFormat } from "./gaia/jpeg-image.js";
import { gameresBmpImageFormat } from "./gameres/bmp-image.js";
import { gameresTgaImageFormat } from "./gameres/tga-image.js";
import { gameresJpegImageFormat } from "./gameres/jpeg-image.js";
import { gameresMp3AudioFormat } from "./gameres/mp3-audio.js";
import { gameresWavAudioFormat } from "./gameres/wav-audio.js";
import { gameSystemAdp4AudioFormat } from "./gamesystem/adp4-audio.js";
import { gamesystemAlpImageFormat } from "./gamesystem/alp-image.js";
import { gameSystemBgdImageFormat } from "./gamesystem/bgd-image.js";
import { gameSystemCgdImageFormat } from "./gamesystem/cgd-image.js";
import { gameSystemChrFormat } from "./gamesystem/chr.js";
import { gameSystemChrImageFormat } from "./gamesystem/chr-image.js";
import { gamesystemCmpFormat } from "./gamesystem/cmp.js";
import { gamesystemDatFormat } from "./gamesystem/dat.js";
import { gamesystemPuremailFormat } from "./gamesystem/puremail.js";
import { texbImageFormat } from "./gamesystem/texb-image.js";
import { gigaTpfFormat } from "./giga/tpf.js";
import { glibGFormat } from "./glib/g.js";
import { gpk2GfbImageFormat } from "./gpk2/gfb-image.js";
import { gpk2Format } from "./gpk2/gpk2.js";
import { grocerPicImageFormat } from "./grocer/pic-image.js";
import { grooverPcgFormat } from "./groover/pcg.js";
import { gsDataFormat, gsPackFormat } from "./gs-pack/archive.js";
import { gsPackPicImageFormat } from "./gs-pack/pic-image.js";
import { gscripterDataFormat } from "./gscripter/data.js";
import { gssLsdFormat } from "./gss/lsd.js";
import { gsxK2ImageFormat } from "./gsx/k2-image.js";
import { k3Format } from "./gsx/k3.js";
import { gsxK4ImageFormat } from "./gsx/k4-image.js";
import { k5Format } from "./gsx/k5.js";
import { opfImageFormat } from "./hcsystem/opf-image.js";
import { hcsystemPakFormat } from "./hcsystem/pak.js";
import { hotFormat } from "./hdl/hot.js";
import { hotImageFormat } from "./hdl/hot-image.js";
import { grpImageFormat } from "./herb/grp-image.js";
import { herbPakFormat } from "./herb/pak.js";
import { arccFormat } from "./hexenhaus/arcc.js";
import { hexenhausImgdImageFormat } from "./hexenhaus/imgd-image.js";
import { odioFormat } from "./hexenhaus/odio.js";
import { wagFormat } from "./hexenhaus/wag.js";
import { imaImageFormat } from "./hillfield/ima-image.js";
import { hillFieldImgImageFormat } from "./hillfield/img-image.js";
import { cbfImageFormat } from "./hmp/cbf-image.js";
import { mbpImageFormat } from "./hmp/mbp-image.js";
import { dpmFormat } from "./hsp/dpm.js";
import { hypatiaAdpAudioFormat } from "./hypatia/adp-audio.js";
import { HyPackFormat } from "./hypatia/hypack.js";
import { lpgImageFormat } from "./hypatia/lpg-image.js";
import { lpkFormat } from "./hypatia/lpk.js";
import { hypatiaLsgImageFormat } from "./hypatia/lsg-image.js";
import { wbmImageFormat } from "./hypatia/wbm-image.js";
import { hyperworksPakFormat } from "./hyperworks/pak.js";
import { ibmImageFormat } from "./ice/ibm-image.js";
import { isdScriptFormat } from "./ice/isd-script.js";
import { ikuraDoImageFormat } from "./ikura/do-image.js";
import { DrsFormat } from "./ikura/drs.js";
import { ganFormat } from "./ikura/gan.js";
import { ggaImageFormat } from "./ikura/gga-image.js";
import { ikuraGgpImageFormat } from "./ikura/ggp-image.js";
import { ikuraGgsImageFormat } from "./ikura/ggs-image.js";
import { MpxFormat } from "./ikura/mpx.js";
import { tanFormat } from "./ikura/tan.js";
import { ikuraTanImageFormat } from "./ikura/tan-image.js";
import { ikuraYgpImageFormat } from "./ikura/ygp-image.js";
import { idaFormat } from "./inspire/ida.js";
import { interheartBmpRleImageFormat } from "./interheart/bmp-rle-image.js";
import { interheartEpfImageFormat } from "./interheart/epf-image.js";
import { fpkFormat } from "./interheart/fpk.js";
import { fpk2Format } from "./interheart/fpk2.js";
import { interheartHmpImageFormat } from "./interheart/hmp-image.js";
import { interheartKgImageFormat } from "./interheart/kg-image.js";
import { ipacIesImageFormat, ipacIesRawImageFormat } from "./ipac/ies-image.js";
import { ipacFormat } from "./ipac/pak.js";
import { wstAudioFormat } from "./ipac/wst-audio.js";
import { irisFpackFormat } from "./iris/fpack.js";
import { irrlichtArkFormat } from "./irrlicht/ark.js";
import { irrlichtPackFormat } from "./irrlicht/pack.js";
import { isaFormat } from "./ism/isa.js";
import { ismIsgImageFormat } from "./ism/isg-image.js";
import { ivoryMmdImageFormat } from "./ivory/mmd-image.js";
import { ivoryMoeImageFormat } from "./ivory/moe-image.js";
import { ivoryPkFormat } from "./ivory/pk.js";
import { ivoryPxFormat } from "./ivory/px.js";
import { ivoryPxAudioFormat } from "./ivory/px-audio.js";
import { ivorySgFormat } from "./ivory/sg.js";
import { jamDatFormat } from "./jam-creation/dat.js";
import { jamCreationDpoImageFormat } from "./jam-creation/dpo-image.js";
import { htfImageFormat } from "./jam-creation/htf-image.js";
import { jamesJmgImageFormat } from "./james/jmg-image.js";
import { lb5Format } from "./jupiter/lb5.js";
import { kaasAudioFormat } from "./kaas/kaas-audio.js";
import { kaasPbFormat } from "./kaas/pb.js";
import { kaasPdFormat } from "./kaas/pd.js";
import { kaguyaAn21Format } from "./kaguya/an21.js";
import { an10Format, an20Format, anmFormat } from "./kaguya/anm.js";
import { aoImageFormat } from "./kaguya/ao-image.js";
import { apImageFormat } from "./kaguya/ap-image.js";
import { ap0ImageFormat } from "./kaguya/ap0-image.js";
import { ap2ImageFormat } from "./kaguya/ap2-image.js";
import { ap3ImageFormat } from "./kaguya/ap3-image.js";
import { apsImageFormat } from "./kaguya/aps-image.js";
import { aps3ImageFormat } from "./kaguya/aps3-image.js";
import { kaguyaAriFormat } from "./kaguya/ari.js";
import { kaguyaLin2Format } from "./kaguya/lin2.js";
import { kaguyaPl10Format } from "./kaguya/pl10.js";
import { kaguyaPltFormat } from "./kaguya/plt.js";
import { kaguyaUfFormat } from "./kaguya/uf.js";
import { asdKToolFormat, asdSpielFormat } from "./kapp/asd.js";
import { cgdFormat } from "./kapp/cgd.js";
import { cgdKToolImageFormat, cgdSpielImageFormat } from "./kapp/cgd-image.js";
import { kasaneAr2Format } from "./kasane/ar2.js";
import { keroqCbmImageFormat } from "./keroq/cbm-image.js";
import { keroqDatFormat } from "./keroq/dat.js";
import { keroqKgdImageFormat } from "./keroq/kgd-image.js";
import { keroqKgd1ImageFormat } from "./keroq/kgd1-image.js";
import { keyOggpakAudioFormat } from "./key/oggpak-audio.js";
import { keyPakFormat } from "./key/pak.js";
import { kidLnkFormat } from "./kid/lnk.js";
import { kidPrtImageFormat } from "./kid/prt-image.js";
import { wafAudioFormat } from "./kid/waf-audio.js";
import { kirikiriTlgImageFormat } from "./kirikiri/tlg-image.js";
import { xpkFormat } from "./kirikiri/xpk.js";
import { kissArcFormat } from "./kiss/arc.js";
import { koeiYkFormat } from "./koei/yk-archive.js";
import { kogadoArcFormat } from "./kogado/arc.js";
import { kgpImageFormat } from "./kscript/kgp-image.js";
import { kpcFormat } from "./kscript/kpc.js";
import { kslImageFormat } from "./kscript/ksl-image.js";
import { kurumiGraImageFormat } from "./kurumi/gra-image.js";
import { kurumiGraLegacyImageFormat } from "./kurumi/gra-legacy-image.js";
import { kurumiMpkFormat } from "./kurumi/mpk.js";
import { clsFormat } from "./lambda/cls.js";
import { laxFormat } from "./lambda/lax.js";
import { lazycrewDatFormat } from "./lazycrew/dat.js";
import { leafAFormat } from "./leaf/a.js";
import { leafAmFormat } from "./leaf/am.js";
import { leafAr2Format } from "./leaf/ar2.js";
import { leafBjrImageFormat } from "./leaf/bjr-image.js";
import { leafGAudioFormat } from "./leaf/g-audio.js";
import { leafKcapFormat } from "./leaf/kcap.js";
import { leafLacFormat, leafLacPakFormat } from "./leaf/lac.js";
import { leafLfgImageFormat } from "./leaf/lfg-image.js";
import { lgfImageFormat } from "./leaf/lgf-image.js";
import { leafP16AudioFormat } from "./leaf/p16-audio.js";
import { leafPakFormat } from "./leaf/pak.js";
import { leafPxFormat } from "./leaf/px.js";
import { leafPxImageFormat } from "./leaf/px-image.js";
import { leafTexFormat } from "./leaf/tex.js";
import { leafWAudioFormat } from "./leaf/w-audio.js";
import { gscFormat } from "./liar/gsc.js";
import { lwgFormat } from "./liar/lwg.js";
import { xflFormat } from "./liar/xfl.js";
import { libidoArcFormat } from "./libido/arc.js";
import { liddellBpaImageFormat } from "./liddell/bpa-image.js";
import { flkFormat } from "./liddell/flk.js";
import { abmFormat } from "./lilim/abm.js";
import { abmImageFormat } from "./lilim/abm-image.js";
import { aosFormat } from "./lilim/aos.js";
import { aos2Format } from "./lilim/aos2.js";
import { fgaFormat } from "./lilim/fga.js";
import { imgBmpImageFormat } from "./lilim/img-bmp-image.js";
import { imgPngImageFormat } from "./lilim/img-png-image.js";
import { livemakerVfFormat } from "./livemaker/vf.js";
import { loggArfFormat } from "./logg/arf.js";
import { frmImageFormat } from "./logg/frm-image.js";
import { lucifenLpkFormat } from "./lucifen/lpk.js";
import { lunaPacFormat } from "./luna-soft/pac.js";
import { lunePackFormat } from "./lune/pack.js";
import { edimAudioFormat } from "./macromedia/edim-audio.js";
import { macromediaSndAudioFormat } from "./macromedia/snd-audio.js";
import { maiFormat } from "./mai/arc.js";
import { maikaBkFormat } from "./maika/bk.js";
import { maikaMik01Format } from "./maika/mik01.js";
import { maikaMk2Format } from "./maika/mk2.js";
import { maikaWv5AudioFormat } from "./maika/wv5-audio.js";
import { MajiroArcFormat } from "./majiro/arc.js";
import { majiroRc8ImageFormat } from "./majiro/rc8-image.js";
import { malieLibFormat } from "./malie/lib.js";
import { malieLibuFormat } from "./malie/libu.js";
import { mgfImageFormat } from "./malie/mgf-image.js";
import { mgpk0Format } from "./manga-gamer/mgpk0.js";
import { animFormat } from "./marble/anim.js";
import { dnsFormat } from "./marble/dns.js";
import { marblePrsImageFormat } from "./marble/prs-image.js";
import { marbleWadyAudioFormat } from "./marble/way-audio.js";
import { marbleYpImageFormat } from "./marble/yp-image.js";
import { cpnFormat } from "./marron/cpn.js";
import { masysAgImageFormat } from "./masys/ag-image.js";
import { masysAlpImageFormat } from "./masys/alp-image.js";
import { mgdFormat } from "./masys/mgd.js";
import { mgsFormat } from "./masys/mgs-archive.js";
import { mayBeSoftHhpImageFormat } from "./maybesoft/hhp-image.js";
import { mbImageFormat } from "./mb/image.js";
import { mebiusKoeAudioFormat } from "./mebius/koe-audio.js";
import { mebiusMcgImageFormat } from "./mebius/mcg-image.js";
import { melodyMgoImageFormat } from "./melody/mgo-image.js";
import { ttdFormat } from "./melonpan/ttd.js";
import { mermaidGp1ImageFormat } from "./mermaid/gp1-image.js";
import { mermaidMg1ImageFormat } from "./mermaid/mg1-image.js";
import { mermaidPwvAudioFormat } from "./mermaid/pwv-audio.js";
import { shaFormat } from "./mg/sha.js";
import { neFormat } from "./microsoft/ne-archive.js";
import { microVisionArcFormat } from "./microvision/arc.js";
import { gsdFormat } from "./microvision/gsd.js";
import { gtxImageFormat } from "./microvision/gtx-image.js";
import { ikmAudioFormat } from "./microvision/ikm-audio.js";
import { mdImageFormat } from "./mina/md-image.js";
import { ml2Format } from "./mina/ml2.js";
import {
	minaBmpPakFormat,
	minaScriptPakFormat,
	minaWavPakFormat,
} from "./mina/pak.js";
import { minkDatImageFormat } from "./mink/dat-image.js";
import { fcImageFormat } from "./mink/fc-image.js";
import { gdfImageFormat } from "./mink/gdf-image.js";
import { minkGrpFormat } from "./mink/grp.js";
import { miscBinFormat } from "./misc/bin.js";
import { lzBmpImageFormat } from "./misc/lz-bmp-image.js";
import { miscLzsImageFormat } from "./misc/lzs-image.js";
import { picImageFormat } from "./misc/pic-image.js";
import { pnxEncryptedImageFormat } from "./misc/pnx-image.js";
import { ptiImageFormat } from "./misc/pti-image.js";
import { arc0Format } from "./mixwill/arc0.js";
import { mixwillPb00ImageFormat } from "./mixwill/pb00-image.js";
import { sdaFormat } from "./mmfass/sda.js";
import { mngFormat } from "./mng/mng.js";
import { mngImageFormat } from "./mng/mng-image.js";
import { mnvFormat } from "./mno-violet/dat.js";
import { mnoVioletGraImageFormat } from "./mnoviolet/gra-image.js";
import { mmaFormat } from "./mnp/mma.js";
import { mokoProBmpImageFormat } from "./moko-pro/bmp-image.js";
import { mokoProNnnnFormat } from "./moko-pro/nnnn.js";
import { mokoProOggAudioFormat } from "./moko-pro/ogg-audio.js";
import { morningTtdFormat } from "./morning/ttd.js";
import { mugiBinFormat } from "./mugi/bin.js";
import { museDatFormat } from "./muse/dat.js";
import { aniFormat } from "./musica/ani.js";
import { sqzFormat } from "./musica/sqz.js";
import { dpfFormat } from "./mutation/dpf.js";
import { rbmImageFormat } from "./mutation/rbm-image.js";
import { myAdvPacFormat } from "./myadv/pac.js";
import { harvestBgmAudioFormat } from "./myharvest/bgm-audio.js";
import { unaDatFormat } from "./myharvest/dat.js";
import { sedAudioFormat } from "./myharvest/sed-audio.js";
import { unhImageFormat } from "./myharvest/unh-image.js";
import { fjsysFormat } from "./n-system/fjsys.js";
import { ypfImageFormat } from "./nabe/ypf-image.js";
import { nfsFormat } from "./nags/nfs.js";
import { nagsNgpImageFormat } from "./nags/ngp-image.js";
import { nejiiCdtFormat } from "./nejii/cdt.js";
import { pcdFormat } from "./nejii/pcd.js";
import { NekoPack1Format } from "./nekopack/v1.js";
import { NekoPack2Format } from "./nekopack/v2.js";
import { NekoPack3Format } from "./nekopack/v3.js";
import { nekopunchPakFormat } from "./nekopunch/pak.js";
import { pbmImageFormat } from "./nekopunch/pbm-image.js";
import { nekosdkDatFormat } from "./nekosdk/dat.js";
import { nekoSdkPakFormat } from "./nekosdk/pak.js";
import { nscFormat } from "./nekotaro/nsc.js";
import { neonAr2Format } from "./neon/ar2.js";
import { nexasGrpImageFormat } from "./nexas/grp-image.js";
import { nexasPacFormat } from "./nexas/pac.js";
import { LstFormat } from "./nexton/lst.js";
import { mpkFormat } from "./nitroplus/mpk.js";
import { nitroplusNitroPakFormat } from "./nitroplus/nitro-pak.js";
import { nitroplusNpaSteinsGateFormat } from "./nitroplus/npa-sg.js";
import { nppFormat } from "./nitroplus/npp.js";
import { nitroplusPakFormat } from "./nitroplus/pak.js";
import { igaFormat } from "./noesis/iga.js";
import { nononoNpfFormat } from "./nonono/npf.js";
import { ns2ArchiveFormat } from "./nscripter/ns2-archive.js";
import { nscripterSarFormat } from "./nscripter/sar.js";
import { nsOpenerFormat } from "./nscripter/script.js";
import { nsystemMgdImageFormat } from "./nsystem/mgd-image.js";
import { fwaFormat } from "./nug/fwa.js";
import { zlkFormat } from "./nyoken/zlk.js";
import { redImageFormat } from "./ocarina/red-image.js";
import { oggAudioFormat } from "./ogg/ogg-audio.js";
import { omiDatFormat } from "./omi/dat.js";
import { oneUpArcFormat } from "./oneup/arc.js";
import { originHedDatFormat } from "./origin/dat-hed.js";
import { gafFormat } from "./origin/gaf.js";
import { otemotoMagImageFormat } from "./otemoto/mag-image.js";
import { tlzFormat } from "./otemoto/tlz.js";
import { pajamasEpaImageFormat } from "./pajamas/epa-image.js";
import { gameDatFormat } from "./pajamas/gamedat.js";
import { paletteChrFormat } from "./palette/chr.js";
import { palettePakFormat } from "./palette/pak.js";
import { pak2Format } from "./palette/pak2.js";
import { pgaImageFormat } from "./palette/pga-image.js";
import { arFormat } from "./palm-tree/ar.js";
import { nsfAudioFormat } from "./pan/nsf-audio.js";
import { panFormat } from "./pan/pan.js";
import { tblImageFormat } from "./pan/tbl-image.js";
import { pandoraPbxFormat } from "./pandora/pbx.js";
import { pandoraXl24ImageFormat } from "./pandora/xl24-image.js";
import { pkDatFormat } from "./paprika/pkdat.js";
import { parsleyCgV1Format, parsleyYanepackFormat } from "./parsley/cg.js";
import { cgV2Format } from "./parsley/cg2.js";
import { parsleyDesertCgFormat } from "./parsley/cg3.js";
import { parsleyPacFormat } from "./parsley/pac.js";
import { pcgImageFormat } from "./parsley/pcg-image.js";
import { parsleyScnFormat } from "./parsley/scn.js";
import { ucgFormat } from "./parsley/ucg.js";
import { ozFormat } from "./patisserie/bin.js";
import { patisserieRawFormat } from "./patisserie/raw.js";
import { aryFormat } from "./pearl/ary.js";
import { penguinPacFormat } from "./penguin/pac.js";
import { piasDatFormat } from "./pias/dat.js";
import { piasEncryptedFormat } from "./pias/encrypted-graph.js";
import { bpdImageFormat } from "./pinesoft/bpd-image.js";
import { cmbAudioFormat } from "./pinesoft/cmb-audio.js";
import { pinesoftVoiceFormat } from "./pinesoft/voice.js";
import { pinkyA5rFormat } from "./pinky/a5r.js";
import { pinpaiArcxFormat } from "./pinpai/arcx.js";
import { pisckissAudioFormat } from "./pisckiss/audio.js";
import { bm1ImageFormat } from "./pisckiss/bm1-image.js";
import { zipFormat } from "./pkware/zip.js";
import { plantechPacFormat } from "./plantech/pac.js";
import { plantechPacImageFormat } from "./plantech/pac-image.js";
import { pochetteGdtImageFormat } from "./pochette/gdt-image.js";
import { pochettePacFormat } from "./pochette/pac.js";
import { ponytailBndFormat } from "./ponytail/bnd.js";
import { ponytailTczImageFormat } from "./ponytail/tcz-image.js";
import { ponytailTszImageFormat } from "./ponytail/tsz-image.js";
import { powerdNclImageFormat } from "./powerd/ncl-image.js";
import { thpImageFormat } from "./primesoft/thp-image.js";
import { projectMyuGamImageFormat } from "./project-myu/gam-image.js";
import { kgrImageFormat } from "./project-myu/kgr-image.js";
import { propellerMgrFormat } from "./propeller/mgr.js";
import { propellerMgrImageFormat } from "./propeller/mgr-image.js";
import { propellerMpkFormat } from "./propeller/mpk.js";
import { psmImageFormat } from "./psm/image.js";
import { pspQpkFormat } from "./psp/qpk.js";
import { abmp7Format, abmpFormat } from "./q-lie/abmp.js";
import { qlieAbmpImageFormat } from "./qlie/abmp-image.js";
import { qsoftBpeImageFormat } from "./qsoft/bpe-image.js";
import { rainBinFormat } from "./rain/bin.js";
import { bcdFormat } from "./ransel/bcd.js";
import { rareXFormat } from "./rare/x.js";
import { realliveG00Format } from "./reallive/g00.js";
import { realliveG00ImageFormat } from "./reallive/g00-image.js";
import { g00JpegImageFormat } from "./reallive/g00-jpeg-image.js";
import { realliveKoeFormat } from "./reallive/koe.js";
import {
	createRealliveNwaAudioFormat,
	realliveNwaAudioFormat,
} from "./reallive/nwa-audio.js";
import { ovkFormat } from "./reallive/ovk.js";
import { realliveOwpAudioFormat } from "./reallive/owp-audio.js";
import { reallivePdtImageFormat } from "./reallive/pdt-image.js";
import { seenFormat } from "./reallive/seen.js";
import { redzonePakFormat } from "./redzone/pak.js";
import { qdoScriptFormat } from "./redzone/qdo-script.js";
import { brgImageFormat } from "./regrips/brg-image.js";
import { regripsMrgAudioFormat } from "./regrips/mrg-audio.js";
import { prgImageFormat } from "./regrips/prg-image.js";
import { wrgAudioFormat } from "./regrips/wrg-audio.js";
import { renpyRpaFormat } from "./renpy/rpa.js";
import { crgFormat } from "./rhss/crg.js";
import { riddleGcpImageFormat } from "./riddle/gcp-image.js";
import { riddlePacFormat } from "./riddle/pac.js";
import { rinaRadImageFormat } from "./rina/rad-image.js";
import { risaSygImageFormat } from "./risa/syg-image.js";
import { hbmImageFormat } from "./rits/hbm-image.js";
import { ritsSafFormat } from "./rits/saf.js";
import { rpgMakerRgssAdFormat } from "./rpg-maker/rgss-ad.js";
import { rpgMakerRpgmvoAudioFormat } from "./rpg-maker/rpgmvo-audio.js";
import { rpgMakerRpgmvpImageFormat } from "./rpg-maker/rpgmvp-image.js";
import { rpmArcFormat } from "./rpm/arc.js";
import { rpmZenosFormat } from "./rpm/zenos.js";
import { radFormat } from "./rsystem/rad.js";
import { rsystemRsgImageFormat } from "./rsystem/rsg-image.js";
import { rugpRhaAudioFormat } from "./rugp/rha-audio.js";
import { ykFormat } from "./rune/yk.js";
import {
	saikiBmxImageFormat,
	saikiJpxImageFormat,
} from "./saiki/obfuscated-image.js";
import { sakanaglSxArchiveFormat } from "./sakanagl/sx-archive.js";
import { sas5IarFormat } from "./sas5/iar.js";
import { sas5IarImageFormat } from "./sas5/iar-image.js";
import { sas5Sec5Format } from "./sas5/sec5.js";
import { sas5War2Format, sas5WarFormat } from "./sas5/war.js";
import { pmaFormat } from "./sceneplayer/pma.js";
import { pmpImageFormat } from "./sceneplayer/pmp-image.js";
import { pmwAudioFormat } from "./sceneplayer/pmw-audio.js";
import { pmxFormat } from "./sceneplayer/pmx.js";
import {
	sceplayG24aImageFormat,
	sceplayG2408ImageFormat,
} from "./sceplay/g24-image.js";
import { sceplayPakFormat } from "./sceplay/pak.js";
import { gxFormat } from "./scoop/gx.js";
import { scoopScpImageFormat } from "./scoop/scp-image.js";
import { scrPlayerPakFormat } from "./scrplayer/pak.js";
import { KcapFormat } from "./selene/kcap.js";
import { cp3Format } from "./seraphim/cp3.js";
import { cp3ImageFormat } from "./seraphim/cp3-image.js";
import { archangelDatFormat } from "./seraphim/dat.js";
import { seraphimMcFormat } from "./seraphim/mc.js";
import { seraphimScn95Format, seraphimScnFormat } from "./seraphim/scnpac.js";
import {
	seraphimCbImageFormat,
	seraphimCfImageFormat,
	seraphimCtImageFormat,
	seraphimCxImageFormat,
} from "./seraphim/seraph-image.js";
import { voiceFormat } from "./seraphim/voice.js";
import { shapeShifterBndFormat } from "./shapeshifter/bnd.js";
import { shiinaRioChdImageFormat } from "./shiina-rio/chd-image.js";
import { ogvAudioFormat } from "./shiina-rio/ogv-audio.js";
import { shiinaRioPadAudioFormat } from "./shiina-rio/pad-audio.js";
import { s25Format } from "./shiina-rio/s25.js";
import { shiinaRioWarcFormat } from "./shiina-rio/warc.js";
import { him4Format, him5Format } from "./shsystem/hxp.js";
import { ai6WinFormat } from "./silky/ai6win.js";
import { silkyAkbImageFormat } from "./silky/akb-image.js";
import { silkyArcFormat } from "./silky/arc.js";
import { awfFormat } from "./silky/awf.js";
import { azuriteFormat } from "./silky/azurite.js";
import { grdImageFormat } from "./silky/grd-image.js";
import { iflFormat } from "./silky/ifl.js";
import { silkyIgfImageFormat } from "./silky/igf-image.js";
import { silkyMfgFormat } from "./silky/mfg.js";
import { silkyMfgImageFormat } from "./silky/mfg-image.js";
import { vsdFormat } from "./silky/vsd.js";
import { silkyZitImageFormat } from "./silky/zit-image.js";
import { slgAlbImageFormat } from "./slg/alb-image.js";
import { spdFormat } from "./slg/spd.js";
import { szsFormat } from "./slg/szs.js";
import { slgTicImageFormat } from "./slg/tic-image.js";
import { slgTigImageFormat } from "./slg/tig-image.js";
import { timImageFormat } from "./slg/tim-image.js";
import { voiAudioFormat } from "./slg/voi-audio.js";
import { softpalBgmAudioFormat } from "./softpal/bgm-audio.js";
import { bpicImageFormat } from "./softpal/bpic-image.js";
import { amusePacFormat, softpalPacFormat } from "./softpal/pac.js";
import { vafsFormat } from "./softpal/vafs.js";
import { sognaDatFormat } from "./sogna/dat.js";
import {
	sohfuDtlcImageFormat,
	sohfuDtlImageFormat,
} from "./sohfu/dtl-image.js";
import { sohfuSkaFormat } from "./sohfu/ska.js";
import { sophiaNorFormat } from "./sophia/nor.js";
import { spackFormat } from "./spack/dat.js";
import { speedArcFormat } from "./speed/arc.js";
import { flkDatFormat } from "./splush-wave/flk.js";
import { splushWaveSwgImageFormat } from "./splush-wave/swg-image.js";
import { plaFormat } from "./squadrad/pla.js";
import { sdaSdFormat } from "./squadrad/sda.js";
import { strikesPckFormat } from "./strikes/pck.js";
import { antImageFormat } from "./studio-ego/ant-image.js";
import { egoDatFormat, egoOldDatFormat } from "./studio-ego/ego-dat.js";
import { studioEgoPak0Format } from "./studio-ego/pak0.js";
import { studioJikkenshitsuGrcImageFormat } from "./studio-jikkenshitsu/grc-image.js";
import { studioJikkenshitsuGrdImageFormat } from "./studio-jikkenshitsu/grd-image.js";
import { studioJikkenshitsuSpeedImageFormat } from "./studio-jikkenshitsu/speed-image.js";
import { studioSakuraDatFormat } from "./studio-sakura/dat.js";
import { succubusArcFormat } from "./succubus/arc.js";
import { succubusGhImageFormat } from "./succubus/gh-image.js";
import { supernekoxGpc7Format } from "./supernekox/gpc.js";
import { sviuJbpImageFormat } from "./sviu/jbp-image.js";
import { gbpImageFormat } from "./sviu/gbp-image.js";
import { kogAudioFormat } from "./sviu/kog-audio.js";
import { dbmImageFormat } from "./sysd/dbm-image.js";
import { dpkFormat } from "./sysd/dpk.js";
import { dwvAudioFormat } from "./sysd/dwv-audio.js";
import { systemAquaCatfFormat } from "./system-aqua/catf.js";
import { PackDatFormat } from "./system-epsilon/packdat.js";
import { betImageFormat, lzBetImageFormat } from "./system21/bet-image.js";
import { system21PakFormat } from "./system21/pak.js";
import { texImageFormat } from "./system21/tex-image.js";
import { system98GImageFormat } from "./system98/g-image.js";
import { system98LibFormat } from "./system98/lib.js";
import { tacticsTgfImageFormat } from "./tactics/tgf-image.js";
import { yuFormat } from "./tactics/yu.js";
import { tailCafFormat } from "./tail/caf.js";
import { tailCfp2ImageFormat, tailCfpImageFormat } from "./tail/cfp-image.js";
import { tailPkgFormat } from "./tail/pkg.js";
import { mpkHgFormat } from "./tako/mpk.js";
import { btnImageFormat } from "./tamasoft/btn-image.js";
import { tamasoftEpkFormat } from "./tamasoft/epk.js";
import { esdAudioFormat } from "./tamasoft/esd-audio.js";
import { surImageFormat } from "./tamasoft/sur-image.js";
import { tanakaArc0Format } from "./tanaka/arc0.js";
import { arcgFormat } from "./tanaka/arcg.js";
import { tanakaBcImageFormat } from "./tanaka/bc-image.js";
import { bmxFormat } from "./tanaka/bmx.js";
import { mbfFormat } from "./tanaka/mbf.js";
import { smvFormat } from "./tanaka/smv.js";
import { tanakaVpkFormat } from "./tanaka/vpk.js";
import {
	wsm0Format,
	wsm1Format,
	wsm2Format,
	wsm4Format,
} from "./tanaka/wsm.js";
import { tanakaWvxFormat } from "./tanaka/wvx.js";
import { tanukiAmapImageFormat } from "./tanuki/amap-image.js";
import { tanukiTacFormat } from "./tanuki/tac.js";
import { taskforceDatFormat } from "./taskforce/dat.js";
import { techgianBinFormat } from "./techgian/bin.js";
import { technoBrainIpfImageFormat } from "./techno-brain/ipf-image.js";
import { technoBrainIphImageFormat } from "./techno-brain/iph-image.js";
import { ipqFormat } from "./techno-brain/ipq.js";
import { technoBrainWapeAudioFormat } from "./techno-brain/wape-audio.js";
import { bndFormat } from "./tetratech/bnd.js";
import { tiareGraImageFormat } from "./tiare/gra-image.js";
import { chrFormat } from "./tigerman/chr.js";
import { tigermanChrImageFormat } from "./tigerman/chr-image.js";
import { tigermanPacFormat } from "./tigerman/pac.js";
import { p8Format } from "./tinkerbell/p8.js";
import { tinkerbellTb1ImageFormat } from "./tinkerbell/tb1-image.js";
import { tmrHiroPacFormat } from "./tmr-hiro/pac.js";
import { tmrHiroAudioFormat } from "./tmr-hiro/wav-audio.js";
import { tobeWbiImageFormat } from "./tobe/wbi-image.js";
import { tcd1Format } from "./topcat/tcd1.js";
import { triangleBmxFormat } from "./triangle/bmx.js";
import { iafImageFormat } from "./triangle/iaf-image.js";
import { cgfFormat } from "./triangle/cgf.js";
import { triangleDatFormat } from "./triangle/dat.js";
import { iafFormat } from "./triangle/iaf.js";
import { sudFormat } from "./triangle/sud.js";
import { triangleTriImageFormat } from "./triangle/tri-image.js";
import { mcdFormat } from "./tsd/mcd.js";
import { typesArcFormat } from "./types/arc.js";
import { ucomDataFormat } from "./ucom/data.js";
import { ucomGpcImageFormat } from "./ucom/gpc-image.js";
import { ugImageFormat } from "./ucom/ug-image.js";
import { ukFormat } from "./ucom/uk.js";
import { detFormat } from "./ugos/det.js";
import { ugosDetBmpImageFormat } from "./ugos/det-image.js";
import { ugoTxtFormat } from "./ugos/txt-image.js";
import { cdtFormat } from "./uma/cdt.js";
import { sdtFormat } from "./uma/sdt.js";
import { umeSoftBinFormat } from "./ume-soft/bin.js";
import { ikeAudioFormat } from "./ume-soft/ike-audio.js";
import { ikeImageFormat } from "./ume-soft/ike-image.js";
import { mgxFormat } from "./ume-soft/mgx.js";
import { umeSoftPkFormat } from "./ume-soft/pk.js";
import { wstrAudioFormat } from "./ume-soft/str-audio.js";
import { gr2Format } from "./umesoft/gr2.js";
import { umesoftGrxImageFormat } from "./umesoft/grx-image.js";
import { umesoftMgxImageFormat } from "./umesoft/mgx.js";
import { umesoftSgxImageFormat } from "./umesoft/sgx-image.js";
import { umpkFormat } from "./umut/pak.js";
import { uncannyCiiImageFormat } from "./uncanny/cii-image.js";
import { cwvAudioFormat } from "./uncanny/cwv-audio.js";
import { unisonVctFormat } from "./unison/vct.js";
import { unityDsmArchiveFormat } from "./unity/dsm-archive.js";
import { unityDsmScriptFormat } from "./unity/dsm-script.js";
import { unityFsb5AudioFormat } from "./unity/fsb5-audio.js";
import { unityPMasterDatFormat } from "./unity/pmaster-dat.js";
import { utageImageFormat } from "./unity/utage-image.js";
import { aqaFormat } from "./unknown/aqa.js";
import { unknownCtfImageFormat } from "./unknown/ctf-image.js";
import { unknownDatFormat } from "./unknown/dat.js";
import { egnImageFormat } from "./unknown/egn-image.js";
import { msfAudioFormat } from "./unknown/msf-audio.js";
import { uranDarImageFormat } from "./uran/dar-image.js";
import { uranNclFormat } from "./uran/ncl.js";
import { uranNclImageFormat } from "./uran/ncl-image.js";
import { phsFormat } from "./uran/phs.js";
import { valkyriaAm2Format } from "./valkyria/am2.js";
import { valkyriaDatFormat } from "./valkyria/dat.js";
import { malImageFormat } from "./valkyria/mal-image.js";
import { valkyriaMg2ImageFormat } from "./valkyria/mg2-image.js";
import { valkyriaOdnFormat } from "./valkyria/odn.js";
import { vitaminMfcImageFormat } from "./vitamin/mfc-image.js";
import { vitaminSbiImageFormat } from "./vitamin/sbi-image.js";
import { vnEngineAxrFormat } from "./vn-engine/axr.js";
import { vnEngineZawImageFormat } from "./vn-engine/zaw-image.js";
import { vnsystemVfsFormat } from "./vnsystem/vfs.js";
import { weaponVoiceFormat } from "./weapon/voice.js";
import { webpImageFormat } from "./webp/webp-image.js";
import { nbmpImageFormat } from "./westgate/nbmp-image.js";
import { ucaFormat } from "./westgate/uca.js";
import { usfFormat } from "./westgate/usf.js";
import { uwfFormat } from "./westgate/uwf.js";
import { wbpFormat } from "./wild-bug/wbp.js";
import { wildbugWbmImageFormat } from "./wildbug/wbm-image.js";
import { wpnAudioFormat } from "./wildbug/wpn-audio.js";
import { wildbugWwaAudioFormat } from "./wildbug/wwa-audio.js";
import { willArcFormat } from "./will/arc.js";
import { willArc2Format } from "./will/arc2.js";
import { willPnaFormat } from "./will/pna.js";
import { willWipFormat } from "./will/wip.js";
import { wingGemImageFormat } from "./wing/gem-image.js";
import { capybaraDatFormat } from "./winters/capybara.js";
import { cfpFormat } from "./winters/cfp.js";
import { ifpFormat } from "./winters/ifp.js";
import { ifxFormat } from "./winters/ifx.js";
import { witchArcFormat } from "./witch/arc.js";
import { witchDatFormat } from "./witch/dat.js";
import { pcdImageFormat } from "./witch/pcd.js";
import { vbdFormat } from "./witch/vbd.js";
import { iksFormat } from "./xiks/iks.js";
import { Xp3Format } from "./xp3/format.js";
import { xuseBinFormat } from "./xuse/bin.js";
import { gdFormat } from "./xuse/gd.js";
import { xuseArcFormat, xuseKotoriFormat } from "./xuse/miko.js";
import { xuseBgFormat, xuseHFormat } from "./xuse/nt.js";
import { p4agImageFormat } from "./xuse/p4ag-image.js";
import { xuseWagFormat } from "./xuse/wag.js";
import { wvbFormat } from "./xuse/wvb.js";
import { xarcFormat } from "./xuse/xarc.js";
import { yaneDatFormat } from "./yane-sdk/dat.js";
import { yaneuraoDatDxFormat, yaneuraoDatExFormat } from "./yaneurao/dat.js";
import { yaneuraoGtoImageFormat } from "./yaneurao/gto-image.js";
import { yaneSdaFormat } from "./yaneurao/sda.js";
import { ygaImageFormat } from "./yaneurao/yga-image.js";
import { pkgFormat } from "./yatagarasu/pkg.js";
import { gefImageFormat } from "./yellowcap/gef-image.js";
import { ggfImageFormat } from "./yellowcap/ggf-image.js";
import {
	youkaiDatGrpFormat,
	youkaiDatSoundFormat,
	youkaiDatVoiceFormat,
} from "./youkai/dat.js";
import { yoxDatFormat } from "./yox/dat.js";
import { yuRisYcgImageFormat } from "./yu-ris/ycg-image.js";
import { yukaYkcFormat } from "./yuka/ykc.js";
import { yukaYkgImageFormat } from "./yuka/ykg-image.js";
import { pnxImageFormat } from "./zenos/pnx-image.js";
import { zoneBmImageFormat } from "./zone/bm-image.js";
import { pkdFormat } from "./zone/pkd.js";
import { zyxBdfFormat } from "./zyx/bdf.js";
import { zyxMtlImageFormat } from "./zyx/mtl-image.js";
import { zyxSplImageFormat } from "./zyx/spl-image.js";
import { zyxXmgImageFormat } from "./zyx/xmg-image.js";

export * from "./aaru/index.js";
export * from "./abel/index.js";
export * from "./abogado/index.js";
export * from "./acme/index.js";
export * from "./active-soft/index.js";
export * from "./adobe/index.js";
export * from "./ads/index.js";
export * from "./adv98/index.js";
export * from "./advdx/index.js";
export * from "./advgsys/index.js";
export * from "./adviz/index.js";
export * from "./advscripter/index.js";
export * from "./advsys/index.js";
export * from "./ags32i/index.js";
export * from "./ail/index.js";
export * from "./aims/index.js";
export * from "./airyu/index.js";
export * from "./akatombo/index.js";
export * from "./alicesoft/index.js";
export * from "./alpha-system/index.js";
export * from "./alterna/index.js";
export * from "./amaterasu/index.js";
export * from "./anime-game-system/index.js";
export * from "./ankh/index.js";
export * from "./anotherroom/index.js";
export * from "./antique/index.js";
export * from "./aoi/index.js";
export * from "./aos/index.js";
export * from "./applepie/index.js";
export * from "./apricot/index.js";
export * from "./aquarium/index.js";
export * from "./arcx/index.js";
export * from "./ark/index.js";
export * from "./artel/index.js";
export * from "./artemis/index.js";
export * from "./ast/index.js";
export * from "./astronauts/index.js";
export * from "./asura/index.js";
export * from "./aypio/index.js";
export * from "./azsys/index.js";
export * from "./banana/index.js";
export * from "./basil/index.js";
export * from "./bef/index.js";
export * from "./bellda/index.js";
export * from "./bishop/index.js";
export * from "./miami/index.js";
export * from "./primel/index.js";
export * from "./black-butterfly/index.js";
export * from "./black-cyc/index.js";
export * from "./black-rainbow/index.js";
export * from "./blue-gale/index.js";
export * from "./broom/index.js";
export * from "./brownie/index.js";
export * from "./bruns/index.js";
export * from "./c4/index.js";
export * from "./cadath/index.js";
export * from "./caramel-box/index.js";
export * from "./carriere/index.js";
export * from "./cat-system/index.js";
export * from "./cdpa/index.js";
export * from "./cherry/index.js";
export * from "./circus/index.js";
export * from "./clickteam/index.js";
export * from "./clio/index.js";
export * from "./cmvs/index.js";
export * from "./actgs/index.js";
export * from "./cotton-club/index.js";
export * from "./creative/index.js";
export * from "./cri/index.js";
export * from "./cromwell/index.js";
export * from "./crossnet/index.js";
export * from "./crowd/index.js";
export * from "./csware/index.js";
export * from "./cyberworks/index.js";
export * from "./dai-system/index.js";
export * from "./dall/index.js";
export * from "./dd-system/index.js";
export * from "./debonosu/index.js";
export * from "./densdk/index.js";
export * from "./desire/index.js";
export * from "./dice/index.js";
export * from "./digital-monkey/index.js";
export * from "./digital-works/index.js";
export * from "./digitalworks/index.js";
export * from "./directdraw/index.js";
export * from "./discovery/index.js";
export * from "./djsystem/index.js";
export * from "./dmotion/index.js";
export * from "./dogenzaka/index.js";
export * from "./dxlib/index.js";
export * from "./eagls/index.js";
export * from "./ebg-system/index.js";
export * from "./ebisu/index.js";
export * from "./electriciteit/index.js";
export * from "./elf/index.js";
export * from "./ellefin/index.js";
export * from "./emic/index.js";
export * from "./emon/index.js";
export * from "./entexec/index.js";
export * from "./entis/index.js";
export * from "./escude/index.js";
export * from "./eternity/index.js";
export * from "./ethornell/index.js";
export * from "./eushully/index.js";
export * from "./eve/index.js";
export * from "./ex-hibit/index.js";
export * from "./eye/index.js";
export * from "./factor/index.js";
export * from "./favorite/index.js";
export * from "./fazex/index.js";
export * from "./fc01/index.js";
export * from "./ffa/index.js";
export * from "./flying-shine/index.js";
export * from "./force/index.js";
export * from "./foster/index.js";
export * from "./frontwing/index.js";
export * from "./g2/index.js";
export * from "./gaia/index.js";
export * from "./gameres/index.js";
export * from "./gamesystem/index.js";
export * from "./giga/index.js";
export * from "./glib/index.js";
export * from "./gpk2/index.js";
export * from "./grocer/index.js";
export * from "./groover/index.js";
export * from "./gs-pack/index.js";
export * from "./gscripter/index.js";
export * from "./gss/index.js";
export * from "./gsx/index.js";
export * from "./hcsystem/index.js";
export * from "./hdl/index.js";
export * from "./herb/index.js";
export * from "./hexenhaus/index.js";
export * from "./hillfield/index.js";
export * from "./hmp/index.js";
export * from "./hsp/index.js";
export * from "./hypatia/index.js";
export * from "./hyperworks/index.js";
export * from "./ice/index.js";
export * from "./ikura/index.js";
export * from "./inspire/index.js";
export * from "./interheart/index.js";
export * from "./ipac/index.js";
export * from "./iris/index.js";
export * from "./irrlicht/index.js";
export * from "./ism/index.js";
export * from "./ism/index.js";
export * from "./ivory/index.js";
export * from "./jam-creation/index.js";
export * from "./james/index.js";
export * from "./jupiter/index.js";
export * from "./kaas/index.js";
export * from "./kaguya/index.js";
export * from "./kapp/index.js";
export * from "./kasane/index.js";
export * from "./keroq/index.js";
export * from "./key/index.js";
export * from "./kid/index.js";
export * from "./kirikiri/index.js";
export * from "./kiss/index.js";
export * from "./koei/index.js";
export * from "./kogado/index.js";
export * from "./kscript/index.js";
export * from "./kurumi/index.js";
export * from "./lambda/index.js";
export * from "./lazycrew/index.js";
export * from "./leaf/index.js";
export * from "./liar/index.js";
export * from "./libido/index.js";
export * from "./liddell/index.js";
export * from "./liddell/index.js";
export * from "./lilim/index.js";
export * from "./livemaker/index.js";
export * from "./logg/index.js";
export * from "./lucifen/index.js";
export * from "./luna-soft/index.js";
export * from "./lune/index.js";
export * from "./macromedia/index.js";
export * from "./mai/index.js";
export * from "./maika/index.js";
export * from "./majiro/index.js";
export * from "./malie/index.js";
export * from "./manga-gamer/index.js";
export * from "./marble/index.js";
export * from "./moonhir/index.js";
export * from "./strikes/index.js";
export * from "./marron/index.js";
export * from "./masys/index.js";
export * from "./maybesoft/index.js";
export * from "./mb/index.js";
export * from "./mebius/index.js";
export * from "./melody/index.js";
export * from "./melonpan/index.js";
export * from "./mermaid/index.js";
export * from "./mg/index.js";
export * from "./microsoft/index.js";
export * from "./microvision/index.js";
export * from "./mina/index.js";
export * from "./mink/index.js";
export * from "./misc/index.js";
export * from "./mixwill/index.js";
export * from "./mmfass/index.js";
export * from "./mng/index.js";
export * from "./mno-violet/index.js";
export * from "./mnoviolet/index.js";
export * from "./mnp/index.js";
export * from "./moko-pro/index.js";
export * from "./morning/index.js";
export * from "./mugi/index.js";
export * from "./muse/index.js";
export * from "./musica/index.js";
export * from "./mutation/index.js";
export * from "./myadv/index.js";
export * from "./myharvest/index.js";
export * from "./n-system/index.js";
export * from "./nabe/index.js";
export * from "./nags/index.js";
export * from "./nejii/index.js";
export * from "./nekopack/index.js";
export * from "./nekopunch/index.js";
export * from "./nekosdk/index.js";
export * from "./nekotaro/index.js";
export * from "./neon/index.js";
export * from "./nexas/index.js";
export * from "./nexton/index.js";
export * from "./nitroplus/index.js";
export * from "./noesis/index.js";
export * from "./nonono/index.js";
export * from "./nscripter/index.js";
export * from "./nsystem/index.js";
export * from "./nug/index.js";
export * from "./nyoken/index.js";
export * from "./ocarina/index.js";
export * from "./ogg/index.js";
export * from "./omi/index.js";
export * from "./oneup/index.js";
export * from "./origin/index.js";
export * from "./otemoto/index.js";
export * from "./pajamas/index.js";
export * from "./palette/index.js";
export * from "./palm-tree/index.js";
export * from "./pan/index.js";
export * from "./pandora/index.js";
export * from "./paprika/index.js";
export * from "./parsley/index.js";
export * from "./patisserie/index.js";
export * from "./pearl/index.js";
export * from "./penguin/index.js";
export * from "./pias/index.js";
export * from "./pinesoft/index.js";
export * from "./pinky/index.js";
export * from "./pinpai/index.js";
export * from "./pisckiss/index.js";
export * from "./pkware/index.js";
export * from "./plantech/index.js";
export * from "./pochette/index.js";
export * from "./ponytail/index.js";
export * from "./powerd/index.js";
export * from "./primesoft/index.js";
export * from "./project-myu/index.js";
export * from "./propeller/index.js";
export * from "./psm/index.js";
export * from "./psp/index.js";
export * from "./q-lie/index.js";
export * from "./qlie/index.js";
export * from "./qsoft/index.js";
export * from "./rain/index.js";
export * from "./ransel/index.js";
export * from "./rare/index.js";
export * from "./reallive/index.js";
export * from "./redzone/index.js";
export * from "./regrips/index.js";
export * from "./renpy/index.js";
export * from "./rhss/index.js";
export * from "./riddle/index.js";
export * from "./rina/index.js";
export * from "./risa/index.js";
export * from "./rits/index.js";
export * from "./rpg-maker/index.js";
export * from "./rpm/index.js";
export * from "./rsystem/index.js";
export * from "./rugp/index.js";
export * from "./rune/index.js";
export * from "./saiki/index.js";
export * from "./sakanagl/index.js";
export * from "./sas5/index.js";
export * from "./sceneplayer/index.js";
export * from "./sceplay/index.js";
export * from "./scoop/index.js";
export * from "./scrplayer/index.js";
export * from "./selene/index.js";
export * from "./seraphim/index.js";
export * from "./shapeshifter/index.js";
export * from "./shiina-rio/index.js";
export * from "./shsystem/index.js";
export * from "./silky/index.js";
export * from "./slg/index.js";
export * from "./softpal/index.js";
export * from "./sogna/index.js";
export * from "./sohfu/index.js";
export * from "./sophia/index.js";
export * from "./spack/index.js";
export * from "./speed/index.js";
export * from "./splush-wave/index.js";
export * from "./squadrad/index.js";
export * from "./studio-ego/index.js";
export * from "./studio-jikkenshitsu/index.js";
export * from "./studio-sakura/index.js";
export * from "./succubus/index.js";
export * from "./succubus/index.js";
export * from "./supernekox/index.js";
export * from "./sviu/index.js";
export * from "./sysd/index.js";
export * from "./system-aqua/index.js";
export * from "./system-epsilon/index.js";
export * from "./system21/index.js";
export * from "./system98/index.js";
export * from "./tactics/index.js";
export * from "./tail/index.js";
export * from "./tako/index.js";
export * from "./tamasoft/index.js";
export * from "./tanaka/index.js";
export * from "./tanuki/index.js";
export * from "./taskforce/index.js";
export * from "./techgian/index.js";
export * from "./techno-brain/index.js";
export * from "./tetratech/index.js";
export * from "./tiare/index.js";
export * from "./tigerman/index.js";
export * from "./tinkerbell/index.js";
export * from "./tmr-hiro/index.js";
export * from "./family-adv-system/index.js";
export * from "./tobe/index.js";
export * from "./topcat/index.js";
export * from "./triangle/index.js";
export * from "./tsd/index.js";
export * from "./types/index.js";
export * from "./ucom/index.js";
export * from "./ugos/index.js";
export * from "./uma/index.js";
export * from "./ume-soft/index.js";
export * from "./umesoft/index.js";
export * from "./umut/index.js";
export * from "./uncanny/index.js";
export * from "./unison/index.js";
export * from "./unity/index.js";
export * from "./unknown/index.js";
export * from "./uran/index.js";
export * from "./valkyria/index.js";
export * from "./vitamin/index.js";
export * from "./vn-engine/index.js";
export * from "./vnsystem/index.js";
export * from "./weapon/index.js";
export * from "./webp/index.js";
export * from "./westgate/index.js";
export * from "./wild-bug/index.js";
export * from "./wildbug/index.js";
export * from "./will/index.js";
export * from "./wing/index.js";
export * from "./winters/index.js";
export * from "./witch/index.js";
export * from "./xiks/index.js";
export * from "./xp3/index.js";
export * from "./xuse/index.js";
export * from "./yane-sdk/index.js";
export * from "./yaneurao/index.js";
export * from "./yatagarasu/index.js";
export * from "./yellowcap/index.js";
export * from "./youkai/index.js";
export * from "./yox/index.js";
export * from "./yu-ris/index.js";
export * from "./yuka/index.js";
export * from "./zenos/index.js";
export * from "./zone/index.js";
export * from "./zyx/index.js";

export function createDefaultRegistry(
	options: { maxDecodedBytes?: number } = {},
): FormatRegistry {
	return new FormatRegistry([
		new Xp3Format(),
		new Adpack32Format(),
		hexenhausImgdImageFormat,
		cmvsPb2ImageFormat,
		mv2AudioFormat,
		mvAudioFormat,
		actressDatFormat,
		willWipImageFormat,
		clsImageFormat,
		rmskImageFormat,
		czImageFormat,
		ncgImageFormat,
		pmsImageFormat,
		mgpkFormat,
		kgImageFormat,
		mblFormat,
		graFormat,
		moonhirFpkFormat,
		lagImageFormat,
		tmrHiroGrdImageFormat,
		csafArchiveFormat,
		advizGiz3ImageFormat,
		cmbArchiveFormat,
		mi4ImageFormat,
		gpImageFormat,
		gsaImageFormat,
		miaImageFormat,
		gbcImageFormat,
		cmvsPsbImageFormat,
		cmvsPb3ImageFormat,
		sviuJbpImageFormat,
		gbpImageFormat,
		ugosDetBmpImageFormat,
		ugoTxtFormat,
		sas5IarFormat,
		sas5Sec5Format,
		sas5WarFormat,
		sas5War2Format,
		medFormat,
		bananaPkFormat,
		otemotoMagImageFormat,
		spcFormat,
		ailDatFormat,
		advsysGr2ImageFormat,
		advsysPolaImageFormat,
		advSysFpkFormat,
		adv98GpcImageFormat,
		advSysGwdImageFormat,
		bishopBscFormat,
		ccfFormat,
		circusPckFormat,
		flkFormat,
		fpk2Format,
		irrlichtPackFormat,
		kissArcFormat,
		pinesoftVoiceFormat,
		sudFormat,
		lnk2Format,
		nppFormat,
		new AfsFormat(),
		new CpkFormat(),
		new AmiFormat(),
		new BgiArcFormat(),
		new BurikoArcFormat(),
		new DrsFormat(),
		new MpxFormat(),
		new EscudeBinFormat(),
		new GspFormat(),
		new IntFormat(),
		new PackDatFormat(),
		new KcapFormat(),
		new HyPackFormat(),
		new LstFormat(),
		new MajiroArcFormat(),
		new NekoPack3Format(),
		new NekoPack2Format(),
		new NekoPack1Format(),
		new AcpxFormat(),
		new FavoriteBinFormat(),
		abelBinFormat,
		antiqueDatFormat,
		gpk2Format,
		kaasPbFormat,
		kpcFormat,
		leafPxImageFormat,
		leafPxFormat,
		leafPakFormat,
		rpgMakerRgssAdFormat,
		rpgMakerRpgmvpImageFormat,
		rpgMakerRpgmvoAudioFormat,
		leafTexFormat,
		oneUpArcFormat,
		seraphimMcFormat,
		succubusArcFormat,
		tailPkgFormat,
		tanakaArc0Format,
		tanakaWvxFormat,
		mrg0Format,
		clioPacFormat,
		dallPelFormat,
		dpfFormat,
		ifxFormat,
		unaDatFormat,
		museDatFormat,
		parsleyScnFormat,
		plantechPacFormat,
		phsFormat,
		renpyRpaFormat,
		redzonePakFormat,
		k5Format,
		pkdFormat,
		dpkFormat,
		gsdFormat,
		mjaFormat,
		iptImageFormat,
		mifFormat,
		bishopPkFormat,
		ivorySgFormat,
		ivoryPxAudioFormat,
		ivoryPxFormat,
		vsdFormat,
		silkyArcFormat,
		silkyMfgFormat,
		ukFormat,
		shaFormat,
		mpkFormat,
		parsleyPacFormat,
		valkyriaDatFormat,
		valkyriaAm2Format,
		p8Format,
		alkFormat,
		alicesoftQntImageFormat,
		cdpaPackFormat,
		hyperworksPakFormat,
		nafFormat,
		cpaFormat,
		sceplayPakFormat,
		tigermanPacFormat,
		irisFpackFormat,
		herbPakFormat,
		applePieArcFormat,
		pfdFormat,
		radFormat,
		k3Format,
		aqaFormat,
		weaponVoiceFormat,
		palettePakFormat,
		ml2Format,
		vbdFormat,
		pcdImageFormat,
		lpkFormat,
		ipacFormat,
		bldFormat,
		nscFormat,
		taskforceDatFormat,
		alphaSystemPakFormat,
		szsFormat,
		capybaraDatFormat,
		mykFormat,
		arcxFormat,
		sdaFormat,
		bmxFormat,
		dnsFormat,
		panFormat,
		dsvFormat,
		karFormat,
		asuraPakFormat,
		pak2Format,
		snnFormat,
		vpkFormat,
		bndFormat,
		aosDatFormat,
		keroqDatFormat,
		bcdFormat,
		zipFormat,
		aimsPackFormat,
		cfpFormat,
		aryFormat,
		akatomboXFormat,
		crgFormat,
		abelFpkFormat,
		clsFormat,
		ffaFormat,
		pogFormat,
		irrlichtArkFormat,
		fl2Format,
		fl3Format,
		gscripterDataFormat,
		chrFormat,
		witchArcFormat,
		typesArcFormat,
		gdFormat,
		aapFormat,
		mirisDatFormat,
		cdtFormat,
		usfFormat,
		iafFormat,
		lwgFormat,
		paqFormat,
		triangleDatFormat,
		rpmArcFormat,
		rpmZenosFormat,
		cabFormat,
		glnkFormat,
		advdxPkdFormat,
		dmotionPackFormat,
		ovkFormat,
		propellerMpkFormat,
		tcd1Format,
		odioFormat,
		nfsFormat,
		kirikiriTlgImageFormat,
		xpkFormat,
		xuseBinFormat,
		mbfFormat,
		blackRainbowDatFormat,
		iksFormat,
		fgFormat,
		cp3Format,
		crmFormat,
		pkgFormat,
		gpkFormat,
		blackCycVawAudioFormat,
		arc0Format,
		minkGrpFormat,
		yaneDatFormat,
		s25Format,
		hg2Format,
		hg3Format,
		patisserieRawFormat,
		tanakaVpkFormat,
		ifpFormat,
		xarcFormat,
		dafFormat,
		hotFormat,
		advSys3Format,
		neonAr2Format,
		kasaneAr2Format,
		witchDatFormat,
		mnvFormat,
		umpkFormat,
		airyuChrFormat,
		animFormat,
		pochettePacFormat,
		cgdFormat,
		ucomDataFormat,
		ai5DatFormat,
		awfFormat,
		mgdFormat,
		wvbFormat,
		pcdFormat,
		aldFormat,
		yaneSdaFormat,
		gameDatFormat,
		pmxFormat,
		pmaFormat,
		gr2Format,
		spdFormat,
		electriciteitDatFormat,
		dskFormat,
		pkDatFormat,
		plaFormat,
		cpnFormat,
		mcdFormat,
		igaFormat,
		djDatFormat,
		cpz1Format,
		arc2Format,
		yuFormat,
		gxpFormat,
		c24Format,
		c25Format,
		lb5Format,
		cgV2Format,
		ykFormat,
		koeiYkFormat,
		digitalWorksBinPacFormat,
		ns2ArchiveFormat,
		alicesoftAjpImageFormat,
		g2PgxImageFormat,
		ismIsgImageFormat,
		sakanaglSxArchiveFormat,
		succubusGhImageFormat,
		liddellBpaImageFormat,
		neFormat,
		mgsFormat,
		eternitySgfImageFormat,
		pajamasEpaImageFormat,
		nsystemMgdImageFormat,
		bishopBsgImageFormat,
		ucgFormat,
		voiceFormat,
		arccFormat,
		sdaSdFormat,
		sqzFormat,
		mpkHgFormat,
		favoriteHzcImageFormat,
		ikuraTanImageFormat,
		bananaGecImageFormat,
		bananaMagImageFormat,
		abelGpsImageFormat,
		abelCbfImageFormat,
		gameSystemCgdImageFormat,
		vitaminSbiImageFormat,
		bellDaPwAudioFormat,
		artelMrlImageFormat,
		clioExpImageFormat,
		rsystemRsgImageFormat,
		crossNetGrbImageFormat,
		gpk2GfbImageFormat,
		cgdKToolImageFormat,
		cgdSpielImageFormat,
		tailCfpImageFormat,
		tailCfp2ImageFormat,
		catSystemHg2ImageFormat,
		catSystemHg3ImageFormat,
		abogadoAdpAudioFormat,
		crossNetAdpAudioFormat,
		aaruWv1AudioFormat,
		technoBrainWapeAudioFormat,
		technoBrainIpfImageFormat,
		technoBrainIphImageFormat,
		sohfuDtlImageFormat,
		sohfuDtlcImageFormat,
		majiroRc8ImageFormat,
		basilBcfImageFormat,
		unknownCtfImageFormat,
		cottonClubLmgImageFormat,
		kidPrtImageFormat,
		gameSystemChrImageFormat,
		frontWingFwgiImageFormat,
		frontWingFweiImageFormat,
		kaasAudioFormat,
		mebiusMcgImageFormat,
		sceplayG24aImageFormat,
		sceplayG2408ImageFormat,
		creativeVocAudioFormat,
		egnImageFormat,
		digitalMonkeyPktImageFormat,
		cadathKgfImageFormat,
		cadathCgfImageFormat,
		cadathVwfAudioFormat,
		tanakaBcImageFormat,
		keroqKgdImageFormat,
		splushWaveSwgImageFormat,
		aquariumCp2ImageFormat,
		directDrawDdsImageFormat,
		criAdxAudioFormat,
		criGxtImageFormat,
		criXtxImageFormat,
		criSpcImageFormat,
		azsysCpbImageFormat,
		azIsaacArchiveFormat,
		azEncryptedArchiveFormat,
		azArcFormat,
		azSysTyp1ImageFormat,
		csWareBpcImageFormat,
		uncannyCiiImageFormat,
		aoiAgfImageFormat,
		blackRainbowBmdImageFormat,
		mebiusKoeAudioFormat,
		gameSystemAdp4AudioFormat,
		ffaWa2AudioFormat,
		ffaWa1AudioFormat,
		brownieNgcImageFormat,
		mayBeSoftHhpImageFormat,
		uranDarImageFormat,
		wingGemImageFormat,
		ipacIesImageFormat,
		ipacIesRawImageFormat,
		vitaminMfcImageFormat,
		marblePrsImageFormat,
		marbleWadyAudioFormat,
		nexasGrpImageFormat,
		crowdGaxImageFormat,
		crowdCwpImageFormat,
		tanFormat,
		csPackFormat,
		cpcFormat,
		adobePsdImageFormat,
		airFormat,
		gafFormat,
		emicFormat,
		ipqFormat,
		aniFormat,
		microVisionArcFormat,
		dxFormat,
		smvFormat,
		cgfFormat,
		techgianBinFormat,
		speedArcFormat,
		hzcMultiFormat,
		lunaPacFormat,
		fgaFormat,
		aos2Format,
		aosFormat,
		azuriteFormat,
		ai6WinFormat,
		nekopunchPakFormat,
		mugiBinFormat,
		crowdPckFormat,
		dlbFormat,
		dlbV0Format,
		aypioVocAudioFormat,
		aypioPdtImageFormat,
		aypioPdtBmpImageFormat,
		aypioPdt5ImageFormat,
		grocerPicImageFormat,
		morningTtdFormat,
		studioSakuraDatFormat,
		fwaFormat,
		riddlePacFormat,
		myAdvPacFormat,
		maikaMik01Format,
		maikaWv5AudioFormat,
		gxFormat,
		dl1Format,
		nejiiCdtFormat,
		rainBinFormat,
		aarFormat,
		ucaFormat,
		uwfFormat,
		spackFormat,
		pkkFormat,
		jamDatFormat,
		adsPacFormat,
		bsaFormat,
		ivoryPkFormat,
		omiDatFormat,
		system21PakFormat,
		isaFormat,
		circusDatFormat,
		mgxFormat,
		broomPkFormat,
		broomEncryptedPkFormat,
		softpalPacFormat,
		amusePacFormat,
		scrPlayerPakFormat,
		maiFormat,
		arFormat,
		activeSoftEd8ImageFormat,
		activeSoftEdtImageFormat,
		a98Format,
		wbpFormat,
		kaguyaPltFormat,
		kaguyaPl10Format,
		kaguyaAn21Format,
		nscripterSarFormat,
		keyPakFormat,
		egoDatFormat,
		egoOldDatFormat,
		him4Format,
		him5Format,
		ddp2Format,
		ddp3Format,
		gpcFormat,
		sndFormat,
		snrFormat,
		anmFormat,
		an10Format,
		an20Format,
		volFormat,
		vfsFormat,
		boxFormat,
		aoimyFormat,
		aoimyUnicodeFormat,
		mgpk0Format,
		hedFormat,
		wsm0Format,
		wsm1Format,
		wsm2Format,
		wsm4Format,
		arcgFormat,
		vcPakFormat,
		xflFormat,
		oggAudioFormat,
		gscFormat,
		exhGRPFormat,
		abmpFormat,
		abmp7Format,
		spPakFormat,
		meltyPakFormat,
		zlkFormat,
		iflFormat,
		libidoArcFormat,
		tlzFormat,
		dmFormat,
		ttdFormat,
		pinpaiArcxFormat,
		gigaTpfFormat,
		sognaDatFormat,
		diceRlzFormat,
		sdtFormat,
		unknownDatFormat,
		yoxDatFormat,
		entisPacFormat,
		triangleBmxFormat,
		iafImageFormat,
		digitalWorksPacFormat,
		pspQpkFormat,
		nitroplusPakFormat,
		nekosdkDatFormat,
		willWipFormat,
		leafAFormat,
		seenFormat,
		gamesystemDatFormat,
		abelArcFormat,
		cpz2Format,
		cswareDatFormat,
		hcsystemPakFormat,
		vnsystemVfsFormat,
		cromwellPakFormat,
		cromwellOpkFormat,
		propellerMgrFormat,
		sohfuSkaFormat,
		kaguyaUfFormat,
		umeSoftPkFormat,
		archangelDatFormat,
		ebgSystemBinFormat,
		alternaBinFormat,
		ebisuEp1Format,
		umeSoftBinFormat,
		penguinPacFormat,
		blueGaleAmvFormat,
		clickTeamMfsFormat,
		miscBinFormat,
		ponytailBndFormat,
		ponytailTszImageFormat,
		ponytailTczImageFormat,
		ankhGrpFormat,
		ankhDatFormat,
		shapeShifterBndFormat,
		ffaDatFormat,
		ffaJdatFormat,
		malieLibFormat,
		malieLibuFormat,
		willPnaFormat,
		yaneuraoDatDxFormat,
		yaneuraoDatExFormat,
		leafLacFormat,
		leafLacPakFormat,
		blackRainbowImpFormat,
		dogenzakaBinFormat,
		dogenzakaGameDatFormat,
		sophiaNorFormat,
		maikaBkFormat,
		unisonVctFormat,
		factorResFormat,
		nekoSdkPakFormat,
		loggArfFormat,
		glibGFormat,
		blackButterflyDatFormat,
		debonosuPakFormat,
		vnEngineAxrFormat,
		animeGameSystemCgImageFormat,
		animeGameSystemAniFormat,
		animeGameSystemDatFormat,
		maikaMk2Format,
		astArcFormat,
		leafAr2Format,
		leafAmFormat,
		carriereArcFormat,
		carriereScenarioFormat,
		kaguyaLin2Format,
		system98LibFormat,
		frontWingFltFormat,
		densdkDaf1Format,
		densdkDaf2Format,
		pfsFormat,
		tmrHiroPacFormat,
		eushullyAgfImageFormat,
		eushullyAlfFormat,
		gamesystemCmpFormat,
		tamasoftEpkFormat,
		youkaiDatGrpFormat,
		youkaiDatSoundFormat,
		youkaiDatVoiceFormat,
		crowdPkwvFormat,
		advscripterPakFormat,
		uranNclFormat,
		apricotDatFormat,
		cyberworksAppendixFormat,
		cyberworksDatFormat,
		cyberworksCsystemDatFormat,
		cyberworksCsystemDat2Format,
		pandoraPbxFormat,
		nononoNpfFormat,
		shiinaRioPadAudioFormat,
		shiinaRioWarcFormat,
		realliveG00Format,
		realliveG00ImageFormat,
		nitroplusNitroPakFormat,
		systemAquaCatfFormat,
		yukaYkcFormat,
		mokoProNnnnFormat,
		mokoProBmpImageFormat,
		mokoProOggAudioFormat,
		arkCmpImageFormat,
		eveGmFormat,
		studioEgoPak0Format,
		nexasPacFormat,
		aaruFl4Format,
		wagFormat,
		mcaFormat,
		dpmFormat,
		detFormat,
		daiPacFormat,
		ganFormat,
		laxFormat,
		fjsysFormat,
		idaFormat,
		ozFormat,
		fpkFormat,
		pcsFormat,
		vavFormat,
		fa2Format,
		cherryGrpImageFormat,
		cherryGrp3ImageFormat,
		cherryGrpEncImageFormat,
		cherryPakFormat,
		cherryPak2Format,
		grooverPcgFormat,
		flkDatFormat,
		asdKToolFormat,
		asdSpielFormat,
		kaguyaAriFormat,
		xuseBgFormat,
		xuseHFormat,
		xuseArcFormat,
		xuseKotoriFormat,
		lazycrewDatFormat,
		parsleyDesertCgFormat,
		rareXFormat,
		tailCafFormat,
		gameSystemChrFormat,
		seraphimScnFormat,
		seraphimScn95Format,
		gsPackFormat,
		gsDataFormat,
		parsleyYanepackFormat,
		parsleyCgV1Format,
		paletteChrFormat,
		mngImageFormat,
		mngFormat,
		tanukiTacFormat,
		kidLnkFormat,
		leafKcapFormat,
		zyxBdfFormat,
		kaasPdFormat,
		gamesystemPuremailFormat,
		ritsSafFormat,
		supernekoxGpc7Format,
		gssLsdFormat,
		strikesPckFormat,
		lucifenLpkFormat,
		ellefinEpkFormat,
		g2PakFormat,
		g2ArchiveFormat,
		willArc2Format,
		pinkyA5rFormat,
		piasDatFormat,
		kogadoArcFormat,
		willArcFormat,
		realliveKoeFormat,
		xuseWagFormat,
		minaBmpPakFormat,
		minaWavPakFormat,
		minaScriptPakFormat,
		emonEmeFormat,
		livemakerVfFormat,
		circusVcPacFormat,
		caramelBoxArc3Format,
		caramelBoxFcbImageFormat,
		caramelBoxArc4Format,
		lunePackFormat,
		nitroplusNpaSteinsGateFormat,
		discoveryDatFormat,
		entisEriFormat,
		piasEncryptedFormat,
		alicesoftAfaFormat,
		abmFormat,
		flyingShinePd3Format,
		flyingShinePdFormat,
		flyingShinePd2Format,
		vafsFormat,
		originHedDatFormat,
		mmaFormat,
		mrgFormat,
		mrg2Format,
		valkyriaOdnFormat,
		kurumiMpkFormat,
		eushullyAogAudioFormat,
		leafP16AudioFormat,
		ikmAudioFormat,
		keyOggpakAudioFormat,
		c4GdImageFormat,
		c4XexGdImageFormat,
		vmdAudioFormat,
		voiAudioFormat,
		eogAudioFormat,
		kogAudioFormat,
		aoiAogAudioFormat,
		softpalBgmAudioFormat,
		options.maxDecodedBytes === undefined
			? realliveNwaAudioFormat
			: createRealliveNwaAudioFormat(options.maxDecodedBytes),
		realliveOwpAudioFormat,
		nsOpenerFormat,
		esdAudioFormat,
		wstrAudioFormat,
		brownieWavAudioFormat,
		bgiAudioFormat,
		edimAudioFormat,
		ogvAudioFormat,
		agsAudioFormat,
		kwfAudioFormat,
		gssImageFormat,
		cgdImageFormat,
		tblImageFormat,
		bpdImageFormat,
		psmImageFormat,
		cp3ImageFormat,
		mdImageFormat,
		wmkImageFormat,
		p4agImageFormat,
		redImageFormat,
		pnxImageFormat,
		grdImageFormat,
		sedAudioFormat,
		mskImageFormat,
		cwvAudioFormat,
		whcAudioFormat,
		tmrHiroAudioFormat,
		pnxEncryptedImageFormat,
		pcgImageFormat,
		gefImageFormat,
		csfImageFormat,
		msfAudioFormat,
		cmbAudioFormat,
		ggfImageFormat,
		befAlpImageFormat,
		gamesystemAlpImageFormat,
		masysAgImageFormat,
		masysAlpImageFormat,
		ardImageFormat,
		acmePmgImageFormat,
		mbImageFormat,
		ngwImageFormat,
		gdfImageFormat,
		isdScriptFormat,
		wazAudioFormat,
		harvestBgmAudioFormat,
		hiddenJpegImageFormat,
		frmImageFormat,
		mbpImageFormat,
		muwAudioFormat,
		um3AudioFormat,
		brunsEencImageFormat,
		dwvAudioFormat,
		qdoScriptFormat,
		nsfAudioFormat,
		htfImageFormat,
		jamCreationDpoImageFormat,
		advgImageFormat,
		mwpImageFormat,
		leafWAudioFormat,
		leafGAudioFormat,
		leafLfgImageFormat,
		texbImageFormat,
		wrgAudioFormat,
		regripsMrgAudioFormat,
		ankhMskImageFormat,
		kurumiGraImageFormat,
		gr1ImageFormat,
		bgraImageFormat,
		cbfImageFormat,
		system98GImageFormat,
		desImageFormat,
		dpcImageFormat,
		tiareGraImageFormat,
		ugImageFormat,
		hillFieldImgImageFormat,
		pbmImageFormat,
		kslImageFormat,
		pmpImageFormat,
		vzyAudioFormat,
		nbmpImageFormat,
		pmwAudioFormat,
		ezsAudioFormat,
		bmzImageFormat,
		aloImageFormat,
		ankhGpdImageFormat,
		kgrImageFormat,
		lzBmpImageFormat,
		bbmImageFormat,
		wildbugWbmImageFormat,
		wildbugWwaAudioFormat,
		wpnAudioFormat,
		wbmImageFormat,
		surImageFormat,
		btnImageFormat,
		plantechPacImageFormat,
		mgfImageFormat,
		hotImageFormat,
		pgaImageFormat,
		bpicImageFormat,
		rmtImageFormat,
		picImageFormat,
		lgfImageFormat,
		wm2ImageFormat,
		malImageFormat,
		valkyriaMg2ImageFormat,
		texImageFormat,
		ggaImageFormat,
		thpImageFormat,
		ikeAudioFormat,
		iceAudioFormat,
		ikeImageFormat,
		opfImageFormat,
		ptiImageFormat,
		wafAudioFormat,
		antImageFormat,
		dbmImageFormat,
		wstAudioFormat,
		lpgImageFormat,
		sfgImageFormat,
		apImageFormat,
		aoImageFormat,
		ap0ImageFormat,
		ap2ImageFormat,
		ap3ImageFormat,
		aps3ImageFormat,
		apsImageFormat,
		crowdZbmImageFormat,
		bm1ImageFormat,
		pisckissAudioFormat,
		ygaImageFormat,
		hbmImageFormat,
		ibmImageFormat,
		rbmImageFormat,
		g00JpegImageFormat,
		abmImageFormat,
		fgpImageFormat,
		grpImageFormat,
		imaImageFormat,
		mtgImageFormat,
		cswareWavAudioFormat,
		advizGiz2ImageFormat,
		advizBizImageFormat,
		biz2ImageFormat,
		rbpImageFormat,
		prgImageFormat,
		brgImageFormat,
		ypfImageFormat,
		timImageFormat,
		imgBmpImageFormat,
		imgPngImageFormat,
		kgpImageFormat,
		unhImageFormat,
		gtxImageFormat,
		gpdImageFormat,
		ucomGpcImageFormat,
		risaSygImageFormat,
		yaneuraoGtoImageFormat,
		keroqCbmImageFormat,
		basilNg3ImageFormat,
		nagsNgpImageFormat,
		tanukiAmapImageFormat,
		silkyMfgImageFormat,
		interheartKgImageFormat,
		mnoVioletGraImageFormat,
		interheartHmpImageFormat,
		fc01ClmImageFormat,
		tinkerbellTb1ImageFormat,
		fc01TilImageFormat,
		digitalWorksTxImageFormat,
		interheartBmpRleImageFormat,
		interheartEpfImageFormat,
		dogenzakaRc4PngImageFormat,
		slgTigImageFormat,
		slgTicImageFormat,
		slgAlbImageFormat,
		silkyIgfImageFormat,
		fc01AcdImageFormat,
		silkyZitImageFormat,
		digitalWorksTim2ImageFormat,
		silkyAkbImageFormat,
		fc01PakFormat,
		fc01BdtFormat,
		mermaidGp1ImageFormat,
		applePieGtImageFormat,
		tobeWbiImageFormat,
		mermaidMg1ImageFormat,
		fosterC24ImageFormat,
		fosterC25ImageFormat,
		agsPcmAudioFormat,
		mixwillPb00ImageFormat,
		kurumiGraLegacyImageFormat,
		tigermanChrImageFormat,
		ai5Gp8ImageFormat,
		ai5MskImageFormat,
		ai5G24ImageFormat,
		ai5Msk16ImageFormat,
		ai5HizImageFormat,
		ai5HipImageFormat,
		seraphimCfImageFormat,
		seraphimCtImageFormat,
		seraphimCbImageFormat,
		seraphimCxImageFormat,
		amaterasuGrpImageFormat,
		scrScriptFormat,
		discoveryPr1ImageFormat,
		discoveryAn1ImageFormat,
		uranNclImageFormat,
		powerdNclImageFormat,
		gameresBmpImageFormat,
		gameresTgaImageFormat,
		triangleTriImageFormat,
		melodyMgoImageFormat,
		pochetteGdtImageFormat,
		tacticsTgfImageFormat,
		riddleGcpImageFormat,
		cswareGdtImageFormat,
		reallivePdtImageFormat,
		eaglsGrImageFormat,
		zoneBmImageFormat,
		scoopScpImageFormat,
		hypatiaLsgImageFormat,
		mermaidPwvAudioFormat,
		forceDzpImageFormat,
		qlieAbmpImageFormat,
		minkDatImageFormat,
		fcImageFormat,
		leafBjrImageFormat,
		vnEngineZawImageFormat,
		propellerMgrImageFormat,
		gameSystemBgdImageFormat,
		gsxK2ImageFormat,
		gsxK4ImageFormat,
		projectMyuGamImageFormat,
		keroqKgd1ImageFormat,
		utageImageFormat,
		unityFsb5AudioFormat,
		unityDsmScriptFormat,
		unityDsmArchiveFormat,
		unityPMasterDatFormat,
		aaruBm2ImageFormat,
		betImageFormat,
		lzBetImageFormat,
		gameresJpegImageFormat,
		gameresMp3AudioFormat,
		gameresWavAudioFormat,
		rugpRhaAudioFormat,
		studioJikkenshitsuGrdImageFormat,
		studioJikkenshitsuSpeedImageFormat,
		studioJikkenshitsuGrcImageFormat,
		macromediaSndAudioFormat,
		gsPackPicImageFormat,
		rinaRadImageFormat,
		yuRisYcgImageFormat,
		shiinaRioChdImageFormat,
		bellDaCpImageFormat,
		abogadoPakFormat,
		marbleYpImageFormat,
		saikiJpxImageFormat,
		saikiBmxImageFormat,
		pandoraXl24ImageFormat,
		jamesJmgImageFormat,
		ethornellBgiImageFormat,
		cswareB5ImageFormat,
		ikuraDoImageFormat,
		sas5IarImageFormat,
		akatomboFbImageFormat,
		ikuraGgsImageFormat,
		ikuraGgpImageFormat,
		ikuraYgpImageFormat,
		crowdCwdImageFormat,
		crowdCwlImageFormat,
		qsoftBpeImageFormat,
		blueGaleZbmImageFormat,
		eveWv3AudioFormat,
		hypatiaAdpAudioFormat,
		ivoryMoeImageFormat,
		ivoryMmdImageFormat,
		miscLzsImageFormat,
		umesoftGrxImageFormat,
		umesoftSgxImageFormat,
		umesoftMgxImageFormat,
		yukaYkgImageFormat,
		zyxMtlImageFormat,
		zyxSplImageFormat,
		webpImageFormat,
		zyxXmgImageFormat,
	]);
}
