fn main() {
    // The icon is baked into the executable by the line below, but Cargo only re-runs
    // this script when a file it was told about changes. Without this, replacing the
    // icons leaves every build carrying the previous one.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
