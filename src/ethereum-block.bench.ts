import * as benchmark from 'benchmark';
import * as fs from 'fs';
import * as path from 'path';
import {RlpDecode, RlpList} from 'rlp-stream';

import {decodeBlock, decodeHeader, decodeTransaction, EthereumBlockDecoderOptions, getPublicAddress, signTransaction} from './ethereum-block';


interface BenchmarkRun {
  name: string;
  hz: number;
  stats: benchmark.Stats;
}

// This file contains the benchmark test suite. It includes the benchmark and
// some lightweight boilerplate code for running benchmark.js. To
// run the benchmarks, execute `npm run benchmark` from the package directory.
const runSuite =
    (suite: benchmark.Suite, name: string, printFastest = false) => {
      console.log(`\nRunning ${name}...`);
      // Reporter for each benchmark
      suite.on('cycle', (event: benchmark.Event) => {
        const benchmarkRun: BenchmarkRun = event.target as BenchmarkRun;
        const stats = benchmarkRun.stats as benchmark.Stats;
        const meanInNanos = (stats.mean * 1000000000).toFixed(2);
        const stdDevInNanos = (stats.deviation * 1000000000).toFixed(3);
        const runs = stats.sample.length;
        const ops = benchmarkRun.hz.toFixed(benchmarkRun.hz < 100 ? 2 : 0);
        const err = stats.rme.toFixed(2);

        console.log(
            `${benchmarkRun.name}: ${ops}±${err}% ops/s ${meanInNanos}±${
                stdDevInNanos} ns/op (${runs} run${runs === 0 ? '' : 's'})`);
      });

      if (printFastest) {
        suite.on('complete', () => {
          console.log(
              'Fastest is ' +
              suite.filter('fastest').map('name' as unknown as Function));
        });
      }
      // Runs the test suite
      suite.run({async: true});
    };


interface BenchmarkDeferrable {
  resolve: () => void;
}

/**
 * Simple wrapper for benchmark.js to add an asynchronous test.
 *  @param name         The name of the test to run.
 *  @param asyncTest    An async function which contains the test to be run. If
 * a setup function is provided, the state will be present in the {state}
 * parameter. Otherwise, the {state} parameter will be undefined.
 *  @param setup        Optional setup which provides state to {asyncTest}.
 */
const addAsyncTest = <T>(
    name: string, asyncTest: (state: T) => Promise<void>, setup?: () => T) => {
  let state: T;
  suite.add(name, {
    defer: true,
    setup: () => {
      if (setup !== undefined) {
        state = setup();
      }
    },
    fn: (deferred: BenchmarkDeferrable) => {
      asyncTest(state).then(() => deferred.resolve());
    }
  });
};



const suite = new benchmark.Suite();
// Tests the performance of a no-op.
suite.add('no-op', () => {});

// Load a txn
const block =
    RlpDecode(fs.readFileSync(path.join(__dirname, 'test_data/4M.bin')));
addAsyncTest('decodeBlock (native)', async () => {
  await decodeBlock(block as RlpList);
});

addAsyncTest('decodeBlock (js)', async () => {
  await decodeBlock(
      block as RlpList,
      {chainId: 1, eip155Block: BigInt(2675000), eip155: true, native: false});
});

addAsyncTest('decodeHeader', async () => {
  decodeHeader(block[0] as RlpList);
});

const jsOptions: EthereumBlockDecoderOptions = {
  eip155: true,
  eip155Block: BigInt(2675000),
  chainId: 1,
  native: false
};

addAsyncTest('decodeTx x4 (js)', async () => {
  await Promise.all([
    decodeTransaction((block[1] as RlpList)[0] as RlpList, jsOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, jsOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, jsOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, jsOptions)
  ]);
});

const nativeOptions: EthereumBlockDecoderOptions = {
  eip155: true,
  eip155Block: BigInt(2675000),
  chainId: 1,
  native: true
};

addAsyncTest('decodeTx x4 (native)', async () => {
  await Promise.all([
    decodeTransaction((block[1] as RlpList)[0] as RlpList, nativeOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, nativeOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, nativeOptions),
    decodeTransaction((block[1] as RlpList)[0] as RlpList, nativeOptions)
  ]);
});

addAsyncTest('getPublicAddress x4 (native)', async () => {
  await Promise.all([
    getPublicAddress(1n), getPublicAddress(1n), getPublicAddress(1n),
    getPublicAddress(1n)
  ]);
});

addAsyncTest('getPublicAddress x4 (js)', async () => {
  await Promise.all([
    getPublicAddress(1n, false), getPublicAddress(1n, false),
    getPublicAddress(1n, false), getPublicAddress(1n, false)
  ]);
});

addAsyncTest('signTransaction (native)', async () => {
  signTransaction(
      {
        to: BigInt('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'),
        from: BigInt(0),
        nonce: BigInt(0),
        gasLimit: BigInt(0),
        gasPrice: BigInt(0),
        data: Buffer.from([]),
        value: BigInt(100)
      },
      BigInt(1), 0);
});

addAsyncTest('signTransaction (js)', async () => {
  signTransaction(
      {
        to: BigInt('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'),
        from: BigInt(0),
        nonce: BigInt(0),
        gasLimit: BigInt(0),
        gasPrice: BigInt(0),
        data: Buffer.from([]),
        value: BigInt(100)
      },
      BigInt(1), 0, false);
});


runSuite(suite, 'basic');
