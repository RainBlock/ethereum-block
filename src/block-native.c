#define NAPI_EXPERIMENTAL
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <limits.h> 

#include "../ext/xkcp/lib/high/Keccak/KeccakSpongeWidth1600.h"
#include "../ext/secp256k1/include/secp256k1.h"
#include "../ext/secp256k1/include/secp256k1_recovery.h"

secp256k1_context* secp256k1ctx;

// Structure to keep temporary work state
struct recover_from_address_work {
  uint8_t* transaction;
  size_t transaction_size;
  uint8_t signature[64];

  bool recovery;

  uint8_t verifyHash[32];

  uint32_t error;

  napi_deferred promise;
  napi_async_work work;
};

// Async completion which resolves the promise
void recover_from_address_complete(napi_env env, napi_status status, struct recover_from_address_work* work) {
  uint64_t* as_64 = (uint64_t*) work->verifyHash;

  napi_value out;
  status = napi_create_bigint_words(env, 0, 3, as_64 + 1, &out);
  assert(status == napi_ok);

  if (work->error == 0) {
    status = napi_resolve_deferred(env, work->promise, out);
    assert(status == napi_ok);
  } else {
    napi_value error;
    status = napi_create_uint32(env, work->error, &error);
    assert(status == napi_ok);

    status = napi_reject_deferred(env, work->promise, error);
    assert(status == napi_ok);
  }

  status = napi_delete_async_work(env, work->work);
  assert(status == napi_ok);

  free(work->transaction);
  free(work);
}

// Async function which actually performs the heavy lifting
void recover_from_address_execute(napi_env env, struct recover_from_address_work* work) {
  // Generate the keecak-256 hash of the verify area
  // keccak-256: w=1600, r=1088, c=512, suffix=0
  KeccakWidth1600_SpongeInstance sponge;
  KeccakWidth1600_SpongeInitialize(&sponge, 1088, 512);
  KeccakWidth1600_SpongeAbsorb(&sponge, work->transaction, work->transaction_size);
  KeccakWidth1600_SpongeAbsorbLastFewBits(&sponge, 0);
  KeccakWidth1600_SpongeSqueeze(&sponge, work->verifyHash, 32);

  work->error = 0;

  secp256k1_ecdsa_recoverable_signature sig;
  uint32_t secp256k1_status;
  secp256k1_status = secp256k1_ecdsa_recoverable_signature_parse_compact(secp256k1ctx, &sig, work->signature, work->recovery ? 1: 0);
  if (secp256k1_status == 0) {
      work->error = 1;
      return;
  }

  secp256k1_pubkey public_key;
  secp256k1_status = secp256k1_ecdsa_recover(secp256k1ctx, &public_key, &sig, work->verifyHash);
  if (secp256k1_status == 0) {
      work->error = 2;
      return;
  }

  uint8_t output[65];
  size_t output_length = 65;
  secp256k1_status = secp256k1_ec_pubkey_serialize(secp256k1ctx, &output[0], &output_length, &public_key, SECP256K1_EC_UNCOMPRESSED);
  if (secp256k1_status == 0) {
     work->error = 3;
     return;
  }

  // Generate the keecak-256 hash of the pubkey
  // keccak-256: w=1600, r=1088, c=512, suffix=0
  KeccakWidth1600_SpongeInitialize(&sponge, 1088, 512);
  KeccakWidth1600_SpongeAbsorb(&sponge, &output[1], output_length - 1);
  KeccakWidth1600_SpongeAbsorbLastFewBits(&sponge, 0);
  KeccakWidth1600_SpongeSqueeze(&sponge, work->verifyHash, 32);
  
  // Endianess swap
  uint64_t* as_64 = (uint64_t*) work->verifyHash;
  // We can use [0] as a temp since we won't use it (160-bit account)
  as_64[0] = as_64[3];
  as_64[3] = __builtin_bswap64(as_64[1] >> 32) >> 32;
  as_64[2] = __builtin_bswap64(as_64[2]);
  as_64[1] = __builtin_bswap64(as_64[0]);
}

// arg0 : Transaction data to verify and generate pubkey from
// arg1 : R,S,V buffer as a signature
// arg2 : Recovery (false = 0, true = 1)
// Output: Promise for a 160-bit Ethereum Address
napi_value recover_from_address(napi_env env, napi_callback_info info) {
  napi_value argv[3];
  napi_status status;
  size_t argc = 3;

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  assert(status == napi_ok);

  if (argc < 3) {
    napi_throw_error(env, "EINVAL", "Too few arguments");
    return NULL;
  }

  uint8_t* data;
  size_t length;
  status = napi_get_buffer_info(env, argv[0], (void**) &data, &length);
  assert(status == napi_ok);


  uint8_t* signature;
  size_t sign_length;
  status = napi_get_buffer_info(env, argv[1], (void**) &signature, &sign_length);
  assert(status == napi_ok);
  if (sign_length != 64) {
      napi_throw_error(env, "EINVAL", "Expected 64-byte signature");
  }

  bool recovery;
  status = napi_get_value_bool(env, argv[2], &recovery);
  assert(status == napi_ok);

  struct recover_from_address_work * work = 
    (struct recover_from_address_work*) malloc(sizeof(struct recover_from_address_work));

  work->transaction = (uint8_t*) malloc(length);
  memcpy(work->transaction, data, length);
  work->transaction_size = length;
  memcpy(work->signature, signature, 64);
  work->recovery = recovery;

  napi_value async_name;
  status = napi_create_string_utf8(env, "block-native", NAPI_AUTO_LENGTH, &async_name);
  assert(status == napi_ok);

  status = napi_create_async_work(env, NULL, async_name, 
    (napi_async_execute_callback) recover_from_address_execute,  
    (napi_async_complete_callback) recover_from_address_complete,
    (void*) work,
    &work->work);
  assert(status == napi_ok);

  status = napi_queue_async_work(env, work->work);
  assert(status == napi_ok);

  napi_value out;
  status = napi_create_promise(env, &work->promise, &out);
  assert(status == napi_ok);
  
  return out;
}

napi_value init_all (napi_env env, napi_value exports) {
  napi_value recover_from_address_fn;

  secp256k1ctx = secp256k1_context_create(
    SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);

  napi_create_function(env, NULL, 0, recover_from_address, NULL, &recover_from_address_fn);
 
  napi_set_named_property(env, exports, "recoverFromAddress", recover_from_address_fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init_all);