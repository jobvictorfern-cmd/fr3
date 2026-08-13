// Esconde o console do Windows nas versoes de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fr3_editor_lib::run()
}
