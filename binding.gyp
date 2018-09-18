{
  "targets": [{
    "target_name": "block_native",
    "sources": [
      "src/block-native.c",
      "ext/xkcp/lib/high/Keccak/KeccakSpongeWidth1600.c",
      "ext/xkcp/lib/low/KeccakP-1600/Optimized64/KeccakP-1600-opt64.c",
      "ext/secp256k1/src/secp256k1.c"
    ], 'include_dirs': 
    ['ext/xkcp/lib/common', 'ext/xkcp/lib/low/KeccakP-1600/Optimized64', 'ext/xkcp/lib/low/KeccakP-1600/Optimized64/LCufullshld',  
    'ext/xkcp/lib/low/KeccakP-1600/Optimized', 'ext/xkcp/lib/low/common', 'ext/secp256k1'],
    "cflags" : [ "-Wno-unused-function" ],
     'xcode_settings': {
        'OTHER_CFLAGS': [
          '-Wno-unused-function'
        ]},
    "defines": [
            "ENABLE_MODULE_RECOVERY=1"
            "HAVE_LIBGMP=1",
            "USE_NUM_GMP=1",
            "USE_FIELD_INV_NUM=1",
            "USE_SCALAR_INV_NUM=1",
            "HAVE___INT128=1",
            "USE_ASM_X86_64=1",
            "USE_FIELD_5X52=1",
            "USE_FIELD_5X52_INT128=1",
            "USE_SCALAR_4X64=1"
    ],
          "libraries": [
            "-lgmpxx",
            "-lgmp"
          ]
  }]
}