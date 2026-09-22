// Persists Gradle settings across `expo prebuild`: bigger JVM heap and only the ABIs we ship
// (arm64-v8a for phones/tablets, x86_64 for the emulator).
const { withGradleProperties } = require("expo/config-plugins");

const PROPS = {
  "org.gradle.jvmargs": "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
  reactNativeArchitectures: "arm64-v8a,x86_64",
};

module.exports = function withGradleProps(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const existing = cfg.modResults.find((item) => item.type === "property" && item.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: "property", key, value });
    }
    return cfg;
  });
};
