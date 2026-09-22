// Signs release builds with the keystore described in `mobile/keystore.properties`
// (never committed: see .gitignore). Without that file the release build keeps the
// debug signature, which is fine for a local smoke test but not for a GitHub release,
// because in-app APK updates only install over a build signed with the same key.
const { withAppBuildGradle } = require("expo/config-plugins");

const LOADER = `def ejflixKeystoreProperties = new Properties()
def ejflixKeystoreFile = rootProject.file("../keystore.properties")
if (ejflixKeystoreFile.exists()) {
    ejflixKeystoreFile.withInputStream { ejflixKeystoreProperties.load(it) }
}`;

const RELEASE_CONFIG = `        release {
            if (ejflixKeystoreProperties.containsKey("storeFile")) {
                storeFile file(ejflixKeystoreProperties["storeFile"])
                storePassword ejflixKeystoreProperties["storePassword"]
                keyAlias ejflixKeystoreProperties["keyAlias"]
                keyPassword ejflixKeystoreProperties["keyPassword"]
            }
        }
`;

const SIGNING_CHOICE =
  'signingConfig ejflixKeystoreProperties.containsKey("storeFile") ? signingConfigs.release : signingConfigs.debug';

/** Applies the three edits to the text of `android/app/build.gradle`. Exported for testing. */
function patchAppBuildGradle(contents) {
  if (contents.includes("ejflixKeystoreProperties")) return contents;

  // 1. load the properties before the `android { ... }` block
  let out = contents.replace(/^android\s*\{/m, `${LOADER}\n\nandroid {`);

  // 2. add a `release` signing config next to the generated `debug` one
  out = out.replace(
    /(signingConfigs\s*\{[\s\S]*?\n)(    \}\n)/,
    (_all, head, close) => `${head}${RELEASE_CONFIG}${close}`,
  );

  // 3. point the *release build type* at it. Scoped to the `buildTypes` block, because
  //    `release {` also names the signing config added above.
  const start = out.indexOf("buildTypes {");
  if (start >= 0) {
    const head = out.slice(0, start);
    const tail = out
      .slice(start)
      .replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, `$1${SIGNING_CHOICE}`);
    out = head + tail;
  }
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = patchAppBuildGradle(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.patchAppBuildGradle = patchAppBuildGradle;
