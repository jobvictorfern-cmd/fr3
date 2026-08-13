//! Menu nativo. Cada item apenas emite um evento para a interface, que ja sabe
//! executar todas as acoes — assim o menu e a barra de ferramentas nunca saem
//! de sincronia.

use std::path::Path;

use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Runtime};

/// Rotulo curto para a lista de recentes: `ticket.fr3 — C:\relatorios`.
fn recent_label(path: &str) -> String {
    let file = Path::new(path);
    let name = file
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    match file.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => {
            format!("{name}  —  {}", parent.to_string_lossy())
        }
        _ => name,
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>, recents: &[String]) -> tauri::Result<Menu<R>> {
    let novo = MenuItemBuilder::with_id("arquivo.novo", "Novo")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let abrir = MenuItemBuilder::with_id("arquivo.abrir", "Abrir…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let salvar = MenuItemBuilder::with_id("arquivo.salvar", "Salvar")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let salvar_como = MenuItemBuilder::with_id("arquivo.salvarComo", "Salvar como…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let imprimir = MenuItemBuilder::with_id("arquivo.imprimir", "Imprimir / PDF…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    let mut recentes = SubmenuBuilder::new(app, "Abrir recente");
    if recents.is_empty() {
        recentes = recentes.item(
            &MenuItemBuilder::with_id("recente.vazio", "(nenhum)")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for (index, path) in recents.iter().enumerate() {
            recentes = recentes.item(
                &MenuItemBuilder::with_id(format!("recente.{index}"), recent_label(path))
                    .build(app)?,
            );
        }
        recentes = recentes
            .separator()
            .item(&MenuItemBuilder::with_id("recente.limpar", "Limpar lista").build(app)?);
    }

    let arquivo = SubmenuBuilder::new(app, "Arquivo")
        .item(&novo)
        .item(&abrir)
        .item(&recentes.build()?)
        .separator()
        .item(&salvar)
        .item(&salvar_como)
        .separator()
        .item(&imprimir)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Sair"))?)
        .build()?;

    let editar = SubmenuBuilder::new(app, "Editar")
        .item(
            &MenuItemBuilder::with_id("editar.desfazer", "Desfazer")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("editar.refazer", "Refazer")
                .accelerator("CmdOrCtrl+Y")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("editar.duplicar", "Duplicar")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("editar.excluir", "Excluir").build(app)?)
        .build()?;

    let exibir = SubmenuBuilder::new(app, "Exibir")
        .item(
            &MenuItemBuilder::with_id("exibir.ampliar", "Ampliar")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("exibir.reduzir", "Reduzir")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("exibir.ajustar", "Ajustar a janela")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("exibir.grade", "Grade").build(app)?)
        .item(
            &MenuItemBuilder::with_id("exibir.previsualizar", "Pre-visualizar")
                .accelerator("F5")
                .build(app)?,
        )
        .build()?;

    let ajuda = SubmenuBuilder::new(app, "Ajuda")
        .item(&PredefinedMenuItem::about(
            app,
            Some("Sobre o Editor FR3"),
            Some(
                AboutMetadataBuilder::new()
                    .name(Some("Editor FR3"))
                    .version(Some(env!("CARGO_PKG_VERSION")))
                    .comments(Some("Editor visual de relatorios FastReport (.fr3)"))
                    .build(),
            ),
        )?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&arquivo, &editar, &exibir, &ajuda])
        .build()
}
