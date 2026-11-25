// Loaded before every test file. Tests commit into throwaway repos under the
// temp dir, so the developer's commit signing setup must not apply there:
// a signing key the test process can't reach would fail every fixture.
const index = Number(process.env.GIT_CONFIG_COUNT ?? 0);
process.env[`GIT_CONFIG_KEY_${index}`] = "commit.gpgsign";
process.env[`GIT_CONFIG_VALUE_${index}`] = "false";
process.env.GIT_CONFIG_COUNT = String(index + 1);
