// onnxruntime-node checks tensors with `instanceof Float32Array` etc. Jest's
// sandbox has its own typed-array constructors, so the real embedding model
// fails inside tests. Share Node's constructors with the sandbox instead.
const { TestEnvironment } = require('jest-environment-node');

const SHARED_GLOBALS = [
  'ArrayBuffer',
  'SharedArrayBuffer',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
];

class OnnxEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of SHARED_GLOBALS) {
      this.global[name] = globalThis[name];
    }
  }
}

module.exports = OnnxEnvironment;
