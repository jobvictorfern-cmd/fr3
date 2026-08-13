//! Aplicacao desktop do Editor FR3.
//!
//! O Rust cuida do que o navegador nao faz: abrir o arquivo passado por linha
//! de comando (duplo clique no `.fr3`), gravar por cima do arquivo original,
//! lista de recentes e menu nativo. Toda a edicao continua na mesma interface
//! web usada no modo navegador.

mod files;
mod menu;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Arquivo recebido na linha de comando, consumido pela interface ao iniciar.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

const REPORT_EXTENSIONS: [&str; 3] = ["fr3", "term", "xml"];

/// Primeiro argumento que parece um relatorio existente.
fn first_report_arg<S: AsRef<str>>(args: &[S]) -> Option<String> {
    args.iter().skip(1).find_map(|arg| {
        let value = arg.as_ref();
        let path = std::path::Path::new(value);
        let matches = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| REPORT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        (matches && path.is_file()).then(|| path.to_string_lossy().to_string())
    })
}

#[tauri::command]
fn pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut value| value.take())
}

/// Reconstroi o menu — usado depois de abrir/salvar, para atualizar recentes.
#[tauri::command]
fn refresh_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let recents = files::load_recent(&app);
    let menu = menu::build(&app, &recents).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(index) = id.strip_prefix("recente.") {
        match index {
            "limpar" => {
                let _ = files::clear_recent(app.clone());
                let recents: Vec<String> = Vec::new();
                if let Ok(menu) = menu::build(app, &recents) {
                    let _ = app.set_menu(menu);
                }
            }
            "vazio" => {}
            _ => {
                if let Ok(position) = index.parse::<usize>() {
                    let recents = files::load_recent(app);
                    if let Some(path) = recents.get(position) {
                        let _ = app.emit("abrir-arquivo", path.clone());
                    }
                }
            }
        }
        return;
    }
    let _ = app.emit("menu", id.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // O plugin de instancia unica precisa ser o primeiro: ele decide se este
    // processo continua ou repassa os argumentos para a janela ja aberta.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = first_report_arg(&argv) {
                let _ = app.emit("abrir-arquivo", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile::default())
        .invoke_handler(tauri::generate_handler![
            pending_file,
            refresh_menu,
            files::read_report,
            files::write_report,
            files::recent_files,
            files::push_recent,
            files::clear_recent,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let recents = files::load_recent(&handle);
            handle.set_menu(menu::build(&handle, &recents)?)?;

            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = first_report_arg(&args) {
                if let Ok(mut pending) = app.state::<PendingFile>().0.lock() {
                    *pending = Some(path);
                }
            }

            app.on_menu_event(move |app, event| handle_menu_event(app, event.id().as_ref()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o Editor FR3");
}

#[cfg(test)]
mod tests {
    use super::first_report_arg;

    #[test]
    fn ignora_o_executavel_e_argumentos_sem_relatorio() {
        assert_eq!(first_report_arg(&["fr3-editor.exe", "--debug"]), None);
        assert_eq!(first_report_arg::<String>(&[]), None);
    }

    #[test]
    fn ignora_arquivo_inexistente() {
        assert_eq!(
            first_report_arg(&["fr3-editor.exe", "C:/nao/existe.fr3"]),
            None
        );
    }

    #[test]
    fn encontra_relatorio_existente() {
        let dir = std::env::temp_dir().join("fr3-editor-teste");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ticket.fr3");
        std::fs::write(&file, "<TfrxReport/>").unwrap();

        let path = file.to_string_lossy().to_string();
        assert_eq!(
            first_report_arg(&["fr3-editor".to_string(), path.clone()]),
            Some(path)
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
