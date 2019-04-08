import {toBigIntBE, toBufferBE} from 'bigint-buffer';
import {RlpEncode, RlpList} from 'rlp-stream';
import * as secp256k1 from 'secp256k1';
declare var process: {browser: boolean;};

const keccak = require('keccak');

interface NativeInterface {
  recoverFromAddress(verifyBlock: Buffer, signature: Buffer, recovery: boolean):
      Promise<bigint>;
  getPublicAddress(privateKey: bigint): Promise<bigint>;
  signTransaction(
      transaction: Buffer, privateKey: bigint, chainId: number,
      transactionRlp: RlpList): RlpList;
}

let native: NativeInterface;

if (!process.browser) {
  try {
    native = require('bindings')('block_native');
  } catch (e) {
    console.log(e);
    console.warn(
        'Native bindings loading failed, using pure JS implementation');
  }
}

/** A deserialized Ethereum block. */
export interface EthereumBlock {
  /** The header for the Ethereum block. */
  header: EthereumHeader;
  /** The transaction list for the Ethereum block.  */
  transactions: EthereumTransaction[];
  /** A list of headers for uncles.  */
  uncles: EthereumHeader[];
}

export interface EthereumBlockDecoderOptions {
  /** For a EIP-155 transaction, which chain to use to replace v. */
  chainId: number;
  /**
   * For decoding a block, which block number EIP-155 semantics automatically
   * applies.
   */
  eip155Block: bigint;
  /**
   * For decoding a transaction, whether or not to use EIP-155 semantics to
   * decode the transaction.
   */
  eip155: boolean;
  /**
   * If available, use native bindings to do transaction processing.
   */
  native: boolean;
}

const defaultOptions: EthereumBlockDecoderOptions = {
  chainId: 1,
  eip155Block: BigInt(2675000),
  eip155: false,
  native: true
};

export const CONTRACT_CREATION: bigint = BigInt(-1);

/** A header for an Ethereum block. */
export interface EthereumHeader {
  /** The Keccak 256-bit hash of the parent block’s header, in its entirety. */
  parentHash: bigint;
  /** The Keccak 256-bit hash of the ommers list portion of this block. */
  uncleHash: bigint;
  /**
   * The 160-bit address to which all fees collected from the successful mining
   * of this block be transferred.
   */
  beneficiary: bigint;
  /**
   * The Keccak 256-bit hash of the root node of the state trie, after all
   * transactions are executed and finalisations applied.
   */
  stateRoot: bigint;
  /**
   * The Keccak 256-bit hash of the root node of the trie structure populated
   * with each transaction in the transactions list portion of the block.
   */
  transactionsRoot: bigint;
  /**
   * The Keccak 256-bit hash of the root node of the trie structure populated
   * with the receipts of each transaction in the transactions list portion of
   * the block.
   */
  receiptsRoot: bigint;
  /**
   * The Bloom filter composed from indexable information (logger address and
   * log topics) contained in each log entry from the receipt of each
   * transaction in the transactions list.
   */
  logsBloom: Buffer;
  /**
   * A scalar value corresponding to the difficulty level of this block. This
   * can be calculated from the previous block’s difficulty level and the
   * timestamp.
   */
  difficulty: bigint;
  /**
   * A scalar value equal to the number of ancestor blocks. The genesis block
   * has a number of zero.
   */
  blockNumber: bigint;
  /**
   * A scalar value equal to the current limit of gas expenditure per block.
   */
  gasLimit: bigint;
  /**
   * A scalar value equal to the total gas used in transactions in this block.
   */
  gasUsed: bigint;
  /**
   * A scalar value equal to the reasonable output of Unix’s time() at this
   * block’s inception.
   */
  timestamp: bigint;
  /**
   * An arbitrary byte array containing data relevant to this block. This must
   * be 32 bytes or fewer.
   */
  extraData: Buffer;
  /**
   * A 256-bit hash which proves combined with the nonce that a sufficient
   * amount of computation has been carried out on this block.
   */
  mixHash: bigint;
  /**
   * A 64-bit hash which proves combined with the mix-hash that a sufficient
   * amount of computation has been carried out on this block.
   */
  nonce: bigint;
}

/** The data stored in a block for a signed Ethereum transaction */
export interface EthereumTransaction {
  /**
   * A scalar value equal to the number of transactions sent from this address
   * or, in the case of accounts with associated code, the number of
   * contract-creations made by this account.
   */
  nonce: bigint;
  /**
   * A scalar value equal to the number of Wei to be paid per unit of gas for
   * all computation costs incurred as a result of the execution of this
   * transaction.
   */
  gasPrice: bigint;
  /**
   * A scalar value equal to the maximum amount of gas that should be used in
   * executing this transaction.
   */
  gasLimit: bigint;
  /**
   * A scalar value equal to the number of Wei to be transferred to the message
   * call’s recipient or, in the case of contract creation, as an endowment to
   * the newly created account.
   */
  value: bigint;
  /**
   * The 160-bit address of the message call’s recipient or, for a contract
   * creation transaction, CONTRACT_CREATION (-1), to distinguish against
   * account 0x0000000000000000000000000000000000000000.
   */
  to: bigint;
  /**
   * An unlimited size byte array specifying the EVM-code for the account
   * initialisation procedure, for a contract transaction, or an unlimited size
   * byte array specifying the input data of the message call, for a message
   * call.
   */
  data: Buffer;
  /** The 160-bit address of the message caller. */
  from: bigint;
}

export class EthereumBlockDecoderError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const HEADER_PARENT_HASH = 0;
const HEADER_UNCLE_HASH = 1;
const HEADER_BENEFICIARY = 2;
const HEADER_STATE_ROOT = 3;
const HEADER_TRANSACTIONS_ROOT = 4;
const HEADER_RECEIPTS_ROOT = 5;
const HEADER_LOGSBLOOM = 6;
const HEADER_DIFFICULTY = 7;
const HEADER_BLOCK_NUMBER = 8;
const HEADER_GAS_LIMIT = 9;
const HEADER_GAS_USED = 10;
const HEADER_TIMESTAMP = 11;
const HEADER_EXTRADATA = 12;
const HEADER_MIXHASH = 13;
const HEADER_NONCE = 14;

/**
 * Given a RLP-serialized list with an Ethereum header, decodes the list and
 * validates the Ethereum header.
 *
 * @param header    The RLP-encoded list with the header to decode.
 *
 * @returns A validated and decoded EthereumHeader.
 */
export function decodeHeader(header: RlpList): EthereumHeader {
  if (!Array.isArray(header)) {
    throw new EthereumBlockDecoderError(
        `Expected block header as RLP-encoded list!`);
  }

  return {
    parentHash: toBigIntBE(header[HEADER_PARENT_HASH] as Buffer),
    uncleHash: toBigIntBE(header[HEADER_UNCLE_HASH] as Buffer),
    beneficiary: toBigIntBE(header[HEADER_BENEFICIARY] as Buffer),
    stateRoot: toBigIntBE(header[HEADER_STATE_ROOT] as Buffer),
    transactionsRoot: toBigIntBE(header[HEADER_TRANSACTIONS_ROOT] as Buffer),
    receiptsRoot: toBigIntBE(header[HEADER_RECEIPTS_ROOT] as Buffer),
    logsBloom: header[HEADER_LOGSBLOOM] as Buffer,
    difficulty: toBigIntBE(header[HEADER_DIFFICULTY] as Buffer),
    blockNumber: toBigIntBE(header[HEADER_BLOCK_NUMBER] as Buffer),
    gasLimit: toBigIntBE(header[HEADER_GAS_LIMIT] as Buffer),
    gasUsed: toBigIntBE(header[HEADER_GAS_USED] as Buffer),
    timestamp: toBigIntBE(header[HEADER_TIMESTAMP] as Buffer),
    extraData: (header[HEADER_EXTRADATA] as Buffer),
    mixHash: toBigIntBE(header[HEADER_MIXHASH] as Buffer),
    nonce: toBigIntBE(header[HEADER_NONCE] as Buffer)
  };
}

const TRANSACTION_NONCE = 0;
const TRANSACTION_GASPRICE = 1;
const TRANSACTION_STARTGAS = 2;
const TRANSACTION_TO = 3;
const TRANSACTION_VALUE = 4;
const TRANSACTION_DATA = 5;
const TRANSACTION_V = 6;
const TRANSACTION_R = 7;
const TRANSACTION_S = 8;

/**
 * Given a RLP-serialized list with an Ethereum transaction, decodes the list
 * and validates the Ethereum transaction.
 *
 * @param header    The RLP-encoded list with the transaction to decode.
 *
 * @returns A validated and decoded EthereumTransaction.
 */
export async function decodeTransaction(
    transaction: RlpList,
    options: EthereumBlockDecoderOptions =
        defaultOptions): Promise<EthereumTransaction> {
  const v = transaction[TRANSACTION_V] as Buffer;
  const r = transaction[TRANSACTION_R] as Buffer;
  const s = transaction[TRANSACTION_S] as Buffer;

  if (r.length > 32) {
    throw new Error(`r > 32 bytes!`);
  }
  if (s.length > 32) {
    throw new Error(`s > 32 bytes!`);
  }

  const signature = Buffer.alloc(64, 0);
  r.copy(signature, 32 - r.length);
  s.copy(signature, 64 - s.length);

  const chainV = options.chainId * 2 + 35;
  const verifySignature =
      options.eip155 ? v[0] === chainV || v[0] === chainV + 1 : false;
  const recovery =
      verifySignature ? v[0] - (options.chainId * 2 + 8) - 27 : v[0] - 27;

  if (recovery !== 0 && recovery !== 1) {
    throw new EthereumBlockDecoderError(
        `Invalid infinite recovery = ${recovery}`);
  }

  // TODO: Get existing buffer from stream instead of regenerating it.
  const toHash = verifySignature ?
      RlpEncode([
        (transaction[TRANSACTION_NONCE] as Buffer),
        (transaction[TRANSACTION_GASPRICE] as Buffer),
        (transaction[TRANSACTION_STARTGAS] as Buffer),
        (transaction[TRANSACTION_TO] as Buffer),
        (transaction[TRANSACTION_VALUE] as Buffer),
        (transaction[TRANSACTION_DATA] as Buffer),
        Buffer.from([options.chainId]),
        Buffer.from([]),
        Buffer.from([]),
      ]) :
      RlpEncode([
        (transaction[TRANSACTION_NONCE] as Buffer),
        (transaction[TRANSACTION_GASPRICE] as Buffer),
        (transaction[TRANSACTION_STARTGAS] as Buffer),
        (transaction[TRANSACTION_TO] as Buffer),
        (transaction[TRANSACTION_VALUE] as Buffer),
        (transaction[TRANSACTION_DATA] as Buffer)
      ]);

  let from: bigint;
  if (process.browser || native === undefined || !options.native) {
    const hash = keccak('keccak256').update(toHash).digest();
    // Recover and decompress the public key
    const pubKey = secp256k1.recover(hash, signature, recovery, false).slice(1);
    if (pubKey.length !== 64) {
      throw new EthereumBlockDecoderError(
          `Incorrect public key length ${pubKey.length}`);
    }

    from = toBigIntBE(keccak('keccak256').update(pubKey).digest().slice(-20));
    if (from === undefined) {
      throw new EthereumBlockDecoderError(`Failed to get from account`);
    }
  } else {
    from = await native.recoverFromAddress(toHash, signature, recovery === 1);
  }

  const toBuffer = transaction[TRANSACTION_TO] as Buffer;
  return {
    nonce: toBigIntBE(transaction[TRANSACTION_NONCE] as Buffer),
    gasPrice: toBigIntBE(transaction[TRANSACTION_GASPRICE] as Buffer),
    gasLimit: toBigIntBE(transaction[TRANSACTION_STARTGAS] as Buffer),
    to: toBuffer.length === 0 ? BigInt(-1) : toBigIntBE(toBuffer),
    value: toBigIntBE(transaction[TRANSACTION_VALUE] as Buffer),
    data: transaction[TRANSACTION_DATA] as Buffer,
    from
  };
}

/**
 * Given a RLP-serialized list with an Ethereum block, decodes the list and
 * validates the Ethereum block.
 *
 * @param header    The RLP-encoded list with the transaction to decode.
 *
 * @returns A validated and decoded EthereumTransaction.
 */
export async function decodeBlock(
    rlp: RlpList, options: EthereumBlockDecoderOptions = defaultOptions):
    Promise<EthereumBlock> {
  // Each incoming block should be an RLP list.
  if (!Array.isArray(rlp)) {
    throw new EthereumBlockDecoderError(`Expected RLP-encoded list!`);
  }

  // The RlpList should have 3 parts: the header, the transaction list and the
  // uncle list.
  const header: EthereumHeader = decodeHeader(rlp[0] as RlpList);

  if (header.blockNumber >= defaultOptions.eip155Block) {
    defaultOptions.eip155 = true;
  }
  const transactionPromises: Array<Promise<EthereumTransaction>> =
      (rlp[1] as RlpList).map(tx => decodeTransaction(tx as RlpList, options));
  const transactions: EthereumTransaction[] =
      await Promise.all(transactionPromises);
  const uncles: EthereumHeader[] =
      (rlp[2] as RlpList).map(buf => decodeHeader(buf as RlpList));

  return {header, transactions, uncles} as EthereumBlock;
}

/**
 * Remove leading null bytes from a buffer.
 *
 * @param buf Buffer to remove null bytes from
 *
 * @returns   A slice of the buffer without null bytes.
 */
function removeNullPrefix(buf: Buffer): Buffer {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) {
      return buf.slice(i);
    }
  }
  return Buffer.from([]);
}

/**
 * Encodes an Ethereum header as a RLP list
 *
 * @param header  The Ethreum header to encode.
 *
 * @return A RlpList with the encoded Ethereum header.
 */
export function encodeHeaderAsRLP(header: EthereumHeader): RlpList {
  const asRlpList: RlpList = [];
  asRlpList[HEADER_PARENT_HASH] = toBufferBE(header.parentHash, 32);
  asRlpList[HEADER_UNCLE_HASH] = toBufferBE(header.uncleHash, 32);
  asRlpList[HEADER_BENEFICIARY] = toBufferBE(header.beneficiary, 20);
  asRlpList[HEADER_STATE_ROOT] = toBufferBE(header.stateRoot, 32);
  asRlpList[HEADER_TRANSACTIONS_ROOT] = toBufferBE(header.transactionsRoot, 32);
  asRlpList[HEADER_RECEIPTS_ROOT] = toBufferBE(header.receiptsRoot, 32);
  asRlpList[HEADER_LOGSBLOOM] = header.logsBloom;
  asRlpList[HEADER_DIFFICULTY] =
      removeNullPrefix(toBufferBE(header.difficulty, 32));
  asRlpList[HEADER_BLOCK_NUMBER] =
      removeNullPrefix(toBufferBE(header.blockNumber, 32));
  asRlpList[HEADER_GAS_LIMIT] =
      removeNullPrefix(toBufferBE(header.gasLimit, 32));
  asRlpList[HEADER_GAS_USED] = removeNullPrefix(toBufferBE(header.gasUsed, 32));
  asRlpList[HEADER_TIMESTAMP] =
      removeNullPrefix(toBufferBE(header.timestamp, 32));
  asRlpList[HEADER_EXTRADATA] = header.extraData;
  asRlpList[HEADER_MIXHASH] = toBufferBE(header.mixHash, 32);
  asRlpList[HEADER_NONCE] = toBufferBE(header.nonce, 8);
  return asRlpList;
}

/**
 * Encodes a new block. Transactions must be encoded and signed as a RLPList
 *
 * @param header        The Ethreum header to encode.
 * @param transactions  Encoded, signed transactions to include
 * @param uncleList     A list of uncles to include
 *
 * @return A new RLP encoded Ethereum block.
 */
export function encodeBlock(
    header: EthereumHeader, transactions: RlpList,
    uncleList: EthereumHeader[]): Buffer {
  const asRlpList: RlpList = [
    encodeHeaderAsRLP(header), transactions,
    uncleList.map(uncle => encodeHeaderAsRLP(uncle))
  ];
  return RlpEncode(asRlpList);
}

/**
 * Get the public address of a given private key.
 *
 * @param privateKey    The private key to obtain an address for. It should be a
 * 256-bit bigint which cannot be 0.
 * @param useNativeIfAvailable  Set to false to force fallback to js-only code.
 *
 * @return The public address for the given private key.
 */
export function getPublicAddress(
    privateKey: bigint, useNativeIfAvailable = true) {
  if (process.browser || native === undefined || !useNativeIfAvailable) {
    // Public address is last 20 bytes of the hashed public key (bytes 1-65)
    const pubKey = secp256k1.publicKeyCreate(toBufferBE(privateKey, 32), false);
    const hashed = toBigIntBE(
        keccak('keccak256').update(pubKey.slice(1)).digest().slice(-20));
    return hashed;
  }
  return native.getPublicAddress(privateKey);
}

/**
 * Sign an [EthereumTransaction] using a private key.
 *
 * @param transaction The transaction to sign. The from field, if present, is
 * ignored (it will be derived from the private key)
 * @param privateKey  The private key to sign the transaction with.
 * @param chainId     The chain id to use. 0=pre EIP-155 semantics. 1=mainnet.
 * @param useNativeIfAvailable Set to false to force fallback to js-only code.
 *
 * @return A [RlpList] representing the transaction. Run this list through
 * RlpEncode to obtain a [Buffer].
 */
export function signTransaction(
    transaction: EthereumTransaction, privateKey: bigint, chainId = 1,
    useNativeIfAvailable = true) {
  const rlpList: RlpList = [
    removeNullPrefix(toBufferBE(transaction.nonce, 32)),
    removeNullPrefix(toBufferBE(transaction.gasPrice, 32)),
    removeNullPrefix(toBufferBE(transaction.gasLimit, 32)),
    transaction.to === CONTRACT_CREATION ? Buffer.from([]) :
                                           toBufferBE(transaction.to, 20),
    removeNullPrefix(toBufferBE(transaction.value, 32)), transaction.data
  ];
  // EIP-155 transaction
  if (chainId !== 0) {
    rlpList[TRANSACTION_V] = Buffer.from([chainId]);
    rlpList[TRANSACTION_R] = Buffer.from([]);
    rlpList[TRANSACTION_S] = Buffer.from([]);
  }

  const toHash = RlpEncode(rlpList);
  if (process.browser || native === undefined || !useNativeIfAvailable) {
    const hash = keccak('keccak256').update(toHash).digest();
    const signature = secp256k1.sign(hash, toBufferBE(privateKey, 32));

    rlpList[TRANSACTION_R] = signature.signature.slice(0, 32);
    rlpList[TRANSACTION_S] = signature.signature.slice(32, 64);
    rlpList[TRANSACTION_V] = Buffer.from(
        [chainId > 0 ? signature.recovery + (chainId * 2 + 35) :
                       signature.recovery + 27]);
    return rlpList;
  } else {
    return native.signTransaction(toHash, privateKey, chainId, rlpList);
  }
}