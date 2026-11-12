/** @format */

function parseOptions(
  argv,
  { valueOptions = [], booleanOptions = [], allowPositionals = false } = {}
) {
  const values = new Set(valueOptions);
  const booleans = new Set(booleanOptions);
  const knownOptions = new Set([...values, ...booleans]);
  const args = allowPositionals ? { _: [] } : {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      if (!allowPositionals) {
        throw new Error(`Unexpected argument: ${token}`);
      }
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    if (!knownOptions.has(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
    if (Object.hasOwn(args, key)) {
      throw new Error(`Option --${key} may only be specified once`);
    }

    if (booleans.has(key)) {
      args[key] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${key} requires a value`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

module.exports = { parseOptions };
