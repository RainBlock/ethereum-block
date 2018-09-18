import * as benchmark from 'benchmark';
import * as fs from 'fs';
import * as path from 'path';
import {RlpDecode, RlpList} from 'rlp-stream';

import {decodeBlock, decodeHeader, decodeTransaction, EthereumBlockDecoderOptions} from './ethereum-block';


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
      suite.run();
    };

const suite = new benchmark.Suite();
// Tests the performance of a no-op.
suite.add('no-op', () => {});

// Load a txn
const block =
    RlpDecode(fs.readFileSync(path.join(__dirname, 'test_data/4M.bin')));
suite.add('decodeBlock', () => {
  decodeBlock(block as RlpList);
});
suite.add('decodeHeader', () => {
  decodeHeader(block[0] as RlpList);
});

const jsOptions: EthereumBlockDecoderOptions = {
  eip155: true,
  eip155Block: BigInt(2675000),
  chainId: 1,
  native: false
};

suite.add('decodeTx (js)', () => {
  decodeTransaction((block[1] as RlpList)[0] as RlpList, jsOptions);
});

const nativeOptions: EthereumBlockDecoderOptions = {
  eip155: true,
  eip155Block: BigInt(2675000),
  chainId: 1,
  native: true
};

suite.add('decodeTx (native)', () => {
  decodeTransaction((block[1] as RlpList)[0] as RlpList, nativeOptions);
});

runSuite(suite, 'basic');