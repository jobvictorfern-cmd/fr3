/**
 * Camada de plataforma: isola as diferencas entre rodar no navegador e rodar
 * como aplicativo desktop (Tauri).
 *
 * No desktop existem caminho de arquivo, gravacao no lugar, lista de recentes,
 * menu nativo e associacao de arquivo. No navegador, abrir e um `<input file>`
 * e salvar e um download. O resto da aplicacao nao precisa saber em qual dos
 * dois esta.
 */

const bridge = typeof window !== 'undefined' ? window.__TAURI__ : null;

export const isDesktop = !!bridge;

const REPORT_FILTER = {
  name: 'Relatorio FastReport',
  extensions: ['fr3', 'term', 'xml'],
};

/** O plugin de dialogo ja devolveu string e objeto conforme a versao. */
function toPath(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.path || null;
}

function baseName(path) {
  return String(path).split(/[\\/]/).pop() || path;
}

/* ------------------------------- navegador -------------------------------- */

function browserPlatform() {
  const pickFile = () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.fr3,.term,.xml,text/xml';
      input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
      input.click();
    });

  return {
    isDesktop: false,

    async initialFile() {
      // No navegador o exemplo serve de ponto de partida.
      try {
        const response = await fetch('samples/rsiamac_1.fr3');
        if (!response.ok) return null;
        return {
          path: null,
          name: 'rsiamac_1.fr3',
          contents: await response.text(),
          encoding: 'utf8',
        };
      } catch {
        return null;
      }
    },

    async open() {
      const file = await pickFile();
      if (!file) return null;
      return { path: null, name: file.name, contents: await file.text(), encoding: 'utf8' };
    },

    async openPath() {
      return null;
    },

    async save({ contents, name }) {
      const blob = new Blob([contents], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (name || 'relatorio').replace(/\.(fr3|term|xml)$/i, '') + '.fr3';
      link.click();
      URL.revokeObjectURL(url);
      return { path: null, name: link.download };
    },

    async recent() {
      return [];
    },

    async confirm(message) {
      return window.confirm(message);
    },

    async alert(message) {
      window.alert(message);
    },

    onMenu() {},
    onOpenFile() {},
    onCloseRequested() {},
    setTitle(title) {
      document.title = title;
    },
  };
}

/* -------------------------------- desktop --------------------------------- */

function desktopPlatform() {
  const { core, event, dialog, window: tauriWindow } = bridge;
  const invoke = (command, args) => core.invoke(command, args);

  const readPath = async (path) => {
    const file = await invoke('read_report', { path });
    await invoke('push_recent', { path: file.path });
    await invoke('refresh_menu');
    return file;
  };

  return {
    isDesktop: true,

    async initialFile() {
      // Arquivo recebido por duplo clique / linha de comando.
      const path = await invoke('pending_file');
      return path ? readPath(path) : null;
    },

    async open() {
      const selected = toPath(
        await dialog.open({ multiple: false, directory: false, filters: [REPORT_FILTER] })
      );
      return selected ? readPath(selected) : null;
    },

    openPath: readPath,

    async save({ contents, path, name, encoding }, { saveAs = false } = {}) {
      let target = saveAs ? null : path;
      if (!target) {
        target = toPath(
          await dialog.save({
            defaultPath: name || 'relatorio.fr3',
            filters: [REPORT_FILTER],
          })
        );
        if (!target) return null;
      }
      await invoke('write_report', { path: target, contents, encoding: encoding || 'utf8' });
      await invoke('push_recent', { path: target });
      await invoke('refresh_menu');
      return { path: target, name: baseName(target) };
    },

    async recent() {
      return invoke('recent_files');
    },

    async confirm(message) {
      return dialog.ask(message, { title: 'Editor FR3', kind: 'warning' });
    },

    async alert(message) {
      return dialog.message(message, { title: 'Editor FR3', kind: 'error' });
    },

    onMenu(handler) {
      event.listen('menu', (payload) => handler(payload.payload));
    },

    onOpenFile(handler) {
      event.listen('abrir-arquivo', (payload) => handler(payload.payload));
    },

    onFileDrop(handler) {
      event.listen('tauri://drag-drop', (payload) => {
        const path = payload.payload?.paths?.[0];
        if (path) handler(path);
      });
    },

    onCloseRequested(handler) {
      const current = tauriWindow.getCurrentWindow();
      current.onCloseRequested(async (closeEvent) => {
        const allowed = await handler();
        if (!allowed) closeEvent.preventDefault();
      });
    },

    setTitle(title) {
      document.title = title;
      try {
        tauriWindow.getCurrentWindow().setTitle(title);
      } catch {
        /* janela ainda nao disponivel: o titulo do documento ja foi ajustado */
      }
    },
  };
}

export const platform = isDesktop ? desktopPlatform() : browserPlatform();
