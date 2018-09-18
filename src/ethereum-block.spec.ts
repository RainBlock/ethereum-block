import 'mocha';

import * as chai from 'chai';
import * as path from 'path';

const fs = process.browser ? undefined : require('fs-extra');
const get = process.browser ? require('simple-get') : undefined;

import {RlpDecoderTransform} from 'rlp-stream';
import {EthereumBlock, decodeBlock} from './ethereum-block';
import {Readable} from 'stream';

const asyncChunks = require('async-chunks');

declare var process: {browser: boolean;};

// Needed for should.not.be.undefined.
/* tslint:disable:no-unused-expression */
chai.should();

const GENESIS_BLOCK = 'test_data/genesis.bin';
const BLOCK_1M = 'test_data/1M.bin';
const BLOCK_4M = 'test_data/4M.bin';
const BLOCK_FIRST10 = 'test_data/first10.bin';

const loadStream = async (filename: string) => {
  const decoder = new RlpDecoderTransform();
  if (process.browser) {
    return await new Promise((resolve, reject) => {
      try {
        get(`base/src/${filename}`, (err: string, result: Readable) => {
          if (err) {
            reject(err);
          } else {
            resolve(result.pipe(decoder));
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  } else {
    fs.createReadStream(path.join(__dirname, filename)).pipe(decoder);
    return decoder;
  }
};

const assertEquals = (n0: BigInt, n1: BigInt) => {
  n0.toString(16).should.equal(n1.toString(16));
};

describe('Decode binary genesis block', async () => {
  let block: EthereumBlock;

  before(async () => {
    block = decodeBlock(
        (await asyncChunks(await loadStream(GENESIS_BLOCK)).next()).value);
  });

  it('should have correct miner', async () => {
    assertEquals(block.header.beneficiary, BigInt(0));
  });

  it('should have no transactions', async () => {
    block.transactions.length.should.equal(0);
  });
});

describe('Decode block 1M', async () => {
  let block: EthereumBlock;

  before(async () => {
    block = decodeBlock(
        (await asyncChunks(await loadStream(BLOCK_1M)).next()).value);
  });

  it('should have correct miner', async () => {
    assertEquals(
        block.header.beneficiary,
        BigInt('0x2a65aca4d5fc5b5c859090a6c34d164135398226'));
  });

  it('should have 2 transactions', async () => {
    block.transactions.length.should.equal(2);
  });
});

describe('Decode block 4M', async () => {
  let block: EthereumBlock;

  before(async () => {
    block = decodeBlock(
        (await asyncChunks(await loadStream(BLOCK_4M)).next()).value);
  });

  it('should have correct miner', async () => {
    assertEquals(
        block.header.beneficiary,
        BigInt('0x1e9939daaad6924ad004c2560e90804164900341'));
  });

  it('should have 69 transactions', async () => {
    block.transactions.length.should.equal(69);
  });

  it('transaction 0 from field should be correct', async () => {
    assertEquals(
        block.transactions[0].from,
        BigInt('0x84232a3fb1f3dd05f40ed2e15a9783db9646cd69'));
  });

  it('transaction 1 from field should be correct', async () => {
    assertEquals(
        block.transactions[1].from,
        BigInt('0x7ed1e469fcb3ee19c0366d829e291451be638e59'));
  });
});


describe('Decode first 10 blocks', async () => {
  const blocks: EthereumBlock[] = [];

  before(async () => {
    for await (const chunk of asyncChunks(await loadStream(BLOCK_FIRST10))) {
      blocks.push(decodeBlock(chunk));
    }
  });

  it('should have 10 blocks', async () => {
    blocks.length.should.equal(10);
  });

  it('block 3 should have correct block number', async () => {
    assertEquals(blocks[3].header.blockNumber, BigInt(3));
  });

  it('block 6 should have correct miner', async () => {
    assertEquals(
        blocks[6].header.beneficiary,
        BigInt('0x0193d941b50d91be6567c7ee1c0fe7af498b4137'));
  });

  it('block 9 should have no transactions', async () => {
    blocks[9].transactions.length.should.equal(0);
  });
});