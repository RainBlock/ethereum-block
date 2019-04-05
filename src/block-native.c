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

struct get_public_address_work {
  uint64_t private_key[5];
  uint32_t error;

  uint64_t account[3];

  napi_deferred promise;
  napi_async_work work;
};


// Async completion which resolves the promise for get_public_address
void get_public_address_complete(napi_env env, napi_status status, struct get_public_address_work* work) {
  napi_value result;
  status = napi_create_bigint_words(env, 0, 3, work->account, &result);
  assert(status == napi_ok);

  status = napi_resolve_deferred(env, work->promise, result);
  assert(status == napi_ok);

  status = napi_delete_async_work(env, work->work);
  assert(status == napi_ok);

  free(work);
}

// Async function which actually performs the heavy lifting for get_public_address
void get_public_address_execute(napi_env env, struct get_public_address_work* work) {

  uint32_t secp256k1_status;

  secp256k1_pubkey pubkey;
  secp256k1_status = secp256k1_ec_pubkey_create(secp256k1ctx, &pubkey, (unsigned char*) work->private_key);
  assert(secp256k1_status != 0);

  unsigned char pubkey_serialized[65];
  size_t pubkey_serialized_length = 65;
  secp256k1_status = secp256k1_ec_pubkey_serialize(secp256k1ctx, pubkey_serialized, &pubkey_serialized_length, &pubkey, SECP256K1_EC_UNCOMPRESSED);
  assert(secp256k1_status != 0);

  unsigned char digest[32];
  // The pubkey is located in bytes 1-65
  // We'll take the keccak-256 hash and return the last 20 bytes.
  // keccak-256: w=1600, r=1088, c=512, suffix=0
  KeccakWidth1600_SpongeInstance sponge;
  KeccakWidth1600_SpongeInitialize(&sponge, 1088, 512);
  KeccakWidth1600_SpongeAbsorb(&sponge, pubkey_serialized + 1, 64);
  KeccakWidth1600_SpongeAbsorbLastFewBits(&sponge, 0);
  KeccakWidth1600_SpongeSqueeze(&sponge, digest, 32);

  // top 4 bytes, special case
  work->account[2] = __builtin_bswap32(*(uint32_t*)(digest + 12));
  // remaining bytes
  work->account[1] = __builtin_bswap64(*(uint64_t*)(digest + 16));
  work->account[0] = __builtin_bswap64(*(uint64_t*)(digest + 24));
}

// Generate an Ethereum address from a private key
// Using secp256k1, a valid private key is any 256-bit number other than 0
// js arguments:
// 0 : private key as bigint.
napi_value get_public_address(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  napi_status status;
  size_t argc = 1;

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  assert(status == napi_ok);

  if (argc < 1) {
    napi_throw_error(env, "EINVAL", "Too few arguments");
    return NULL;
  }

  struct get_public_address_work* work = malloc(sizeof(struct get_public_address_work));

  int sign_bit;
  size_t word_count = 4;

  status = napi_get_value_bigint_words(env, argv[0], &sign_bit, &word_count, work->private_key);
  assert(status == napi_ok);


  // top is temp
  work->private_key[4] = word_count > 0 ? __builtin_bswap64(work->private_key[0]) : 0;
  work->private_key[0] = word_count > 3 ? __builtin_bswap64(work->private_key[3]) : 0;
  work->private_key[3] = work->private_key[4];
  work->private_key[4] = word_count > 1 ? __builtin_bswap64(work->private_key[1]) : 0;
  work->private_key[1] = word_count > 2 ? __builtin_bswap64(work->private_key[2]) : 0;
  work->private_key[2] = work->private_key[4];

  napi_value async_name;
  status = napi_create_string_utf8(env, "block-native", NAPI_AUTO_LENGTH, &async_name);
  assert(status == napi_ok);

  status = napi_create_async_work(env, NULL, async_name, 
    (napi_async_execute_callback) get_public_address_execute,  
    (napi_async_complete_callback) get_public_address_complete,
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

// Sign an ethereum transaction
napi_value sign_transaction(napi_env env, napi_callback_info info) {
  napi_value argv[4];
  napi_status status;
  size_t argc = 4;

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  assert(status == napi_ok);

  if (argc < 4) {
    napi_throw_error(env, "EINVAL", "Too few arguments");
    return NULL;
  }
  
  unsigned char* to_hash;
  size_t to_hash_length;
  status = napi_get_buffer_info(env, argv[0], (void**) &to_hash, &to_hash_length);
  assert(status == napi_ok);

  unsigned char tx_hash[32];
  // Hash the input buffer to get the txHash
  KeccakWidth1600_SpongeInstance sponge;
  KeccakWidth1600_SpongeInitialize(&sponge, 1088, 512);
  KeccakWidth1600_SpongeAbsorb(&sponge, to_hash, to_hash_length);
  KeccakWidth1600_SpongeAbsorbLastFewBits(&sponge, 0);
  KeccakWidth1600_SpongeSqueeze(&sponge, tx_hash, 32);

  int sign_bit;
  size_t word_count = 4;
  uint64_t private_key[5];

  status = napi_get_value_bigint_words(env, argv[1], &sign_bit, &word_count, private_key);
  assert(status == napi_ok);

  // top is temp
  private_key[4] = word_count > 0 ? __builtin_bswap64(private_key[0]) : 0;
  private_key[0] = word_count > 3 ? __builtin_bswap64(private_key[3]) : 0;
  private_key[3] = private_key[4];
  private_key[4] = word_count > 1 ? __builtin_bswap64(private_key[1]) : 0;
  private_key[1] = word_count > 2 ? __builtin_bswap64(private_key[2]) : 0;
  private_key[2] = private_key[4];


  // Sign the input buffer
  secp256k1_ecdsa_recoverable_signature signature;

  uint32_t secp256k1_status;
  secp256k1_status = secp256k1_ecdsa_sign_recoverable(secp256k1ctx, &signature, tx_hash, (unsigned char*) private_key, NULL, NULL);
  assert(secp256k1_status != 0);

  unsigned char output[64];
  int recovery;
  secp256k1_status = secp256k1_ecdsa_recoverable_signature_serialize_compact(secp256k1ctx, output, &recovery, &signature);
  assert(secp256k1_status != 0);

  napi_value buffer_v;
  void* raw_v;
  napi_value buffer_r;
  void* raw_r;
  napi_value buffer_s;
  void* raw_s;

  status = napi_create_buffer_copy(env, 32, output, &raw_r, &buffer_r);
  assert(status == napi_ok);

  status = napi_create_buffer_copy(env, 32, output + 32, &raw_s, &buffer_s);
  assert(status == napi_ok);


  uint32_t chain_id;
  status = napi_get_value_uint32(env, argv[2], &chain_id);
  assert(status == napi_ok);

  unsigned char v = chain_id == 0 ? recovery + 27 : recovery + (chain_id * 2 + 35);
  status = napi_create_buffer_copy(env, 1, &v, &raw_v, &buffer_v);
  assert(status == napi_ok);

  status = napi_set_element(env, argv[3], 6, buffer_v);
  assert(status == napi_ok);

  status = napi_set_element(env, argv[3], 7, buffer_r);
  assert(status == napi_ok);

  status = napi_set_element(env, argv[3], 8, buffer_s);
  assert(status == napi_ok);

  return argv[3];
}

napi_value init_all (napi_env env, napi_value exports) {
  napi_value recover_from_address_fn;
  napi_value get_public_address_fn;
  napi_value sign_transaction_fn;

  secp256k1ctx = secp256k1_context_create(
    SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY);

  napi_create_function(env, NULL, 0, recover_from_address, NULL, &recover_from_address_fn);
  napi_create_function(env, NULL, 0, get_public_address, NULL, &get_public_address_fn);
  napi_create_function(env, NULL, 0, sign_transaction, NULL, &sign_transaction_fn);

  napi_set_named_property(env, exports, "recoverFromAddress", recover_from_address_fn);
  napi_set_named_property(env, exports, "getPublicAddress", get_public_address_fn);
  napi_set_named_property(env, exports, "signTransaction", sign_transaction_fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init_all);