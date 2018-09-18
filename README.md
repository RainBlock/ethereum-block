# ☔️📦  RainBlock's Ethereum Block Decoder
[![NPM Package](https://img.shields.io/npm/v/@rainblock/ethereum-block.svg?style=flat-square)](https://www.npmjs.org/package/@rainblock/ethereum-block)
[![Build Status](https://img.shields.io/travis/com/RainBlock/ethereum-block.svg?branch=master&style=flat-square)](https://travis-ci.com/RainBlock/ethereum-block)
[![Coverage Status](https://img.shields.io/coveralls/RainBlock/ethereum-block.svg?style=flat-square)](https://coveralls.io/r/RainBlock/ethereum-block)


[@rainblock/ethereum-block](https://www.npmjs.org/package/@rainblock/ethereum-block) is a decoder for the Ethereum block format. It uses native bindings to improve the performance of transaction verification. A fallback is provided when bindings cannot be used. Native bindings provide about a 30-50% speedup over pure javascript. Unlike the [EthereumJS](https://github.com/ethereumjs) [library](https://github.com/ethereumjs/ethereum-block) the API exports BigInts. Typescript definitions are provided.

# Install

Add @rainblock/ethereum-block to your project with:

> `npm install @rainblock/ethereum-block`

# Usage

Basic API documentation can be found [here](https://rainblock.github.io/ethereum-block/), but the following example shows basic use:

```typescript
import {decodeBlock} from '@rainblock/ethereum-block';

// Block decoded to RLP format by RLP-Stream
const rlpBlock : RlpList = RlpDecode(raw);
const block : EthereumBlock = decodeBlock(rlpBlock);
```
# Benchmarks

Benchmarks can be run by executing `npm run benchmark` from the package directory.

An example run on a 2016 15-inch Macbook:
```
no-op: 795262551±0.22% ops/s 1.26±0.013 ns/op (91 runs)
decodeBlock: 159±0.95% ops/s 6304084.39±271699.554 ns/op (79 runs)
decodeHeader: 305267±5.32% ops/s 3275.82±799.828 ns/op (81 runs)
decodeTx (js): 8450±1.97% ops/s 118344.55±11168.747 ns/op (88 runs)
decodeTx (native): 12455±1.08% ops/s 80287.49±4157.742 ns/op (89 runs)
```

Native is about 30-50% faster than the pure js version.
