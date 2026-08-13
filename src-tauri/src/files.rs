//! Leitura e gravacao dos arquivos de relatorio e a lista de recentes.
//!
//! Um `.fr3` costuma ser UTF-8, mas versoes antigas do FastReport gravam em
//! ANSI (Windows-1252). Guardamos a codificacao detectada na abertura e
//! gravamos de volta na mesma, para nao invalidar o prologo do XML nem
//! corromper acentos.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const MAX_RECENT: usize = 12;
const RECENT_FILE: &str = "recentes.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Windows1252,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportFile {
    pub path: String,
    pub name: String,
    pub contents: String,
    pub encoding: Encoding,
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Le um relatorio do disco, detectando a codificacao do arquivo.
#[tauri::command]
pub fn read_report(path: String) -> Result<ReportFile, String> {
    let file = PathBuf::from(&path);
    let bytes =
        fs::read(&file).map_err(|error| format!("Nao foi possivel ler o arquivo: {error}"))?;

    let (contents, encoding) = match String::from_utf8(bytes.clone()) {
        Ok(text) => (text, Encoding::Utf8),
        Err(_) => {
            let (text, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
            (text.into_owned(), Encoding::Windows1252)
        }
    };

    Ok(ReportFile {
        path: file.to_string_lossy().to_string(),
        name: file_name(&file),
        contents,
        encoding,
    })
}

/// Grava o relatorio preservando a codificacao original do arquivo.
#[tauri::command]
pub fn write_report(path: String, contents: String, encoding: Encoding) -> Result<(), String> {
    let bytes = match encoding {
        Encoding::Utf8 => contents.into_bytes(),
        Encoding::Windows1252 => {
            let (encoded, _, _) = encoding_rs::WINDOWS_1252.encode(&contents);
            encoded.into_owned()
        }
    };
    fs::write(&path, bytes).map_err(|error| format!("Nao foi possivel gravar o arquivo: {error}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFile {
    pub path: String,
    pub name: String,
    pub base64: String,
}

/// Le um arquivo binario (.rav) e devolve em base64 — o IPC do Tauri e JSON.
#[tauri::command]
pub fn read_binary(path: String) -> Result<BinaryFile, String> {
    let file = PathBuf::from(&path);
    let bytes = fs::read(&file).map_err(|error| format!("Nao foi possivel ler o arquivo: {error}"))?;
    Ok(BinaryFile {
        path: file.to_string_lossy().to_string(),
        name: file_name(&file),
        base64: base64_encode(&bytes),
    })
}

#[tauri::command]
pub fn write_binary(path: String, base64: String) -> Result<(), String> {
    let bytes = base64_decode(&base64).ok_or("Conteudo binario invalido")?;
    fs::write(&path, bytes).map_err(|error| format!("Nao foi possivel gravar o arquivo: {error}"))
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut table = [255u8; 256];
    for (index, byte) in B64.iter().enumerate() {
        table[*byte as usize] = index as u8;
    }
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0;
    for byte in text.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = table[byte as usize];
        if value == 255 {
            return None;
        }
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

fn recent_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Diretorio de configuracao indisponivel: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(RECENT_FILE))
}

/// Lista de arquivos abertos recentemente, do mais recente para o mais antigo.
#[tauri::command]
pub fn recent_files<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    load_recent(&app)
}

pub fn load_recent<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let Ok(path) = recent_path(app) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let entries: Vec<String> = serde_json::from_str(&text).unwrap_or_default();
    entries
        .into_iter()
        .filter(|entry| Path::new(entry).exists())
        .collect()
}

/// Move um arquivo para o topo da lista de recentes.
#[tauri::command]
pub fn push_recent<R: Runtime>(app: AppHandle<R>, path: String) -> Vec<String> {
    let mut entries = load_recent(&app);
    entries.retain(|entry| entry != &path);
    entries.insert(0, path);
    entries.truncate(MAX_RECENT);

    if let Ok(file) = recent_path(&app) {
        let _ = fs::write(
            &file,
            serde_json::to_string_pretty(&entries).unwrap_or_default(),
        );
    }
    entries
}

#[tauri::command]
pub fn clear_recent<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    if let Ok(file) = recent_path(&app) {
        let _ = fs::remove_file(file);
    }
    Vec::new()
}
